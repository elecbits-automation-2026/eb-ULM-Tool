/* ─── AI seam — Claude, the wizard's brain ───────────────────────────────────
   Every call goes through a server that holds the Anthropic key, never from
   this bundle. Two transports, in order of preference:

     1. VITE_CLAUDE_PROXY_URL — the `claude` Supabase Edge Function the ODM app
        already deploys (raw Messages API shape).
     2. The ULM Drive web app's `ai.chat` action — the same Apps Script project
        that provisions folders, with ANTHROPIC_API_KEY in its script
        properties. Nothing extra to deploy, so this is the usual path.

   With neither configured, aiConfigured is false and every screen that uses AI
   falls back to something the user can still finish by hand.

   Calls with a `schema` come back as a parsed object: the model is constrained
   to that JSON Schema, so the extract / classify steps never have to guess at
   free text.                                                                 */

import { driveConfigured, drivePing, driveAi } from "./ulmDrive.js";

const clean = (s) => String(s || "").trim().replace(/^["']+|["']+$/g, "");
const proxyUrl = clean(import.meta.env.VITE_CLAUDE_PROXY_URL);

export const MODEL = clean(import.meta.env.VITE_CLAUDE_MODEL) || "claude-opus-5";

/** A transport exists. Whether the key behind it is actually set is what
    aiProbe() answers. */
export const aiConfigured = Boolean(proxyUrl || driveConfigured);

/* ── is the brain actually switched on? ────────────────────────────────────
   The Drive backend knows whether its key is set; ask it once and remember,
   so the wizard can label its buttons honestly instead of promising AI and
   then falling over.                                                        */
let probed = null;
export async function aiProbe(force = false) {
  if (probed && !force) return probed;
  probed = (async () => {
    if (proxyUrl) return { ok: true, via: "edge function", model: MODEL };
    if (!driveConfigured) return { ok: false, error: "No AI backend configured" };
    const p = await drivePing();
    if (!p?.ok) return { ok: false, error: p?.error || "Drive backend unreachable" };
    if (!p.ai?.enabled) return { ok: false, error: p.ai?.error || "ANTHROPIC_API_KEY is not set in the Apps Script project" };
    return { ok: true, via: "apps script", model: p.ai.model || MODEL };
  })();
  const res = await probed;
  if (!res.ok) probed = null; // let a later attempt re-check
  return res;
}

/**
 * One Claude call.
 *   claude(prompt, { system, maxTokens, effort, schema })
 * Returns the answer text, or — when a schema is given — the parsed object.
 */
export async function claude(prompt, { system, maxTokens = 4000, effort = "medium", schema, model } = {}) {
  if (proxyUrl) {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: model || MODEL,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) throw new Error(body?.error?.message || `AI HTTP ${res.status}`);
    if (body?.stop_reason === "refusal") throw new Error("Claude declined to answer this one — fill it in manually.");
    const text = (body?.content || []).filter((c) => c?.type === "text" || c?.text).map((c) => c.text || "").join("").trim();
    return schema ? parseJson(text) : text;
  }

  if (driveConfigured) {
    const res = await driveAi({ prompt, system, maxTokens, effort, schema, model: model || MODEL });
    if (!res?.ok) throw new Error(res?.error || "AI call failed");
    if (!schema) return res.text;
    return res.json ?? parseJson(res.text);
  }

  throw new Error("No AI backend configured");
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = String(text || "").match(/\{[\s\S]*\}/); // tolerate a stray wrapper
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw new Error("Claude's answer was not valid JSON");
}

/* ════════════════════════════════════════════════════════════════════════════
   The four places the wizard gets smarter
   ══════════════════════════════════════════════════════════════════════════ */

/* 1. Reading what the user actually typed at the client step ───────────────
   Someone types "yes check if hitachi exists as a client ?" — that is a
   question about Hitachi, not a company called that whole sentence. This
   pulls the company out and says which of the two it was.                   */
const CLIENT_MSG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "company", "reply"],
  properties: {
    intent: { type: "string", enum: ["name", "lookup", "chitchat", "unclear"],
      description: "name = they are stating the client name; lookup = they are asking whether a client exists; chitchat = anything else; unclear = no company mentioned" },
    company: { type: ["string", "null"], description: "The company name only — no verbs, no punctuation, no question words. Null when no company is mentioned." },
    reply: { type: "string", description: "One short sentence back to the user, max 20 words." },
  },
};

export async function readClientMessage(text) {
  return claude(
    `A user of Elecbits' project-creation wizard was asked "What is the client / company name?" and replied:\n\n"""${String(text || "").slice(0, 500)}"""\n\nPull out the company name they mean and say what they were doing.`,
    {
      system: "You parse one short message from an electronics-manufacturing project wizard. Answer only through the schema. Never invent a company that was not mentioned.",
      schema: CLIENT_MSG_SCHEMA, maxTokens: 700, effort: "low",
    },
  );
}

/* 1b. The conversational layer — every typed message, understood ───────────
   The wizard is a state machine with a pending question at each step. This
   reads one user message against that pending question and says what it was:
   a direct answer, one of the offered options, a question to answer, or just
   chat. The wizard applies answers/picks and speaks the reply for the rest —
   which is what makes typing at any step feel like talking to Claude.       */
export async function interpretMessage({ step, question, options, date, data, message }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "value", "reply"],
    properties: {
      kind: {
        type: "string", enum: ["answer", "pick", "question", "chat"],
        description: "pick = it maps onto one of the OPTIONS; answer = it answers the pending question directly; question = they are asking something; chat = greeting / aside / intent with no usable content",
      },
      value: {
        type: ["string", "null"],
        description: date
          ? "kind=answer: the date they mean as YYYY-MM-DD, resolved against today's date given in the prompt. Otherwise null."
          : options
            ? "kind=pick: exactly one code from OPTIONS, verbatim. Otherwise null."
            : "kind=answer: the answer, cleaned of filler (\"we're calling it Falcon\" → \"Falcon\"). Otherwise null.",
      },
      reply: {
        type: "string",
        description: "kind=question/chat: the genuinely helpful reply — answer with real electronics-industry knowledge, under 60 words, ending by steering back to the pending question. kind=answer/pick: one short confirmation, under 12 words.",
      },
    },
  };
  const optBlock = options?.length
    ? `\nOPTIONS\n${options.map((o) => `${o.code} = ${o.label}`).join("\n")}`
    : "";
  const today = new Date().toISOString().slice(0, 10);
  return claude(
    `You are mid-conversation in Elecbits' project-creation wizard.\nToday: ${today}\nCollected so far: ${data || "nothing yet"}\nPending question (step "${step}"): ${question}${optBlock}\n\nThe user typed:\n"""${String(message || "").slice(0, 600)}"""`,
    {
      system: "You are the Elecbits ULM assistant, guiding an admin through creating & sanctioning an electronics project (ODM / box build / product). Warm, sharp, brief — like Claude. Use real domain knowledge (manufacturing, PCBs, certification, timelines) when they ask questions. Never invent register data, client records or IDs — those come from Drive, not you.",
      schema, maxTokens: 800, effort: "low",
    },
  );
}

/* 2. Guessing the two ID codes so nobody scans 42 chips ────────────────────
   The industry and org-size codes are what the Client ID is built from, so a
   good guess up front saves the real work: the user still confirms.         */
export async function suggestClientProfile({ clientName, industries, sizes, contact = "", note = "" }) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["industryCode", "sizeCode", "why", "confidence"],
    properties: {
      industryCode: { type: "string", enum: industries.map((i) => i.code) },
      sizeCode: { type: "string", enum: sizes.map((s) => s.code) },
      why: { type: "string", description: "One sentence, max 25 words, on what the company does and why these two codes fit." },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
  };
  return claude(
    `Company: "${clientName}"${contact ? `\nContact: ${contact}` : ""}${note ? `\nNote: ${note}` : ""}\n\n` +
    `INDUSTRY CODES\n${industries.map((i) => `${i.code} ${i.label}`).join("\n")}\n\n` +
    `ORGANISATION SIZE CODES\n${sizes.map((s) => `${s.code} ${s.label}`).join("\n")}\n\n` +
    `Pick the one industry code and the one size code Elecbits should file this client under. If you do not recognise the company, say so with confidence "low" and pick the closest plausible codes.`,
    {
      system: "You classify prospective clients for Elecbits, an Indian electronics ODM. Be honest about what you do not know — a low-confidence guess the user can correct beats a confident wrong one.",
      schema, maxTokens: 900, effort: "low",
    },
  );
}

/* 3. Turning a paragraph into the 21-question customer LLD ─────────────────
   The questionnaire is the hard gate, but clients rarely answer it in that
   order — they send a paragraph. This fans that paragraph out across the
   questions and leaves everything it cannot support as TBD.                 */
export async function extractLld({ description, questions, projectName = "", kind = "" }) {
  const props = {};
  questions.forEach((q) => {
    props[q.id] = q.type === "chips"
      ? { type: "string", description: `${q.text} Answer with ${q.multi ? "one or more of these, comma separated" : "exactly one of these"}: ${q.chips.join(" | ")} — or TBD.` }
      : { type: "string", description: `${q.text}${q.hint ? ` (${q.hint})` : ""} — or TBD.` };
  });
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["answers", "summary"],
    properties: {
      answers: { type: "object", additionalProperties: false, required: questions.map((q) => q.id), properties: props },
      summary: { type: "string", description: "Max 30 words: what was understood, and the biggest thing still missing." },
    },
  };
  return claude(
    `PROJECT: ${projectName || "(unnamed)"}${kind ? ` · ${kind}` : ""}\n\nWhat the client told us:\n"""${String(description || "").slice(0, 6000)}"""\n\nFill in the low-level-design questionnaire from this. Answer a question ONLY from what the text says or unmistakably implies. Everything else is exactly "TBD" — a wrong answer here reaches an engineer as fact.`,
    {
      system: "You are Elecbits' solution architect capturing a customer LLD. Be conservative: TBD is the correct answer far more often than a plausible guess.",
      schema, maxTokens: 4000, effort: "medium",
    },
  );
}

/* 4. The designer LLD — the internal engineering spec ──────────────────────*/
export const designerSystem =
  "You are Elecbits' senior solution architect. Elecbits is an Indian electronics ODM: designs are built for Indian sourcing (prefer parts with Indian distribution), BIS applies to most consumer products, and cost targets are usually in ₹. Write for the engineer who will build this, not for the client.";

export const designerPrompt = (ctx) => {
  const { customerLLD, projectName, kind, clientName, industry, deadline, team } = ctx;
  return `Write the DESIGNER LLD for this project.

PROJECT     ${projectName}
CLIENT      ${clientName || "—"}${industry ? ` · ${industry}` : ""}
ROUTE       ${kind}
DEADLINE    ${deadline || "not set"}
TEAM        ${team || "not allocated"}

CUSTOMER LLD
${String(customerLLD || "").slice(0, 6000)}

Sections, in this order:
1 System architecture (block diagram in text, signal + power paths named)
2 Hardware blocks & component direction (name real parts with an alternate each, and say why)
3 Firmware architecture (RTOS vs bare-metal, task list, OTA, provisioning, diagnostics)
4 Enclosure & mechanical
5 Interfaces & connectivity (with antenna and certification impact)
6 Power budget (rails, worst-case draw per mode, battery sizing where it applies)
7 Test & compliance hooks (test points, programming header, self-test, pre-scans)
8 Open questions for the client — every TBD from the customer LLD, each with an owner

Rules: an engineer must be able to start work from this without asking a question. Where the customer LLD says TBD, state the assumption you are designing against and put the question in section 8 — never quietly invent a requirement. Plain text with those numbered headings, no preamble.`;
};

export const fallbackDesigner = (projectName, kind) =>
  `DESIGNER LLD — ${projectName} (${kind})

1. SYSTEM ARCHITECTURE
   [Main controller] ↔ [sensors/inputs] ↔ [outputs/actuators] ↔ [connectivity] ↔ [power]
   — draw the block diagram from the customer LLD answers before design starts.

2. HARDWARE BLOCKS & COMPONENT DIRECTION
   - MCU/SoC: choose against the connectivity + compute needs (note alternates).
   - Sensors / inputs: one line per block, interface named (I2C/SPI/ADC…).
   - Outputs: driver strategy per actuator.

3. FIRMWARE ARCHITECTURE
   - RTOS vs bare-metal, OTA strategy, provisioning & diagnostics command set.

4. ENCLOSURE & MECHANICAL
   - Route per customer answer (off-the-shelf / printed / moulded), IP target,
     mounting, connector cutouts, thermal path.

5. INTERFACES & CONNECTIVITY
   - Protocol list with roles; antenna strategy; certification impact.

6. POWER BUDGET
   - Source, rails, worst-case draw per mode, battery sizing if applicable.

7. TEST & COMPLIANCE HOOKS
   - Test points, programming header, self-test plan, cert pre-scans.

8. OPEN QUESTIONS FOR THE CLIENT
   - List every TBD from the customer LLD here with an owner and a date.

(Offline template — edit every section against the customer LLD, then accept.)`;
