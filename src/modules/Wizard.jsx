/* ─── Create a Project — the chat wizard ─────────────────────────────────────
   The ODM app's chat-guided creation flow, extended with ULM's bifurcation
   step (ODM / Box Build / Product) and real Drive provisioning at the end:

     client lookup → Client ID (industry + org-size codes, registered in the
     Drive client register) → contact → project name → delivery route →
     deadline → Project ID (Drive project register) → team allocation →
     Customer LLD → Designer LLD → review → CREATE: DB row sanctioned through
     ulm.decide(), template folder replicated & renamed to the Project ID,
     template links written into the process-map sheet in the new folder.

   Three hard gates — Project ID, Customer LLD, Designer LLD — and Create
   stays locked until those, a PM and a deadline are all green.               */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Sparkles, Upload, FolderOpen, Link2, ExternalLink, Shield, CheckCircle2, AlertTriangle, Bot, FileText, Wand2 } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, Field, Seg, KV, MD, TypingDots, chipS, Done, ChoiceCard, uid, sleep, todayStr, fmtDate } from "../ui.jsx";
import { MONO, INDUSTRY_CODES, ORG_SIZES, TEAM_SLOTS, KINDS, kindOf, LLD_QUESTIONS, makeClientId, makeProjectId, seqOf, pad2 } from "../constants.js";
import { driveConfigured, driveRegisterClient, driveRegisterProject, driveProvisionProject, driveNextIds, driveSearchClients } from "../lib/ulmDrive.js";
import { aiProbe, claude, interpretMessage, extractProjectBrief, suggestClientProfile, extractLld, designerSystem, designerPrompt, fallbackDesigner } from "../lib/ai.js";

const PHASES = ["Client", "Contact", "Project", "ID", "Team", "LLD — Customer", "LLD — Designer", "Review"];
const phaseOf = (step) => ({ client: 0, industry: 0, orgsize: 0, clientid: 0, contact: 1, pname: 2, pdesc: 2, kind: 2, deadline: 2, pid: 3, team: 4, lldc: 5, lldq: 5, lldsum: 5, lldd: 6, review: 7, provision: 7, done: 7 }[step] ?? 0);

const normId = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Widget steps that also accept typed input once Claude is on. */
const TYPED_PH = {
  industry: "Type the industry, ask a question — or tap a chip",
  orgsize: "e.g. \"they're a small startup\" — or tap an option",
  kind: "e.g. \"they just need assembly\" — or tap a card",
  deadline: "e.g. \"mid October\" or 2026-10-15 — or tap",
};

/* Greeting / intent chatter that is definitely not a company name — the
   no-AI guard for the client step. */
const looksLikeChatter = (t) =>
  /^(hi|hey|hello|yo|ok|okay|yes|namaste)\b/i.test(t) ||
  /\b(new client|new project|create a|i have a|i want|help me|let'?s start)\b/i.test(t);

export default function WizardModule({ onOpenProject }) {
  const ulm = useUlm();
  const { people, orgs, projects, isAdmin, me, toast, createClient, createProject, saveProvisioning } = ulm;

  const [msgs, setMsgs] = useState([]);
  const [step, setStep] = useState("boot");
  const [inputOn, setInputOn] = useState(false);
  const [ph, setPh] = useState("Type here…");
  const [val, setVal] = useState("");
  const [typing, setTyping] = useState(false);
  const [lldQ, setLldQ] = useState(0);
  const stepRef = useRef(step); stepRef.current = step;
  const bodyRef = useRef(null);
  /* Claude on? Probed once — the Drive backend answers whether its
     ANTHROPIC_API_KEY is actually set, so the buttons never promise AI that
     is not there. A ref mirror keeps the value visible inside go()'s closure. */
  const [aiOn, setAiOn] = useState(false);
  const [aiNote, setAiNote] = useState("checking…");
  const aiOnRef = useRef(false);
  useEffect(() => {
    aiProbe().then((r) => {
      aiOnRef.current = !!r.ok; setAiOn(!!r.ok);
      setAiNote(r.ok ? `${r.model} via ${r.via}` : (r.error || "not configured"));
    }).catch(() => setAiNote("probe failed"));
  }, []);
  /* The message id of the currently open widget, so a typed answer can freeze
     the same card a click would have. */
  const lastWidgetId = useRef(null);
  const d = useRef({ clientName: "", industry: null, orgSize: null, clientId: "", existingClient: false, contact: { name: "", designation: "", phone: "", email: "" }, name: "", desc: "", descDone: false, kind: "", deadline: "", projectId: "", idMode: "auto", team: [], lldC: null, lldD: null, lldAnswers: {}, ownerId: "", clientRegisterUrl: "", projectRegisterUrl: "" }).current;

  useEffect(() => { bodyRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, typing]);

  const push = (m) => setMsgs((x) => [...x, { id: uid(), ...m }]);
  const sys = useCallback(async (text, widget, sub, extra) => {
    setTyping(true); await sleep(280); setTyping(false);
    const id = uid();
    if (widget) lastWidgetId.current = id;
    push({ id, who: "sys", text, widget, sub, ...extra });
  }, []);
  const meMsg = (text) => push({ who: "me", text });
  const freeze = (id, summary) => setMsgs((x) => x.map((m) => (m.id === id ? { ...m, widget: null, frozen: summary } : m)));
  const status = (text, tone = "green") => push({ who: "sys", statusTone: tone, text });

  const go = useCallback(async (s) => {
    setStep(s); setInputOn(false); setVal("");
    switch (s) {
      case "client": await sys("Hi! I'm the Elecbits ULM assistant — let's create and sanction a new project. **What is the client / company name?**" + (aiOnRef.current ? " Or just brain-dump everything you know — client, project, route, deadline, contact — in one message and I'll fill the form." : "")); setInputOn(true); setPh(aiOnRef.current ? "A name, or the whole brief in one go…" : "e.g. Acme Devices"); break;
      case "industry": await sys(`**${d.clientName}** is new — let's mint their Client ID. Pick the industry.`, "industry"); break;
      case "orgsize": await sys("And the organisation size?", "orgsize"); break;
      case "clientid": await sys("Here is the Client ID. It gets registered in the **client register in Drive** when the project is created.", "clientid"); break;
      case "contact": await sys("**Who is the contact for this project?** Name is required.", "contact"); break;
      case "pname": await sys("**What is the project called?**"); setInputOn(true); setPh("e.g. ESP32 Air-Quality Monitor"); break;
      case "pdesc": await sys("One line on what we're building? (or type `skip`)"); setInputOn(true); setPh("What it is, for whom"); break;
      case "kind": await sys("**Which delivery route owns this project?** This is the ULM bifurcation — it decides which PMS tool the sanctioned project lands in.", "kind"); break;
      case "deadline": await sys("**When is the deadline?**", "deadline"); break;
      case "pid": await sys("**Project ID** — a hard gate. Auto-generate the next in sequence, or enter one manually. It is registered in the **project register in Drive** and becomes the name of the project folder.", "pid"); break;
      case "team": await sys("**Allocate the team.** A PM is mandatory — the Senior PM (or the PM, if no senior is picked) becomes the delivery owner of the sanctioned project.", "team"); break;
      case "lldc": await sys("**Customer LLD** — a hard gate: no customer LLD, no project. Capture it through the guided questionnaire, or paste / upload it.", "lldc"); break;
      case "lldq": { const q = LLD_QUESTIONS[0]; setLldQ(0); await askLld(q, 0); break; }
      case "lldsum": { const answered = LLD_QUESTIONS.filter((q) => d.lldAnswers[q.id] && d.lldAnswers[q.id] !== "TBD").length; d.lldC = { mode: "chat", answers: { ...d.lldAnswers }, text: composeLLDText(), fileName: "" }; await sys(`Customer LLD captured — **${answered}/${LLD_QUESTIONS.length} answered**, the rest marked TBD.`, "lldsumw"); break; }
      case "lldd": await sys("**Designer LLD** — the internal engineering spec, also a hard gate. Generate it from the customer LLD" + (aiOnRef.current ? " with AI" : " from the offline template") + ", or paste it manually.", "lldd"); break;
      case "review": await sys("**Review everything before it becomes real.**", "review"); break;
      case "done": await sys("All set. The project is live in the portal — allocate more people, add **PCB-ID folders** (one per board, into the PCB & Firmware area), or re-run Drive provisioning from its detail page any time.", "donew"); break;
      default: break;
    }
    // With Claude on, the widget steps also take typed answers — "they're a
    // small startup", "mid october", "which route is for assembly-only?" all
    // land somewhere sensible instead of the input sitting disabled.
    if (aiOnRef.current && TYPED_PH[s]) { setInputOn(true); setPh(TYPED_PH[s]); }
  }, [sys]);

  const askLld = async (q, idx) => {
    const head = `**Q${idx + 1}/${LLD_QUESTIONS.length} · ${q.sec}** — ${q.text}`;
    if (q.type === "chips") { await sys(head, "lldchips", q.hint, { qIdx: idx }); }
    else { await sys(head, null, q.hint); setInputOn(true); setPh(q.hint || "Type the answer (or `skip`)"); }
  };
  const nextLld = async (idx) => {
    const n = idx + 1;
    if (n >= LLD_QUESTIONS.length) { go("lldsum"); return; }
    setLldQ(n); await askLld(LLD_QUESTIONS[n], n);
  };
  const composeLLDText = () => LLD_QUESTIONS.map((q) => `${q.sec} — ${q.text}\n→ ${Array.isArray(d.lldAnswers[q.id]) ? d.lldAnswers[q.id].join(", ") : d.lldAnswers[q.id] || "TBD"}`).join("\n");

  const booted = useRef(false);
  useEffect(() => {
    // Let the AI probe land (capped) before the greeting, so the opening
    // message can honestly offer the brain-dump path.
    if (isAdmin && !booted.current) { booted.current = true; Promise.race([aiProbe().catch(() => {}), sleep(1500)]).then(() => go("client")); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  /* ── the conversational layer ─────────────────────────────────────────
     One Claude read of the typed message against the pending step: a pick
     advances the wizard exactly like the click would have, an answer fills
     the field, a question gets a real answer and the step re-asked.       */
  /* The first pre-ID step still unanswered — the brain-dump path skips
     everything already captured and only asks what's missing. */
  const nextMissing = () => {
    if (!d.contact?.name) return "contact";
    if (!d.name) return "pname";
    if (!d.descDone) return "pdesc";
    if (!d.kind) return "kind";
    if (!d.deadline) return "deadline";
    return "pid";
  };
  /* A new client's ID needs the two codes first. */
  const nextNewClientStep = () => (!d.industry ? "industry" : !d.orgSize ? "orgsize" : "clientid");

  const dataSummary = () => [
    d.clientName && `client ${d.clientName}`, d.industry && `industry ${d.industry.label}`,
    d.orgSize && `org size ${d.orgSize.label}`, d.name && `project "${d.name}"`,
    d.kind && `route ${d.kind}`, d.deadline && `deadline ${d.deadline}`,
  ].filter(Boolean).join(" · ");

  const applyPick = {
    industry: (code) => { const i = INDUSTRY_CODES.find((x) => x.code === code); if (!i) return false; d.industry = i; freeze(lastWidgetId.current, `${i.label} (${i.code})`); go("orgsize"); return true; },
    orgsize: (code) => { const o = ORG_SIZES.find((x) => x.code === code); if (!o) return false; d.orgSize = o; d.clientId = ""; freeze(lastWidgetId.current, `${o.label} (${o.code})`); go("clientid"); return true; },
    kind: (code) => { const k = KINDS.find((x) => x.k === code); if (!k) return false; d.kind = k.k; freeze(lastWidgetId.current, k.full); go(nextMissing()); return true; },
  };

  const SMART_STEPS = {
    industry: { q: "Which industry is this client in?", options: () => INDUSTRY_CODES.map((i) => ({ code: i.code, label: i.label })) },
    orgsize: { q: "What size of organisation is the client?", options: () => ORG_SIZES.map((o) => ({ code: o.code, label: o.label })) },
    kind: { q: "Which delivery route owns this project — the ULM bifurcation?", options: () => KINDS.map((k) => ({ code: k.k, label: `${k.full} (${k.tool})` })) },
    deadline: { q: "When is the project deadline?", date: true },
    pname: { q: "What is the project called?" },
    pdesc: { q: "One line on what we're building?" },
  };

  const smartRoute = async (s, v) => {
    const cfg = SMART_STEPS[s];
    if (!cfg || !aiOnRef.current) return false;
    setTyping(true);
    let r;
    try {
      r = await interpretMessage({ step: s, question: cfg.q, options: cfg.options?.(), date: cfg.date, data: dataSummary(), message: v });
    } catch { setTyping(false); return false; }
    setTyping(false);
    if (r.kind === "pick" && r.value && applyPick[s]?.(String(r.value).trim())) return true;
    if (r.kind === "answer" && r.value) {
      const value = String(r.value).trim();
      if (s === "deadline") {
        const iso = value.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && iso >= todayStr()) {
          d.deadline = iso; freeze(lastWidgetId.current, fmtDate(iso)); go("pid"); return true;
        }
      } else if (s === "pname") { d.name = value; go(nextMissing()); return true; }
      else if (s === "pdesc") { d.desc = value; d.descDone = true; go(nextMissing()); return true; }
    }
    // A question or chat — speak Claude's reply, keep the step open.
    await sys(r.reply || "Tell me a bit more?");
    setInputOn(true); setPh(TYPED_PH[s] || "Type here…");
    return true;
  };

  const handleSend = async () => {
    const v = val.trim();
    if (!v) return;
    setVal(""); setInputOn(false); meMsg(v);
    const s = stepRef.current;
    if (s === "client") {
      let name = v;
      // "hi i have new client" is not a company called that. Without Claude,
      // catch the obvious chatter and just re-ask for the name.
      if (!aiOnRef.current && looksLikeChatter(v)) {
        await sys("Got it — I just need the **company's name** to start. What is the client called?");
        setInputOn(true); setPh("e.g. Acme Devices");
        return;
      }
      // With Claude: anything that reads like a sentence, question or greeting
      // goes through the brief extractor — it pulls out the client AND every
      // other fact in the message (project, route, deadline, contact), so a
      // full brain-dump fills the form in one go.
      if (aiOnRef.current && (v.split(/\s+/).length > 3 || /[?!]/.test(v) || looksLikeChatter(v))) {
        setTyping(true);
        try {
          const r = await extractProjectBrief({ text: v, industries: INDUSTRY_CODES, sizes: ORG_SIZES, kinds: KINDS });
          setTyping(false);
          if (r.industryCode) d.industry = INDUSTRY_CODES.find((x) => x.code === r.industryCode) || d.industry;
          if (r.sizeCode) d.orgSize = ORG_SIZES.find((x) => x.code === r.sizeCode) || d.orgSize;
          if (r.projectName) d.name = String(r.projectName).trim();
          if (r.description) { d.desc = String(r.description).trim(); d.descDone = true; }
          if (r.kind && kindOf(r.kind)) d.kind = r.kind;
          if (r.deadline && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) && r.deadline >= todayStr()) d.deadline = r.deadline;
          if (r.contactName) d.contact = { ...d.contact, name: String(r.contactName).trim(), email: r.contactEmail || d.contact.email, phone: r.contactPhone || d.contact.phone };
          const got = [
            r.projectName && `project “${d.name}”`, r.kind && kindOf(d.kind)?.label,
            r.deadline && d.deadline && `deadline ${fmtDate(d.deadline)}`, r.contactName && `contact ${d.contact.name}`,
          ].filter(Boolean);
          if (got.length) await sys(`Captured: ${got.join(" · ")} — I'll skip what's already answered.`);
          if (!r.clientName) {
            await sys(r.reply || "I still need the client / company name — what is it?");
            setInputOn(true); setPh("e.g. Acme Devices");
            return;
          }
          name = String(r.clientName).trim();
        } catch { setTyping(false); /* treat the raw text as the name */ }
      }
      d.clientName = name;
      // The register in Drive is the client list of record — search it, then
      // fall back to whatever the database mirror holds.
      let found = null;
      if (driveConfigured) {
        const res = await driveSearchClients(name);
        if (res.ok && res.matches?.length) {
          const exact = res.matches.find((m) => m.name.toLowerCase().trim() === name.toLowerCase().trim());
          if (exact) found = exact;
          else if (res.matches.length <= 6) {
            await sys(`No exact match for **${name}**. The register has ${res.matches.length} similar: ${res.matches.map((m) => `**${m.name}** (${m.clientId})`).join(", ")}. Type the exact name to reuse one, or continue to create a new client.`, null, "searching the Client-ID register in Drive");
            d.nearMatches = res.matches;
          }
        }
      }
      if (!found) {
        const local = orgs.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (local) found = { clientId: local.clientId, name: local.name, industry: local.industry, orgSize: local.orgSize, seq: seqOf(local.clientId) };
      }
      if (found) {
        d.clientId = found.clientId; d.existingClient = true; d.clientSeq = found.seq;
        d.industry = INDUSTRY_CODES.find((i) => i.label === found.industry) || d.industry;
        d.orgSize = ORG_SIZES.find((o) => o.label === found.orgSize) || d.orgSize;
        await sys(`Found **${found.name}** in the client register — reusing Client ID **${found.clientId}**.`);
        go(nextMissing());
      } else if (!d.nearMatches) go(nextNewClientStep());
      else { d.nearMatches = null; setInputOn(true); setPh("Exact name to reuse, or a new name"); }
    } else if (s === "industry" || s === "orgsize" || s === "kind" || s === "deadline") {
      const handled = await smartRoute(s, v);
      if (!handled) {
        await sys("I couldn't reach Claude just now — use the options above.");
        setInputOn(true); setPh(TYPED_PH[s] || "Type here…");
      }
    } else if (s === "pname") {
      // A whole sentence probably wraps the name ("we're calling it Falcon").
      if (aiOnRef.current && (v.split(/\s+/).length > 5 || /\?/.test(v))) { if (await smartRoute("pname", v)) return; }
      d.name = v; go(nextMissing());
    } else if (s === "pdesc") {
      if (aiOnRef.current && /\?/.test(v)) { if (await smartRoute("pdesc", v)) return; }
      d.desc = v.toLowerCase() === "skip" ? "" : v; d.descDone = true; go(nextMissing());
    } else if (s === "lldq") {
      const q = LLD_QUESTIONS[lldQ];
      // Ending in "?" reads as a question about the question — answer it and
      // keep the same LLD question open.
      if (aiOnRef.current && /\?$/.test(v)) {
        setTyping(true);
        try {
          const a = await claude(
            `A user is filling Elecbits' customer-LLD questionnaire. Current question: "${q.text}"${q.hint ? ` (hint: ${q.hint})` : ""}. They asked: "${v}". Answer helpfully with real electronics knowledge in under 60 words, then invite them to answer (or type skip).`,
            { maxTokens: 500, effort: "low" },
          );
          setTyping(false); await sys(a); setInputOn(true); setPh(q.hint || "Type the answer (or `skip`)");
          return;
        } catch { setTyping(false); /* fall through — record it as the answer */ }
      }
      d.lldAnswers[q.id] = v.toLowerCase() === "skip" ? "TBD" : v;
      await nextLld(lldQ);
    }
  };

  /* ── ID allocation ────────────────────────────────────────────────────
     The register sheets are the allocator of record, so both ids are read
     from Drive. Offline (no Drive backend) we continue the highest sequence
     visible in the database mirror instead — same format either way.      */
  const localNextClientSeq = () =>
    Math.max(0, ...orgs.map((o) => seqOf(o.clientId)).filter((n) => !isNaN(n))) + 1;
  const localNextProjectSeq = () =>
    Math.max(0, ...projects.map((p) => seqOf(p.projectId)).filter((n) => !isNaN(n))) + 1;

  const allocateIds = async () => {
    if (driveConfigured) {
      const res = await driveNextIds({
        industryCode: d.industry?.code, sizeCode: d.orgSize?.code,
        clientName: d.clientName, clientId: d.existingClient ? d.clientId : "",
      });
      if (res.ok) {
        if (!d.existingClient) d.clientId = res.clientId;
        d.clientSeq = res.clientSeq;
        d.projectId = res.projectId;
        d.projectSeq = res.projectSeq;
        d.lastProjectId = res.lastProjectId;
        d.fromRegister = true;
        return res;
      }
      d.registerError = res.error;
    }
    // Offline fallback — same scheme, sequences from what we can see.
    d.clientSeq = d.existingClient ? seqOf(d.clientId) : localNextClientSeq();
    if (!d.existingClient) d.clientId = makeClientId(d.industry.code, d.orgSize.code, d.clientSeq);
    d.projectSeq = localNextProjectSeq();
    d.projectId = makeProjectId(d.industry.code, d.orgSize.code, d.clientSeq, d.projectSeq);
    d.fromRegister = false;
    return null;
  };

  /* ── the CREATE + PROVISION sequence ─────────────────────────────────── */
  const [creating, setCreating] = useState(false);
  const runCreate = async (msgId) => {
    setCreating(true);
    freeze(msgId, "Project created");
    const owner = d.team.find((t) => t.slot.startsWith("Senior PM"))?.userId || d.team.find((t) => t.slot.startsWith("PM"))?.userId || null;
    d.ownerId = owner;
    let proj = null;
    try {
      status(`Creating **${d.projectId}** and sanctioning it as **${kindOf(d.kind)?.label}** through ulm.decide()…`, "blue");
      if (!d.existingClient && d.clientId) {
        await createClient({ clientId: d.clientId, name: d.clientName, industry: d.industry?.label || "", orgSize: d.orgSize?.label || "", contact: d.contact });
      }
      proj = await createProject({
        projectId: d.projectId, idMode: d.idMode, name: d.name, desc: d.desc, kind: d.kind,
        clientId: d.clientId, clientName: d.clientName, industry: d.industry?.label || "", orgSize: d.orgSize?.label || "",
        contact: d.contact, deadline: d.deadline, team: d.team,
        lldCustomer: d.lldC, lldDesigner: d.lldD, ownerId: owner, sanction: true,
      });
      status(`**${d.projectId}** created — sanctioned ${kindOf(d.kind)?.label}, routed to ${kindOf(d.kind)?.tool}.`, "green");
    } catch (e) {
      status(`Could not create the project: ${e.message}`, "red");
      setCreating(false);
      return;
    }

    /* Drive provisioning — the registers, the folder, the process map. */
    if (driveConfigured) {
      const prov = { status: "provisioned" };
      try {
        if (!d.existingClient) {
          status("Registering the client in the **Client-ID register** (Drive)…", "blue");
          const rc = await driveRegisterClient({ clientId: d.clientId, name: d.clientName, industry: d.industry?.label, industryCode: d.industry?.code, orgSize: d.orgSize?.label, sizeCode: d.orgSize?.code, contact: d.contact?.name, designation: d.contact?.designation, email: d.contact?.email, phone: d.contact?.phone, by: people.find((p) => p.id === me)?.name || "" });
          if (rc.ok) { prov.clientRegisterUrl = rc.registerUrl; d.clientRegisterUrl = rc.registerUrl; status(`Client **${d.clientId}** appended to the register.`, "green"); }
          else throw new Error(rc.error);
        }
        status("Registering the project in the **Project-ID register** (Drive)…", "blue");
        const rp = await driveRegisterProject({ projectId: d.projectId, name: d.name, clientId: d.clientId, clientName: d.clientName, contact: d.contact?.name, kind: kindOf(d.kind)?.label || d.kind, desc: d.desc, status: "Planning", deadline: d.deadline, by: people.find((p) => p.id === me)?.name || "" });
        if (rp.ok) { prov.projectRegisterUrl = rp.registerUrl; d.projectRegisterUrl = rp.registerUrl; status(`Project **${d.projectId}** appended to the register.`, "green"); }
        else throw new Error(rp.error);

        status("Replicating the **template folder** → renaming it to the Project ID → linking the template library into the **process-map sheet**…", "blue");
        const pv = await driveProvisionProject({ projectId: d.projectId });
        if (!pv.ok) throw new Error(pv.error);
        prov.folderId = pv.folderId; prov.folderUrl = pv.folderUrl;
        prov.filesCopied = pv.copied; prov.foldersCopied = pv.folders;
        prov.processMapUrl = pv.processMap?.sheetUrl || "";
        prov.templatesLinked = pv.processMap?.updated ?? null;
        status(`Folder **${d.projectId}** ready — ${pv.copied ?? 0} files / ${pv.folders ?? 0} folders copied, **${pv.processMap?.updated ?? 0} template links** written into the process map.`, "green");
      } catch (e) {
        prov.status = "failed"; prov.error = e.message;
        status(`Drive provisioning failed: ${e.message} — you can retry from the project's detail page.`, "red");
      }
      try { await saveProvisioning(proj, prov); } catch (e) { status(`Could not record provisioning: ${e.message}`, "amber"); }
      d.folderUrl = prov.folderUrl; d.processMapUrl = prov.processMapUrl;
    } else {
      status("Drive backend not configured — folder replication, registers and the process-map links are **pending**. Deploy google-apps-script/ulm-drive.gs and set VITE_ULM_DRIVE_URL to switch this on; then retry from the project page.", "amber");
      try { await saveProvisioning(proj, { status: "skipped", error: "Drive backend not configured" }); } catch { /* demo */ }
    }

    toast(`Project ${d.projectId} created`, "green");
    d.createdProjectRef = proj;
    setCreating(false);
    go("done");
  };

  /* ── widgets ─────────────────────────────────────────────────────────── */

  const IndustryW = ({ m }) => {
    /* Claude guesses both codes from the company name; the user confirms with
       one click or ignores it and picks from the chips as before. The guess
       is kept on `d` so a re-render never refetches. */
    const [sug, setSug] = useState(d.aiProfile || null);
    const [thinking, setThinking] = useState(false);
    useEffect(() => {
      if (!aiOn || d.aiProfile || d.aiProfileFailed) return;
      let alive = true;
      setThinking(true);
      suggestClientProfile({ clientName: d.clientName, industries: INDUSTRY_CODES, sizes: ORG_SIZES, contact: d.contact?.name })
        .then((r) => { d.aiProfile = r; if (alive) { setSug(r); setThinking(false); } })
        .catch(() => { d.aiProfileFailed = true; if (alive) setThinking(false); });
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const sugInd = sug && INDUSTRY_CODES.find((x) => x.code === sug.industryCode);
    const sugOrg = sug && ORG_SIZES.find((x) => x.code === sug.sizeCode);
    const useSug = () => {
      d.industry = sugInd; d.orgSize = sugOrg;
      freeze(m.id, `${sugInd.label} (${sugInd.code}) · ${sugOrg.label} (${sugOrg.code})`);
      meMsg(`${sugInd.label} · ${sugOrg.label}`);
      go("clientid");
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {thinking && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--txt2)" }}><TypingDots /> asking Claude about {d.clientName}…</div>}
        {sugInd && sugOrg && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--acc)", background: "var(--soft)" }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              <Sparkles size={12} style={{ color: "var(--acc)", marginRight: 5, verticalAlign: -1 }} />
              Claude suggests <b>{sugInd.label}</b> <span style={{ fontFamily: MONO, opacity: 0.6 }}>{sugInd.code}</span> · <b>{sugOrg.label}</b> <span style={{ fontFamily: MONO, opacity: 0.6 }}>{sugOrg.code}</span>
              {sug.confidence !== "high" && <Pill color="var(--amber)" style={{ marginLeft: 6 }}>{sug.confidence} confidence</Pill>}
              <div style={{ fontSize: 11.5, color: "var(--txt2)", marginTop: 3 }}>{sug.why}</div>
            </div>
            <div><Btn small icon={Sparkles} onClick={useSug}>Use both</Btn></div>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {INDUSTRY_CODES.map((i) => (
            <button key={i.code} style={chipS(sugInd?.code === i.code)} onClick={() => { d.industry = i; freeze(m.id, `${i.label} (${i.code})`); meMsg(i.label); go("orgsize"); }}>
              {i.label} <span style={{ fontFamily: MONO, opacity: 0.6 }}>{i.code}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const OrgW = ({ m }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {ORG_SIZES.map((o) => (
        <button key={o.code} style={{ ...chipS(d.aiProfile?.sizeCode === o.code), display: "flex", justifyContent: "space-between", width: "100%", borderRadius: 10 }} onClick={() => { d.orgSize = o; d.clientId = ""; freeze(m.id, `${o.label} (${o.code})`); meMsg(o.label); go("clientid"); }}>
          <span>{o.label}{d.aiProfile?.sizeCode === o.code ? " — Claude's pick" : ""}</span><span style={{ fontFamily: MONO }}>{o.code}</span>
        </button>
      ))}
    </div>
  );

  const ClientIdW = ({ m }) => {
    const [state, setState] = useState({ loading: true });
    useEffect(() => {
      let alive = true;
      allocateIds().then((res) => {
        if (alive) setState({ loading: false, res, err: d.registerError });
      });
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (state.loading) {
      return <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> reading the Client-ID register in Drive…</div>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Pill color="var(--blue)">{d.industry?.code} industry</Pill>
          <Pill color="var(--purple)">{d.orgSize?.code} org</Pill>
          <Pill color="var(--green)">{pad2(d.clientSeq)} seq</Pill>
        </div>
        <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600, letterSpacing: ".02em" }}>{d.clientId}</div>
        <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.6 }}>
          {d.fromRegister
            ? <>Next in sequence after the <b>{state.res?.clientsInRegister}</b> clients already in the register — appended there on create.</>
            : <>⚠ Could not read the register{d.registerError ? ` (${d.registerError})` : ""} — this sequence is a local guess. Verify before creating.</>}
        </div>
        <div><Btn small onClick={() => { freeze(m.id, d.clientId); meMsg(d.clientId); go(nextMissing()); }}>Continue</Btn></div>
      </div>
    );
  };

  const ContactW = ({ m }) => {
    const [c, setC] = useState(d.contact);
    const set = (k, v) => setC((x) => ({ ...x, [k]: v }));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Name" req><input className="inp" value={c.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Designation"><input className="inp" value={c.designation} onChange={(e) => set("designation", e.target.value)} /></Field>
          <Field label="Phone"><input className="inp" value={c.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><input className="inp" type="email" value={c.email} onChange={(e) => set("email", e.target.value)} /></Field>
        </div>
        <div><Btn small disabled={!c.name.trim()} onClick={() => { d.contact = c; freeze(m.id, c.name); meMsg(c.name); go(nextMissing()); }}>Continue</Btn></div>
      </div>
    );
  };

  const KindW = ({ m }) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {KINDS.map((k) => (
        <ChoiceCard key={k.k} icon={FolderOpen} title={k.label} sub={`${k.full}. Sanctioned into ${k.tool}.`}
          onClick={() => { d.kind = k.k; freeze(m.id, k.full); meMsg(k.label); go(nextMissing()); }} />
      ))}
    </div>
  );

  const DeadlineW = ({ m }) => {
    const [dt, setDt] = useState("");
    const quick = [["+2 weeks", 14], ["+1 month", 30], ["+2 months", 60], ["+3 months", 90]];
    const pick = (v) => { d.deadline = v; freeze(m.id, fmtDate(v)); meMsg(fmtDate(v)); go("pid"); };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {quick.map(([label, days]) => (
            <button key={label} style={chipS(false)} onClick={() => pick(new Date(Date.now() + days * 86400000).toISOString().slice(0, 10))}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="inp" type="date" min={todayStr()} value={dt} onChange={(e) => setDt(e.target.value)} style={{ maxWidth: 200 }} />
          <Btn small disabled={!dt} onClick={() => pick(dt)}>Set deadline</Btn>
        </div>
      </div>
    );
  };

  const PidW = ({ m }) => {
    const [mode, setMode] = useState("auto");
    const [manual, setManual] = useState("");
    const [ready, setReady] = useState(Boolean(d.projectId));
    useEffect(() => {
      // An existing client skips the Client-ID step, so the ids may not have
      // been allocated yet — make sure they are before showing one.
      if (!d.projectId) { allocateIds().then(() => setReady(true)); }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    if (!ready) {
      return <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> reading the project register in Drive…</div>;
    }
    const auto = d.projectId;
    const clean = manual.trim().toUpperCase();
    const dupe = clean && projects.some((p) => normId(p.projectId) === normId(clean));
    const badChars = clean && !/^[A-Z0-9][A-Z0-9-]*$/.test(clean);
    const valid = mode === "auto" || (clean && !dupe && !badChars);
    const chosen = mode === "auto" ? auto : clean;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Seg options={[{ k: "auto", label: "Auto-generate" }, { k: "manual", label: "Enter manually" }]} value={mode} onChange={setMode} />
        {mode === "auto" ? (
          <>
            <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600 }}>{auto}</div>
            <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.6 }}>
              EbX-{d.industry?.code}-{d.orgSize?.code}-{pad2(d.clientSeq)}-{pad2(d.projectSeq)} — client {d.clientId}.
              {d.fromRegister
                ? <> Next after <b>{d.lastProjectId || "the last row"}</b> in the project register.</>
                : <> ⚠ Register unreadable — local guess, verify before creating.</>}
            </div>
          </>
        ) : (
          <>
            <input className="inp" style={{ fontFamily: MONO, maxWidth: 320 }} value={manual} onChange={(e) => setManual(e.target.value)} placeholder="e.g. Eb-21-EL-287-01-1879" />
            {dupe && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>That Project ID already exists — IDs must be unique.</div>}
            {badChars && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>Use letters, numbers and dashes only.</div>}
          </>
        )}
        <div><Btn small disabled={!valid} onClick={() => { d.projectId = chosen; d.idMode = mode; freeze(m.id, `${chosen} (${mode})`); meMsg(chosen); go("team"); }}>Lock Project ID</Btn></div>
      </div>
    );
  };

  const TeamW = ({ m }) => {
    const [rows, setRows] = useState(TEAM_SLOTS.map((slot) => ({ slot, userId: "" })));
    const set = (i, v) => setRows((x) => x.map((r, j) => (j === i ? { ...r, userId: v } : r)));
    const pmOk = rows.some((r) => r.slot.startsWith("PM") && r.userId);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.slot} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 210 }}>{r.slot}{r.slot.startsWith("PM") && <span style={{ color: "var(--red)" }}> *</span>}</span>
            <select className="inp" style={{ flex: 1 }} value={r.userId} onChange={(e) => set(i, e.target.value)}>
              <option value="">— unassigned —</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.title}</option>)}
            </select>
          </div>
        ))}
        {!pmOk && <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 600 }}>A PM must be assigned before continuing.</div>}
        {/* LLDs gate ODM only — box build & product go straight to review. */}
        <div><Btn small disabled={!pmOk} onClick={() => { d.team = rows.filter((r) => r.userId); const pm = people.find((u) => u.id === (d.team.find((t) => t.slot.startsWith("Senior PM")) || d.team.find((t) => t.slot.startsWith("PM")))?.userId); freeze(m.id, `${d.team.length} allocated · owner ${pm?.name || "—"}`); meMsg(`${d.team.length} people allocated`); go(d.kind === "odm" ? "lldc" : "review"); }}>Confirm team</Btn></div>
      </div>
    );
  };

  const ManualLLD = ({ onUse }) => {
    const [text, setText] = useState("");
    const [fileName, setFileName] = useState("");
    const [fileTxt, setFileTxt] = useState("");
    const onFile = (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setFileName(f.name);
      if (/\.(txt|md|json|csv)$/i.test(f.name)) {
        const r = new FileReader();
        r.onload = () => setFileTxt(String(r.result || "").slice(0, 8000));
        r.readAsText(f);
      }
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <textarea className="inp" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the LLD text here…" />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ ...chipS(false), display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={13} /> {fileName || "Attach a file"}
            <input type="file" style={{ display: "none" }} onChange={onFile} />
          </label>
          <Btn small disabled={!text.trim() && !fileName} onClick={() => onUse({ mode: "manual", text: text.trim() || fileTxt || `(content in attached file ${fileName})`, fileName })}>Use this LLD</Btn>
        </div>
        <div style={{ fontSize: 11, color: "var(--txt3)" }}>Stored on the project; lands in the project folder in Drive as [ProjectID]_LLD.</div>
      </div>
    );
  };

  const LldChoiceC = ({ m }) => {
    const [mode, setMode] = useState("");
    const [brief, setBrief] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    /* Paste the client's own words; Claude fans them out across the 21
       questions and leaves what the text doesn't support as TBD. Lands on the
       same summary screen as the guided chat, so nothing is accepted unseen. */
    const extract = async () => {
      setBusy(true); setErr("");
      try {
        const res = await extractLld({ description: brief, questions: LLD_QUESTIONS, projectName: d.name, kind: kindOf(d.kind)?.label || d.kind });
        LLD_QUESTIONS.forEach((q) => { d.lldAnswers[q.id] = res.answers?.[q.id] || "TBD"; });
        freeze(m.id, "Customer LLD · extracted by Claude from the client's brief");
        if (res.summary) await sys(`_${res.summary}_`);
        go("lldsum");
      } catch (e) {
        setErr(`Extraction failed (${e.message}) — use the guided chat or paste instead.`);
        setBusy(false);
      }
    };
    if (mode === "manual") return <ManualLLD onUse={(lld) => { d.lldC = lld; freeze(m.id, `Customer LLD · manual${lld.fileName ? ` (${lld.fileName})` : ""}`); go("lldd"); }} />;
    if (mode === "ai") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <textarea className="inp" rows={7} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Paste the client's brief, email thread, call notes — their words, any shape…" />
        {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Btn small icon={Sparkles} disabled={!brief.trim() || busy} onClick={extract}>{busy ? "Extracting…" : "Extract the LLD with Claude"}</Btn>
          <Btn small kind="ghost" onClick={() => setMode("")} disabled={busy}>Back</Btn>
          {busy && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--txt2)" }}><TypingDots /> answering {LLD_QUESTIONS.length} questions from the brief…</div>}
        </div>
      </div>
    );
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {aiOn && <ChoiceCard icon={Sparkles} title="Paste the client's brief — AI fills the form" sub={`Claude answers the ${LLD_QUESTIONS.length} questions from their email / notes; unsupported ones stay TBD.`} accent onClick={() => setMode("ai")} />}
        <ChoiceCard icon={Bot} title="Guided chat" sub={`${LLD_QUESTIONS.length} questions, chips + text — the fastest complete capture.`} accent={!aiOn} onClick={() => { freeze(m.id, "Guided questionnaire"); go("lldq"); }} />
        <ChoiceCard icon={Upload} title="Upload / paste manually" sub="Already have the LLD from the client? Paste or attach it." onClick={() => setMode("manual")} />
      </div>
    );
  };

  const LldChips = ({ m }) => {
    const q = LLD_QUESTIONS[m.qIdx ?? lldQ];
    const [sel, setSel] = useState([]);
    if (!q || q.type !== "chips") return null;
    const toggle = (c) => setSel((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
    const pickOne = async (c) => { d.lldAnswers[q.id] = c; freeze(m.id, c); meMsg(c); await nextLld(m.qIdx ?? lldQ); };
    const confirmMulti = async () => { d.lldAnswers[q.id] = sel; freeze(m.id, sel.join(", ")); meMsg(sel.join(", ")); await nextLld(m.qIdx ?? lldQ); };
    const skip = async () => { d.lldAnswers[q.id] = "TBD"; freeze(m.id, "TBD"); await nextLld(m.qIdx ?? lldQ); };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {q.chips.map((c) => (
            <button key={c} style={chipS(q.multi ? sel.includes(c) : false)} onClick={() => (q.multi ? toggle(c) : pickOne(c))}>{c}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {q.multi && <Btn small disabled={!sel.length} onClick={confirmMulti}>Continue</Btn>}
          <button onClick={skip} style={{ background: "none", border: "none", color: "var(--txt3)", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>skip</button>
        </div>
      </div>
    );
  };

  const LldSumW = ({ m }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ maxHeight: 180, overflow: "auto", fontSize: 11.5, whiteSpace: "pre-wrap", fontFamily: MONO, background: "var(--s2)", borderRadius: 8, padding: 10, lineHeight: 1.7 }}>{d.lldC?.text}</div>
      <div><Btn small onClick={() => { freeze(m.id, "Customer LLD · guided chat"); go("lldd"); }}>Looks right — continue</Btn></div>
    </div>
  );

  const LlddW = ({ m }) => {
    const [manual, setManual] = useState(false);
    const [gen, setGen] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const generate = async () => {
      setBusy(true); setErr("");
      try {
        const txt = aiOn
          ? await claude(
              designerPrompt({
                customerLLD: d.lldC?.text || "", projectName: d.name,
                kind: kindOf(d.kind)?.label || d.kind, clientName: d.clientName,
                industry: d.industry?.label || "", deadline: d.deadline,
                team: d.team.map((t) => `${t.slot}: ${people.find((p) => p.id === t.userId)?.name || "?"}`).join(", "),
              }),
              { system: designerSystem, maxTokens: 8000, effort: "high" },
            )
          : fallbackDesigner(d.name, kindOf(d.kind)?.label || d.kind);
        setGen(txt);
        if (!aiOn) setErr("AI backend not configured — loaded the offline template; edit it before accepting.");
      } catch (e) {
        setErr("AI unreachable (" + e.message + ") — loaded the offline template instead."); setGen(fallbackDesigner(d.name, kindOf(d.kind)?.label || d.kind));
      }
      setBusy(false);
    };
    if (manual) return <ManualLLD onUse={(lld) => { d.lldD = lld; freeze(m.id, `Designer LLD · manual${lld.fileName ? ` (${lld.fileName})` : ""}`); go("review"); }} />;
    if (gen !== "") return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <textarea className="inp" rows={11} value={gen} onChange={(e) => setGen(e.target.value)} style={{ fontFamily: MONO, fontSize: 12 }} />
        {err && <div style={{ fontSize: 11.5, color: "var(--amber)", fontWeight: 600 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <Btn small icon={CheckCircle2} onClick={() => { d.lldD = { mode: aiOn ? "ai" : "template", text: gen, fileName: "" }; freeze(m.id, aiOn ? "AI-generated (edited & accepted)" : "Template (edited & accepted)"); go("review"); }}>Accept Designer LLD</Btn>
          <Btn small kind="ghost" onClick={generate} disabled={busy}>{busy ? "Regenerating…" : "Regenerate"}</Btn>
        </div>
      </div>
    );
    return (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <ChoiceCard icon={aiOn ? Sparkles : Wand2} title={aiOn ? "Generate with AI" : "Start from the template"} sub={aiOn ? "Claude drafts the designer LLD from the customer LLD; you edit and accept." : "Offline template pre-structured for engineering; edit and accept."} accent onClick={generate} />
        <ChoiceCard icon={Upload} title="Upload / paste manually" sub="The solution architect already wrote it? Paste or attach it." onClick={() => setManual(true)} />
        {busy && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--txt2)" }}><TypingDots /> drafting…</div>}
      </div>
    );
  };

  const ReviewW = ({ m }) => {
    // The LLD hard gates apply to ODM only — box build and product ship
    // without them (they can still be added later from the project page).
    const needLld = d.kind === "odm";
    const gates = [
      ["Project ID", !!d.projectId],
      ...(needLld ? [["Customer LLD", !!d.lldC], ["Designer LLD", !!d.lldD]] : []),
      ["PM assigned", d.team.some((t) => t.slot.startsWith("PM"))],
      ["Deadline set", !!d.deadline],
      ["Client & name", !!d.clientName && !!d.name],
      ["Delivery route", !!d.kind],
    ];
    const allOk = gates.every((g) => g[1]);
    const pm = people.find((u) => u.id === (d.team.find((t) => t.slot.startsWith("Senior PM")) || d.team.find((t) => t.slot.startsWith("PM")))?.userId);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <KV k="Project" v={<span style={{ fontFamily: MONO }}>{d.projectId}</span>} />
          <KV k="Name" v={d.name} />
          <KV k="Client" v={`${d.clientName} · ${d.clientId}`} />
          <KV k="Route" v={kindOf(d.kind)?.full} />
          <KV k="Deadline" v={fmtDate(d.deadline)} />
          <KV k="Delivery owner" v={pm?.name || "—"} />
          <KV k="Team" v={`${d.team.length} allocated`} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {gates.map(([g, ok]) => <Pill key={g} color={ok ? "var(--green)" : "var(--red)"}>{ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {g}</Pill>)}
          {!needLld && d.kind && <Pill color="var(--txt2)">LLDs not required for {kindOf(d.kind)?.label}</Pill>}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.6 }}>
          Create will: write the client &amp; project to the shared database, sanction the project as {kindOf(d.kind)?.label || "…"} through the one-door ulm.decide(), append both **registers in Drive**, replicate the **Project-ID template folder into the Project Management area** (renamed to the Project ID), and fill the **process-map sheet** with links to every template in the library. PCB-ID folders (one per board, into PCB &amp; Firmware) are added from the project page once the board count is known.
        </div>
        <div><Btn disabled={!allOk || creating} icon={FolderOpen} onClick={() => runCreate(m.id)}>{creating ? "Creating…" : "Create & provision"}</Btn></div>
      </div>
    );
  };

  const DoneW = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {d.folderUrl && <a href={d.folderUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--green)"><FolderOpen size={11} /> Project folder <ExternalLink size={10} /></Pill></a>}
        {d.processMapUrl && <a href={d.processMapUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)"><Link2 size={11} /> Process map <ExternalLink size={10} /></Pill></a>}
        {d.projectRegisterUrl && <a href={d.projectRegisterUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--purple)"><FileText size={11} /> Project register <ExternalLink size={10} /></Pill></a>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn small onClick={() => { if (d.createdProjectRef) onOpenProject(d.createdProjectRef.id); }}>Open the project</Btn>
        <Btn small kind="ghost" onClick={() => window.location.reload()}>Start another</Btn>
      </div>
    </div>
  );

  const WIDGETS = { industry: IndustryW, orgsize: OrgW, clientid: ClientIdW, contact: ContactW, kind: KindW, deadline: DeadlineW, pid: PidW, team: TeamW, lldc: LldChoiceC, lldchips: LldChips, lldsumw: LldSumW, lldd: LlddW, review: ReviewW, donew: DoneW };

  if (!isAdmin) {
    return (
      <div className="fade card" style={{ padding: 40, textAlign: "center", color: "var(--txt2)" }}>
        <Shield size={28} style={{ opacity: 0.5, marginBottom: 10 }} />
        <div style={{ fontWeight: 700, color: "var(--txt)", marginBottom: 6 }}>Creating projects is a ULM decision</div>
        <div style={{ fontSize: 12.5, maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>Only a superadmin or dept-head profile can create and sanction projects. You can raise a request from the Sanction Inbox instead.</div>
      </div>
    );
  }

  return (
    <div className="fade card" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 150px)", minHeight: 480, overflow: "hidden" }}>
      {/* header + phase strip */}
      <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--bdr)", background: "var(--soft)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#2563eb,#1e40af)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 700, fontSize: 13 }}>Eb</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
            New project — create &amp; sanction
            <span title={aiNote}>
              <Pill color={aiOn ? "var(--green)" : "var(--amber)"}><Sparkles size={10} /> {aiOn ? "Claude on" : "Claude off"}</Pill>
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--txt2)" }}>
            {aiOn ? "Type anything — answers, questions, your own words — or use the options." : `Three hard gates: Project ID · Customer LLD · Designer LLD — AI off: ${aiNote}`}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, flexWrap: "wrap" }}>
          {PHASES.map((p, i) => {
            const cur = phaseOf(step);
            return <span key={p} style={{ fontSize: 10.5, fontWeight: i === cur ? 800 : 500, color: i === cur ? "var(--acc)" : i < cur ? "var(--txt2)" : "var(--txt3)", padding: "3px 7px", borderBottom: i === cur ? "2px solid var(--acc)" : "2px solid transparent" }}>{p}</span>;
          })}
        </div>
      </div>

      {/* messages */}
      <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        {msgs.map((m) => {
          const W = m.widget ? WIDGETS[m.widget] : null;
          if (m.statusTone) {
            const c = m.statusTone === "green" ? "var(--green)" : m.statusTone === "red" ? "var(--red)" : m.statusTone === "amber" ? "var(--amber)" : "var(--acc)";
            const Ic = m.statusTone === "green" ? CheckCircle2 : m.statusTone === "red" || m.statusTone === "amber" ? AlertTriangle : FolderOpen;
            return (
              <div key={m.id} className="fade" style={{ alignSelf: "flex-start", maxWidth: "88%", display: "flex", alignItems: "flex-start", gap: 8, padding: "9px 13px", borderRadius: 11, border: `1px solid ${c}`, background: `color-mix(in srgb, ${c} 8%, transparent)`, fontSize: 12.5, lineHeight: 1.6 }}>
                <Ic size={14} style={{ color: c, marginTop: 2, flexShrink: 0 }} />
                <span><MD t={m.text} /></span>
              </div>
            );
          }
          return (
            <div key={m.id} className="fade" style={{ display: "flex", justifyContent: m.who === "me" ? "flex-end" : "flex-start", gap: 8 }}>
              {m.who === "sys" && <span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#2563eb,#1e40af)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, fontFamily: MONO, marginTop: 2, flexShrink: 0 }}>Eb</span>}
              <div style={{ maxWidth: "82%", display: "flex", flexDirection: "column", gap: 8 }}>
                {m.text && (
                  <div style={{ padding: "10px 14px", borderRadius: m.who === "me" ? "13px 13px 4px 13px" : "13px 13px 13px 4px", background: m.who === "me" ? "linear-gradient(135deg,#2563eb,#1e40af)" : "var(--s1)", border: m.who === "me" ? "none" : "1px solid var(--bdr)", color: m.who === "me" ? "#fff" : "var(--txt)", fontSize: 13, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                    <MD t={m.text} />
                    {m.sub && <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 4, fontStyle: "italic" }}>{m.sub}</div>}
                  </div>
                )}
                {m.frozen && <Done s={m.frozen} />}
                {W && <div style={{ background: "var(--s1)", border: "1px solid var(--bdr)", borderRadius: 12, padding: 14 }}><W m={m} /></div>}
              </div>
            </div>
          );
        })}
        {typing && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#2563eb,#1e40af)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, fontFamily: MONO }}>Eb</span><TypingDots /></div>}
      </div>

      {/* input bar */}
      <div style={{ padding: 12, borderTop: "1px solid var(--bdr)", display: "flex", gap: 8 }}>
        <input className="inp" disabled={!inputOn} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()} placeholder={inputOn ? ph : "Use the options above…"} style={{ opacity: inputOn ? 1 : 0.55 }} />
        <Btn icon={Send} disabled={!inputOn || !val.trim()} onClick={handleSend}>Send</Btn>
      </div>
    </div>
  );
}
