/* ─── claude-agent — Claude with Drive hands, Supabase edition ───────────────
   The Assistant's agentic loop: Claude runs HERE (key in Supabase secrets),
   and each Drive tool call is executed by the Apps Script web app's tool.run
   action — Drive access stays with the Google account, Anthropic stays with
   Supabase, the browser holds neither key.

   Deploy:   supabase functions deploy claude-agent
   Secrets:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
             supabase secrets set ULM_DRIVE_URL=https://script.google.com/macros/s/…/exec
             supabase secrets set ULM_DRIVE_TOKEN=…            (the SHARED_TOKEN)
   Keep "Enforce JWT verification" ON — the portal sends its anon key.

   POST { messages: [{role, content}…] } →
        { ok, text, trace: [{tool, detail, ok}…], rounds, partial? }         */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const MODEL = "claude-opus-5";
const MAX_ROUNDS = 8;
const TIME_BUDGET_MS = 100_000; // leave headroom under the platform's wall clock

/* The same five tools the Apps Script agent defines — the schemas live here
   because Claude is prompted from here; execution happens over there. */
const TOOLS = [
  {
    name: "drive_search",
    description: "Search Google Drive by file name and by full text. Returns up to maxResults files with fileId, name, mimeType, url, folder and modified time. Use short distinctive queries (a project id like 'EbX-22-PL-03-47', a doc name fragment).",
    input_schema: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "integer" } }, required: ["query"] },
  },
  {
    name: "drive_list",
    description: "List the sub-folders and files directly inside one Drive folder.",
    input_schema: { type: "object", properties: { folderId: { type: "string" } }, required: ["folderId"] },
  },
  {
    name: "drive_read",
    description: "Read a file's content as text. Google Docs → body text; Google Sheets → up to 5 tabs, 200 rows each, tab-separated; text/csv/json → raw. Binary files return metadata only.",
    input_schema: { type: "object", properties: { fileId: { type: "string" }, maxChars: { type: "integer" } }, required: ["fileId"] },
  },
  {
    name: "drive_write",
    description: "Write a Google Doc. Give fileId to update an existing Doc (mode 'append' adds at the end — the default; 'replace' overwrites the whole body, use only when asked to rewrite). Or give title (+ folderId) to create a new Doc. Returns the doc's url.",
    input_schema: { type: "object", properties: { fileId: { type: "string" }, mode: { type: "string", enum: ["append", "replace"] }, title: { type: "string" }, folderId: { type: "string" }, content: { type: "string" } }, required: ["content"] },
  },
  {
    name: "register_read",
    description: "Read one of the Elecbits ID registers as rows: 'clients', 'projects' or 'pcbs'. The source of truth for IDs — use it instead of hunting the sheets by hand.",
    input_schema: { type: "object", properties: { register: { type: "string", enum: ["clients", "projects", "pcbs"] } }, required: ["register"] },
  },
];

const SYSTEM = [
  "You are the Elecbits ULM assistant with live Google Drive access through tools. Elecbits is an Indian electronics ODM; this Drive holds its client/project registers, project-management folders and PCB & firmware folders.",
  "Ways of working: find a project's folder by searching its Project ID. Use register_read for anything about IDs, clients or projects before searching raw files. When you create or edit a doc, put it in the right project folder and ALWAYS give the user the link. Never overwrite a doc body (mode replace) unless the user asked for a rewrite. Be concise; short paragraphs or tight lists; links inline.",
].join("\n");

async function runTool(name: string, input: unknown): Promise<unknown> {
  const url = (Deno.env.get("ULM_DRIVE_URL") || "").trim();
  const token = (Deno.env.get("ULM_DRIVE_TOKEN") || "").trim();
  if (!url || !token) return { error: "ULM_DRIVE_URL / ULM_DRIVE_TOKEN secrets are not set on this function" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token, action: "tool.run", name, input }),
      redirect: "follow",
    });
    const body = await res.json().catch(() => null);
    if (!body) return { error: `Drive backend answered HTTP ${res.status} without JSON` };
    if (!body.ok) return { error: body.error || "Drive tool failed" };
    return body.result;
  } catch (e) {
    return { error: `Could not reach the Drive backend: ${(e as Error).message}` };
  }
}

const detailOf = (name: string, input: Record<string, unknown>, out: Record<string, unknown>): string =>
  String(
    name === "drive_search" ? input?.query
    : name === "drive_list" ? out?.folder ?? input?.folderId
    : name === "drive_read" ? out?.name ?? input?.fileId
    : name === "drive_write" ? input?.title ?? out?.name ?? input?.fileId
    : name === "register_read" ? input?.register
    : "" ?? "",
  );

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const key = (Deno.env.get("ANTHROPIC_API_KEY") || "").trim();
  if (req.method === "GET") {
    return json({ ok: true, keySet: Boolean(key), driveSet: Boolean(Deno.env.get("ULM_DRIVE_URL") && Deno.env.get("ULM_DRIVE_TOKEN")) });
  }
  if (!key) return json({ ok: false, error: "ANTHROPIC_API_KEY is not set on this function's secrets" });

  let body: { messages?: { role?: string; content?: unknown }[]; prompt?: string; effort?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "POST JSON { messages }" }, 400); }

  // History from the browser is text only — content blocks are minted here.
  let messages: { role: string; content: unknown }[] =
    Array.isArray(body.messages) && body.messages.length
      ? body.messages.slice(-20).map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(typeof m.content === "string" ? m.content : "").slice(0, 8000) || "…",
        }))
      : body.prompt ? [{ role: "user", content: String(body.prompt) }] : [];
  if (!messages.length) return json({ ok: false, error: "ai.agent needs messages or a prompt" });

  const started = Date.now();
  const trace: { tool: string; detail: string; ok: boolean }[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: body.effort || "medium" },
        system: SYSTEM, tools: TOOLS, messages,
      }),
    });
    const out = await res.json().catch(() => null);
    if (!res.ok || !out) return json({ ok: false, error: out?.error?.message || `Anthropic HTTP ${res.status}`, trace });
    if (out.usage) { usage.input_tokens += out.usage.input_tokens || 0; usage.output_tokens += out.usage.output_tokens || 0; }
    if (out.stop_reason === "refusal") return json({ ok: false, refusal: true, error: "Claude declined this request.", trace });

    const toolUses = (out.content || []).filter((c: { type: string }) => c.type === "tool_use");
    const text = (out.content || []).filter((c: { type: string }) => c.type === "text")
      .map((c: { text?: string }) => c.text || "").join("").trim();

    if (out.stop_reason !== "tool_use" || !toolUses.length) {
      return json({ ok: true, text, trace, rounds: round, usage });
    }

    messages.push({ role: "assistant", content: out.content }); // thinking blocks included — the API wants them back
    const results = [];
    for (const tu of toolUses) {
      const result = await runTool(tu.name, tu.input || {});
      const r = result as Record<string, unknown>;
      trace.push({ tool: tu.name, detail: detailOf(tu.name, tu.input || {}, r || {}).slice(0, 80), ok: !r?.error });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 40000) });
    }
    messages.push({ role: "user", content: results });

    if (Date.now() - started > TIME_BUDGET_MS) {
      return json({ ok: true, partial: true, trace, rounds: round, usage,
        text: text || "I ran out of time mid-task — the tool calls above did run; ask me to continue." });
    }
  }
  return json({ ok: true, partial: true, trace, rounds: MAX_ROUNDS, usage,
    text: "I hit the round limit before finishing — ask me to continue from here." });
});
