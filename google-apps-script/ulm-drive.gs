/**
 * Elecbits ULM — Drive provisioning web app (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════════════════
 * The ULM portal's hands inside Google Drive. One deployed web app, six
 * actions, everything the portal cannot do from the browser:
 *
 *   ping              sanity check — proves the token and folder wiring
 *   client.register   allocate the next Client ID and append it to the
 *                     Client-ID-Register sheet (the "backend file" for clients)
 *   project.register  allocate the next Project ID and append it to the
 *                     Project-ID-Register sheet (the "backend file" for projects)
 *   project.provision copy the PROJECT-ID (PM) template folder into the
 *                     Project Management area, rename it to the Project ID,
 *                     then fill the process-map sheet inside the new folder
 *                     with links to that project's own template copies
 *   pcb.provision     copy the PCB-ID (engineering) template folder into the
 *                     PCB & Firmware area, rename it to the PCB ID, and append
 *                     the PCB-ID register (one project can have several boards,
 *                     so this is called once per PCB ID)
 *   registry.list     read back a register (clients | projects | pcbs)
 *   ai.chat           ask Claude — the portal's chat brain. The Anthropic key
 *                     lives in Script Properties, so it never reaches the
 *                     browser bundle (see the AI section further down).
 *   ai.agent          Claude with Drive hands: an agentic tool-use loop that
 *                     can search Drive, read Docs/Sheets, write Docs, list
 *                     folders and read the registers — all as this script's
 *                     owner account, gated by the same SHARED_TOKEN.
 *
 * ── Two things worth knowing ──────────────────────────────────────────────
 * 1. RESUMABLE. A copy that dies half way (Apps Script caps a request at ~6
 *    minutes) leaves a partial folder. Calling provision again RESUMES it:
 *    files already copied are skipped by name, and the folder is only marked
 *    complete once the whole tree is there. A response with done:false means
 *    "call me again" — the portal does exactly that.
 * 2. The process map is usually an uploaded .xlsx, which Apps Script cannot
 *    edit. Provisioning converts the project's copy to a real Google Sheet
 *    (the .xlsx is moved aside), then writes the template links into it.
 *
 * ── Deploy ────────────────────────────────────────────────────────────────
 * 1. script.google.com → New project → paste this file.
 * 2. Set SHARED_TOKEN. The five folder IDs below are already the live
 *    Elecbits ones; the three register ids are blank on purpose — read the
 *    note on AUTO_CONVERT_REGISTERS before filling them in.
 * 3. Deploy → New deployment → Web app:
 *      Execute as: **Me**   ·   Who has access: **Anyone**
 *    ("Anyone" is required for the portal to reach it; SHARED_TOKEN is the
 *     actual gate — every request must carry it.)
 * 4. Copy the /exec URL into the portal's env as VITE_ULM_DRIVE_URL and the
 *    token as VITE_ULM_DRIVE_TOKEN.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 * POST JSON: { token, action, ...params }  →  { ok:true, ... } | { ok:false, error }
 * (POST body is used, not query params, so nothing sensitive lands in logs.)
 */

const CONFIG = {
  // Long random string; must equal VITE_ULM_DRIVE_TOKEN in the portal env.
  SHARED_TOKEN: "REPLACE-WITH-A-LONG-RANDOM-STRING",

  // ── The three registers ──────────────────────────────────────────────────
  // Each is an EXISTING master sheet with its own columns, its own header row
  // and several tabs — so each carries the tab to write into. Rows are matched
  // to that tab's own headers, never to a fixed column order. Leave an id
  // blank to have a fresh register created inside REGISTRY_FOLDER_ID instead.

  // "Eb-Client ID Sheet_"  ·  headers on row 1  (converted to Google Sheets)
  //   S. no. | Organisation Name | Category/Industry | Client category/org
  //   size | Client ID | Client Folder | Point of Contact | Designation
  CLIENT_REGISTER_ID:  "16GtX_5TgYG_hKw_VdNDS0Dzl10MUPtTPco46qatb_Js",
  CLIENT_REGISTER_TAB: "Client Data and IDs",

  // "Eb-Centralised Project Tracking Sheet_"  ·  headers on row 2  (converted)
  //   S. No | Project ID | Organisation Name | Priority | Customer SPOC |
  //   Project Type | Description | Status | Project created…
  PROJECT_REGISTER_ID:  "1BK_cML2WE_3nKLEMIQISm1Qk9kAs1B6OUak2bF9kCm0",
  PROJECT_REGISTER_TAB: "All projects",

  // "Eb_Hardware SKU Sheet-2026"  ·  headers on row 3
  //   General Device Name | Eb Project ID | Product Folder Link |
  //   Audit Checklist Link | Design status | Active status
  // NOTE the tab: this workbook also has Discarded / Sensors tabs, and the
  // first tab is NOT the one to write into.
  PCB_REGISTER_ID:  "12arJXEf0DQjVouJdoXJkqpn4q38PjojY",
  PCB_REGISTER_TAB: "PCB SKU Sheet Gateways -2026",

  // Folder where the registers live — "Eb-Central-ULM".
  REGISTRY_FOLDER_ID: "1c35aKmV4TSclOcCwxPvf-2HsANLerRtc",

  // Your registers are probably uploaded .xlsx files. Apps Script cannot
  // append a row to an .xlsx — only to a Google Sheet. Leave this false and
  // the script REFUSES with a clear message rather than touching your master
  // file; set it true to let it convert the register once (the .xlsx is kept,
  // moved into a "99-Source-Files" sub-folder, and the Google Sheet takes
  // over from there). Converting changes the file everyone links to, so make
  // that call deliberately.
  AUTO_CONVERT_REGISTERS: false,

  // ── The two template trees, and where each replica goes ──────────────────
  // 1) The PROJECT-ID (PM) template folder — the project-management tree
  //    (Governance, MoM, R&D-PM sub-folders, SCS, handover, process map…).
  //    "01-Project-ID-Folder-PM-Template folder- 16-8-26"
  PROJECT_TEMPLATE_FOLDER_ID: "1NOcKc9ZqPAyZQrs8cO0uxYNBtw1-c0dg",

  // Where new PROJECT folders are created:
  //    …/Engineering Services/"Project Management - Project Managers"
  PROJECTS_PARENT_FOLDER_ID: "1rf8apJsXqIjy9sKXp6sYjL9fTSfFoNyr",

  // 2) The PCB-ID (engineering) template folder — the board-level tree.
  //    "Eb-PCB & Firmware and Enclosure - template folder"
  PCB_TEMPLATE_FOLDER_ID: "1LSGc7_m75CCCbKtdZceVnPGltIjBn5X1",

  // Where new PCB folders are created:
  //    …/"PCB & Firmware - Engineers / Developers"/"Eb-PCB & Firmware and Enclosure"
  PCB_PARENT_FOLDER_ID: "1CIyvqJd_FGN9if_YqBTAuQCHeEwkcmRz",

  // OPTIONAL: a separate eb-templates library of blank EB-T-nnn files. Leave
  // blank when the templates already live inside the template tree — the
  // process map then links to the project's OWN copies, which is what a PM
  // actually wants to click.
  TEMPLATES_LIBRARY_FOLDER_ID: "",

  // Name fragment that identifies the process-map sheet inside a freshly
  // copied project folder (matched case-insensitively).
  PROCESS_MAP_NAME_HINT: "Process",

  // ── Claude (the chat brain) ──────────────────────────────────────────────
  // The API key is NOT here on purpose. Put it in:
  //   ⚙ Project Settings → Script properties → Add script property
  //     name  ANTHROPIC_API_KEY
  //     value sk-ant-…        (from console.anthropic.com → API keys)
  // Script properties are not readable from the portal, so the key stays out
  // of the browser bundle and out of git.
  AI_MODEL: "claude-opus-5",
  AI_EFFORT: "medium",       // low | medium | high  — medium is the balance
  AI_MAX_TOKENS: 4000,
};

const CLIENT_HEADERS = [
  "Client ID", "Client Name", "Industry", "Industry Code", "Org Size",
  "Size Code", "Contact", "Email", "Phone", "Created By", "Created At",
];
const PROJECT_HEADERS = [
  "Project ID", "Project Name", "Client ID", "Client Name", "Kind",
  "Deadline", "Folder Link", "Created By", "Created At",
];
const PCB_HEADERS = [
  "PCB ID", "Project ID", "Board Name", "Folder Link", "Created By", "Created At",
];

/* A folder carries this in its description once its copy is complete. An
   existing folder WITHOUT it is a half-finished copy, and gets resumed. */
const DONE_MARK = "ULM-PROVISIONED";

/* Apps Script kills a request at ~6 minutes. Stop well before that, report
   done:false, and let the caller call again to resume. */
const TIME_BUDGET_MS = 4 * 60 * 1000;
let DEADLINE = 0;
const outOfTime = () => Date.now() > DEADLINE;

/* ── entry points ─────────────────────────────────────────────────────────── */

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData && e.postData.contents || "{}"); }
  catch (err) { return json_({ ok: false, error: "Bad JSON body" }); }
  return handle_(body);
}

// GET carries the full contract too: ?body=<url-encoded JSON of the same POST
// body>. Google's redirect chain occasionally rewrites a cross-origin POST
// into a bare GET (dropping the body) — the portal detects that and re-sends
// in this form, which survives every hop. Bare ?action=ping&token=… still
// works for a quick browser check.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.body) {
    let body;
    try { body = JSON.parse(p.body); }
    catch (err) { return json_({ ok: false, error: "Bad JSON in the body param" }); }
    return handle_(body);
  }
  // Bare params stay read-only — writes must come with a full body.
  if (p.action === "ping" || p.action === "registry.check") {
    return handle_({ token: p.token, action: p.action });
  }
  return json_({ ok: false, error: "POST JSON { token, action, ... }" });
}

function handle_(body) {
  DEADLINE = Date.now() + TIME_BUDGET_MS;
  try {
    if (!CONFIG.SHARED_TOKEN || body.token !== CONFIG.SHARED_TOKEN) {
      return json_({ ok: false, error: "Bad or missing token" });
    }
    switch (body.action) {
      case "ping":              return json_(ping_());
      case "registry.check":    return json_(checkRegisters_());
      case "id.next":           return json_(nextIds_(body));
      case "clients.search":    return json_(searchClients_(body));
      case "client.register":   return json_(registerClient_(body));
      case "project.register":  return json_(registerProject_(body));
      case "project.provision": return json_(provisionProject_(body));
      case "pcb.provision":     return json_(provisionPcb_(body));
      case "registry.list":     return json_(listRegistry_(body));
      case "ai.chat":           return json_(aiChat_(body));
      case "ai.agent":          return json_(aiAgent_(body));
      // One Drive tool, executed for the Supabase claude-ulm-agent Edge
      // Function — that variant runs the Claude loop in Supabase and only
      // borrows this script's Drive hands.
      case "tool.run":          return json_({ ok: true, result: runAiTool_(String(body.name || ""), body.input || {}) });
      default: return json_({ ok: false, error: "Unknown action: " + body.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── ping ─────────────────────────────────────────────────────────────────── */

function ping_() {
  const out = { ok: true, ts: new Date().toISOString() };
  out.registryFolder  = tryName_(CONFIG.REGISTRY_FOLDER_ID);
  out.templateFolder  = tryName_(CONFIG.PROJECT_TEMPLATE_FOLDER_ID);
  out.projectsParent  = tryName_(CONFIG.PROJECTS_PARENT_FOLDER_ID);
  out.pcbTemplate     = tryName_(CONFIG.PCB_TEMPLATE_FOLDER_ID);
  out.pcbParent       = tryName_(CONFIG.PCB_PARENT_FOLDER_ID);
  out.templateLibrary = CONFIG.TEMPLATES_LIBRARY_FOLDER_ID
    ? tryName_(CONFIG.TEMPLATES_LIBRARY_FOLDER_ID)
    : "(not set — links point at the project's own copies)";
  out.ai = anthropicKey_()
    ? { enabled: true, model: CONFIG.AI_MODEL }
    : { enabled: false, error: "ANTHROPIC_API_KEY is not set in this script's properties" };
  return out;
}
function tryName_(id) {
  if (!id || id.indexOf("REPLACE") === 0) return "⚠ not configured";
  try { return DriveApp.getFolderById(id).getName(); }
  catch (e) { return "⚠ " + String(e && e.message || e); }
}

/**
 * Dry run over the registers: what file each one resolves to, whether it is
 * editable, and — the part that matters with a register that already has its
 * own columns — which of this tool's fields found a home and which did not.
 * Writes nothing. Run this before the first real project.
 */
function checkRegisters_() {
  const want = {
    CLIENT_REGISTER_ID:  { title: "Client-ID-Register",  headers: CLIENT_HEADERS,
                           fields: ["Client ID", "Client Name", "Industry", "Org Size", "Contact", "Email", "Phone", "Created By", "Created At"] },
    PROJECT_REGISTER_ID: { title: "Project-ID-Register", headers: PROJECT_HEADERS,
                           fields: ["Project ID", "Project Name", "Client ID", "Client Name", "Kind", "Deadline", "Folder Link", "Created By", "Created At"] },
    PCB_REGISTER_ID:     { title: "PCB-ID-Register",     headers: PCB_HEADERS,
                           fields: ["PCB ID", "Project ID", "Board Name", "Folder Link", "Created By", "Created At"] },
  };
  const out = { ok: true, registers: {} };
  for (const prop in want) {
    const spec = want[prop];
    const entry = {};
    try {
      const reg = register_(prop, spec.title, spec.headers);
      const header = headerRowOf_(reg.sheet, spec.fields);
      entry.file = reg.ss.getName();
      entry.url = reg.ss.getUrl();
      entry.rows = Math.max(reg.sheet.getLastRow() - header.row, 0);
      entry.headerRow = header.row;
      entry.mapped = {};
      entry.unmapped = [];
      spec.fields.forEach(function (f) {
        const c = columnFor_(header.values, f);
        if (c) entry.mapped[f] = String(header.values[c - 1]); else entry.unmapped.push(f);
      });
      entry.status = Object.keys(entry.mapped).length ? "ready" : "⚠ no matching columns — wrong file?";
    } catch (e) {
      entry.status = "⚠ " + String(e && e.message || e);
      out.ok = false;
    }
    out.registers[prop] = entry;
  }
  return out;
}

/* ── IDs come FROM the registers ───────────────────────────────────────────
   The registers are the allocator of record, so the next id is derived from
   what is actually in them — never from a row count held anywhere else.

     Client   Eb-{industry}-{orgSize}-{seq}        e.g. Eb-10-EL-03
     Project  EbX-{industry}-{orgSize}-{clientSeq}-{projectSeq}
                                                   e.g. EbX-22-PL-03-47

   Both sequences are global and continue the highest number already present,
   so the portal picks up exactly where the sheets left off.               */

const pad2_ = (n) => (String(n).length < 2 ? "0" + n : String(n));

/** The trailing number of an id: "Eb-10-EL-03" → 3, "EbX-22-PL-03-47" → 47. */
function trailingSeq_(s) {
  const m = String(s == null ? "" : s).trim().match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) : NaN;
}

/** Every value in one column below the header, as trimmed strings. */
function columnValues_(sheet, header, field) {
  const col = columnFor_(header.values, field);
  if (!col || sheet.getLastRow() <= header.row) return [];
  return sheet.getRange(header.row + 1, col, sheet.getLastRow() - header.row, 1)
    .getValues().map(function (r) { return String(r[0] == null ? "" : r[0]).trim(); });
}

/** Highest trailing sequence in a column, or 0 when the column is empty. */
function maxSeqIn_(values) {
  let max = 0;
  values.forEach(function (v) {
    const n = trailingSeq_(v);
    if (!isNaN(n)) max = Math.max(max, n);
  });
  return max;
}

/**
 * The next client and project ids, read live from the registers.
 *
 * params: { industryCode, sizeCode, clientName?, clientId? }
 * An existing client (matched by name or id in the register) keeps its id and
 * its client sequence, so its next project slots in under the same client.
 */
function nextIds_(b) {
  const out = { ok: true };

  // ── clients ──
  const cReg = register_("CLIENT_REGISTER_ID", "Client-ID-Register", CLIENT_HEADERS);
  const cHead = headerRowOf_(cReg.sheet, ["Client ID", "Client Name"]);
  const ids   = columnValues_(cReg.sheet, cHead, "Client ID");
  const names = columnValues_(cReg.sheet, cHead, "Client Name");

  let existingIdx = -1;
  const wantName = normHeader_(b.clientName || "");
  const wantId   = String(b.clientId || "").trim().toUpperCase();
  for (let i = 0; i < Math.max(ids.length, names.length); i++) {
    const nm = normHeader_(names[i] || "");
    if (wantId && String(ids[i] || "").toUpperCase() === wantId) { existingIdx = i; break; }
    if (wantName && nm && nm === wantName) { existingIdx = i; break; }
  }

  if (existingIdx >= 0) {
    out.clientExisted = true;
    out.clientId   = ids[existingIdx] || "";
    out.clientName = names[existingIdx] || "";
    out.clientSeq  = trailingSeq_(out.clientId);
    // The codes live inside the id itself (Eb-{industry}-{size}-{seq}) — more
    // reliable than matching the register's free-text industry column.
    const em = String(out.clientId).match(/^Eb-([0-9A-Za-z]+)-([A-Za-z]+)-/i);
    if (em) { out.industryCode = em[1]; out.sizeCode = em[2]; }
  } else {
    out.clientExisted = false;
    out.clientSeq = maxSeqIn_(ids) + 1;
    out.clientId  = (b.industryCode && b.sizeCode)
      ? "Eb-" + b.industryCode + "-" + b.sizeCode + "-" + pad2_(out.clientSeq)
      : "";
  }
  out.clientRegisterUrl = cReg.ss.getUrl();
  out.clientsInRegister = ids.filter(String).length;

  // ── projects ──
  const pReg  = register_("PROJECT_REGISTER_ID", "Project-ID-Register", PROJECT_HEADERS);
  const pHead = headerRowOf_(pReg.sheet, ["Project ID", "Client Name"]);
  const pIds  = columnValues_(pReg.sheet, pHead, "Project ID");

  out.projectSeq = maxSeqIn_(pIds) + 1;
  out.lastProjectId = pIds.filter(String).slice(-1)[0] || "";
  // The client's own segment: its sequence, or the industry/size just picked.
  const cSeq = isNaN(out.clientSeq) ? null : pad2_(out.clientSeq);
  const indC = b.industryCode || out.industryCode, sizC = b.sizeCode || out.sizeCode;
  out.projectId = (indC && sizC && cSeq)
    ? "EbX-" + indC + "-" + sizC + "-" + cSeq + "-" + pad2_(out.projectSeq)
    : "";
  out.projectRegisterUrl = pReg.ss.getUrl();
  out.projectsInRegister = pIds.filter(String).length;

  return out;
}

/** Type-ahead over the client register: "does hitachi exist yet?" */
function searchClients_(b) {
  const q = normHeader_(b.q || "");
  const reg = register_("CLIENT_REGISTER_ID", "Client-ID-Register", CLIENT_HEADERS);
  const head = headerRowOf_(reg.sheet, ["Client ID", "Client Name", "Industry", "Org Size"]);
  const ids   = columnValues_(reg.sheet, head, "Client ID");
  const names = columnValues_(reg.sheet, head, "Client Name");
  const inds  = columnValues_(reg.sheet, head, "Industry");
  const sizes = columnValues_(reg.sheet, head, "Org Size");

  const hits = [];
  for (let i = 0; i < names.length; i++) {
    if (!names[i]) continue;
    const n = normHeader_(names[i]);
    if (q && n.indexOf(q) < 0) continue;
    hits.push({
      clientId: ids[i] || "", name: names[i],
      industry: inds[i] || "", orgSize: sizes[i] || "",
      seq: trailingSeq_(ids[i] || ""),
    });
    if (hits.length >= 25) break;
  }
  return { ok: true, matches: hits, total: names.filter(String).length, registerUrl: reg.ss.getUrl() };
}


/* ── Claude — the portal's chat brain ──────────────────────────────────────
   The portal cannot call Anthropic directly: doing so would ship the API key
   in the browser bundle, where anyone can read it. So the call goes through
   here — the web app is already token-gated, and the key sits in this
   script's properties where only the script can read it.

   ONE-TIME SETUP
     ⚙ Project Settings → Script properties → Add script property
       ANTHROPIC_API_KEY = sk-ant-…      (console.anthropic.com → API keys)
     Then Deploy → Manage deployments → ✏️ → Version: New version → Deploy.

   REQUEST   { action:"ai.chat", prompt, system?, maxTokens?, effort?, schema? }
   RESPONSE  { ok:true, text, json?, model, stopReason, usage }
   Passing a JSON Schema makes the answer machine-readable: the model is
   constrained to that shape and `json` comes back already parsed, which is
   what the wizard's extract-and-classify steps rely on.                     */

function anthropicKey_() {
  try {
    return String(PropertiesService.getScriptProperties()
      .getProperty("ANTHROPIC_API_KEY") || "").trim();
  } catch (e) { return ""; }
}

const AI_SETUP_HINT =
  "Claude is not wired up yet. In this Apps Script project: ⚙ Project Settings → " +
  "Script properties → Add script property → ANTHROPIC_API_KEY = your key from " +
  "console.anthropic.com, then redeploy (Manage deployments → ✏️ → New version).";

function aiChat_(b) {
  const key = anthropicKey_();
  if (!key) return { ok: false, error: AI_SETUP_HINT };
  if (!b.prompt) return { ok: false, error: "ai.chat needs a prompt" };

  const payload = {
    model: String(b.model || CONFIG.AI_MODEL),
    max_tokens: Math.min(Math.max(parseInt(b.maxTokens, 10) || CONFIG.AI_MAX_TOKENS, 256), 16000),
    // Adaptive thinking: the model decides how much to think per request.
    // (budget_tokens is rejected on this model family — do not add it back.)
    thinking: { type: "adaptive" },
    output_config: { effort: String(b.effort || CONFIG.AI_EFFORT) },
    messages: [{ role: "user", content: String(b.prompt) }],
  };
  if (b.system) payload.system = String(b.system);
  if (b.schema) payload.output_config.format = { type: "json_schema", schema: b.schema };

  const r = anthropicFetch_(key, payload);
  if (r.error) return { ok: false, error: r.error };
  const body = r.body;
  // A safety decline arrives as HTTP 200 with no usable content — check it
  // before reading the content array.
  if (body.stop_reason === "refusal") {
    return { ok: false, refusal: true, error: "Claude declined to answer this one. Rephrase, or fill it in manually." };
  }

  const text = (body.content || [])
    .filter(function (c) { return c && c.type === "text"; })
    .map(function (c) { return c.text || ""; })
    .join("").trim();

  const out = {
    ok: true, text: text, model: body.model,
    stopReason: body.stop_reason, usage: body.usage,
  };
  if (b.schema) {
    try { out.json = JSON.parse(text); }
    catch (e) { out.jsonError = "Claude's answer was not valid JSON"; }
  }
  return out;
}

/** One Messages-API round trip; both ai.chat and the agent loop go through
    here so error handling lives in one place. */
function anthropicFetch_(key, payload) {
  let res;
  try {
    res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    return { error: "Could not reach Anthropic: " + String(e && e.message || e) };
  }
  const code = res.getResponseCode();
  const raw = res.getContentText() || "";
  let body = null;
  try { body = JSON.parse(raw); } catch (e) { /* handled below */ }
  if (code !== 200 || !body) {
    const msg = (body && body.error && body.error.message) || raw.slice(0, 300) || "no body";
    if (code === 401) return { error: "Anthropic rejected the API key (401). " + AI_SETUP_HINT };
    if (code === 429) return { error: "Anthropic rate limit hit (429) — try again in a moment." };
    return { error: "Anthropic HTTP " + code + ": " + msg };
  }
  return { body: body };
}

/** Run this from the editor once to prove the key works. */
function testAnthropic() {
  const r = aiChat_({ prompt: "Reply with the single word: ready", maxTokens: 256, effort: "low" });
  Logger.log(JSON.stringify(r, null, 2));
}


/* ── Claude with Drive hands — the agentic loop ────────────────────────────
   ai.agent gives Claude five TOOLS and loops until it stops asking for them:
   search Drive, list a folder, read a file (Docs / Sheets / text), write a
   Google Doc, and read the ID registers. Everything runs as this script's
   owner, so the assistant sees exactly what the admin account sees — the
   SHARED_TOKEN on the request is what keeps it portal-only.

   REQUEST  { action:"ai.agent", messages:[{role,content}…] | prompt, effort? }
   RESPONSE { ok:true, text, trace:[{tool,detail,ok}…], rounds, usage }

   NOTE the first run after pasting this version asks for one more Google
   permission (Docs access) — approve it once and it never asks again.       */

const AI_TOOLS = [
  {
    name: "drive_search",
    description: "Search Google Drive by file name and by full text. Returns up to maxResults files with fileId, name, mimeType, url, folder and modified time. Use short distinctive queries (a project id like 'EbX-22-PL-03-47', a doc name fragment).",
    input_schema: { type: "object", properties: {
      query: { type: "string", description: "The search text" },
      maxResults: { type: "integer", description: "Max files to return, default 10, cap 20" },
    }, required: ["query"] },
  },
  {
    name: "drive_list",
    description: "List the sub-folders and files directly inside one Drive folder.",
    input_schema: { type: "object", properties: {
      folderId: { type: "string", description: "The folder's id" },
    }, required: ["folderId"] },
  },
  {
    name: "drive_read",
    description: "Read a file's content as text. Google Docs → body text; Google Sheets → up to 5 tabs, 200 rows each, tab-separated; text/csv/json → raw. Binary files return metadata only.",
    input_schema: { type: "object", properties: {
      fileId: { type: "string" },
      maxChars: { type: "integer", description: "Content cap, default 20000, max 50000" },
    }, required: ["fileId"] },
  },
  {
    name: "drive_write",
    description: "Write a Google Doc. Give fileId to update an existing Doc (mode 'append' adds at the end — the default; 'replace' overwrites the whole body, use only when asked to rewrite). Or give title (+ folderId) to create a new Doc. Returns the doc's url.",
    input_schema: { type: "object", properties: {
      fileId: { type: "string", description: "Existing Doc to update" },
      mode: { type: "string", enum: ["append", "replace"] },
      title: { type: "string", description: "Name for a new Doc" },
      folderId: { type: "string", description: "Where to create the new Doc — use the project's folder when the doc belongs to a project" },
      content: { type: "string", description: "The text to write" },
    }, required: ["content"] },
  },
  {
    name: "register_read",
    description: "Read one of the Elecbits ID registers as rows: 'clients' (client ids/names), 'projects' (project ids), 'pcbs' (board SKUs). This is the source of truth for IDs — use it instead of hunting the sheets by hand.",
    input_schema: { type: "object", properties: {
      register: { type: "string", enum: ["clients", "projects", "pcbs"] },
    }, required: ["register"] },
  },
];

function agentSystem_() {
  return [
    "You are the Elecbits ULM assistant with live Google Drive access through tools. Elecbits is an Indian electronics ODM; this Drive holds its client/project registers, project-management folders and PCB & firmware folders.",
    "Known anchor folders (use drive_list to explore them):",
    "- Registry (ID registers live here): " + CONFIG.REGISTRY_FOLDER_ID,
    "- Project Management area (one folder per Project ID): " + CONFIG.PROJECTS_PARENT_FOLDER_ID,
    "- PCB & Firmware area (one folder per PCB ID): " + CONFIG.PCB_PARENT_FOLDER_ID,
    "- Project template tree: " + CONFIG.PROJECT_TEMPLATE_FOLDER_ID + " · PCB template tree: " + CONFIG.PCB_TEMPLATE_FOLDER_ID,
    "Ways of working: find a project's folder by searching its Project ID. Use register_read for anything about IDs, clients or projects before searching raw files. When you create or edit a doc, put it in the right project folder and ALWAYS give the user the link. Never overwrite a doc body (mode replace) unless the user asked for a rewrite. Be concise; answer in short paragraphs or tight lists; links inline.",
  ].join("\n");
}

function aiAgent_(b) {
  const key = anthropicKey_();
  if (!key) return { ok: false, error: AI_SETUP_HINT };

  let messages = Array.isArray(b.messages) && b.messages.length
    ? b.messages.slice(-20).map(function (m) {
        // History from the browser is text only — content blocks (tool_use etc.)
        // are minted exclusively inside this loop.
        return { role: m.role === "assistant" ? "assistant" : "user",
                 content: String(typeof m.content === "string" ? m.content : "").slice(0, 8000) || "…" };
      })
    : b.prompt ? [{ role: "user", content: String(b.prompt) }] : null;
  if (!messages) return { ok: false, error: "ai.agent needs messages or a prompt" };

  const trace = [];
  let usage = { input_tokens: 0, output_tokens: 0 };

  for (let round = 1; round <= 8; round++) {
    const r = anthropicFetch_(key, {
      model: String(b.model || CONFIG.AI_MODEL),
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: String(b.effort || "medium") },
      system: agentSystem_(),
      tools: AI_TOOLS,
      messages: messages,
    });
    if (r.error) return { ok: false, error: r.error, trace: trace };
    const body = r.body;
    if (body.usage) {
      usage.input_tokens += body.usage.input_tokens || 0;
      usage.output_tokens += body.usage.output_tokens || 0;
    }
    if (body.stop_reason === "refusal") {
      return { ok: false, refusal: true, error: "Claude declined this request.", trace: trace };
    }

    const toolUses = (body.content || []).filter(function (c) { return c.type === "tool_use"; });
    const text = (body.content || []).filter(function (c) { return c.type === "text"; })
      .map(function (c) { return c.text || ""; }).join("").trim();

    if (body.stop_reason !== "tool_use" || !toolUses.length) {
      return { ok: true, text: text, trace: trace, rounds: round, usage: usage };
    }

    // Keep the assistant turn VERBATIM (thinking blocks included — the API
    // requires them back), then answer every tool call.
    messages.push({ role: "assistant", content: body.content });
    const results = toolUses.map(function (tu) {
      let out;
      try { out = runAiTool_(tu.name, tu.input || {}); }
      catch (e) { out = { error: String(e && e.message || e) }; }
      trace.push({ tool: tu.name, detail: toolDetail_(tu.name, tu.input, out), ok: !out.error });
      return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 40000) };
    });
    messages.push({ role: "user", content: results });

    if (outOfTime()) {
      return { ok: true, partial: true, trace: trace, rounds: round, usage: usage,
               text: text || "I ran out of time mid-task — the tool calls above did run; ask me to continue." };
    }
  }
  return { ok: true, partial: true, trace: trace, rounds: 8, usage: usage,
           text: "I hit the round limit before finishing — ask me to continue from here." };
}

function runAiTool_(name, inp) {
  switch (name) {
    case "drive_search":  return toolSearch_(inp);
    case "drive_list":    return toolList_(inp);
    case "drive_read":    return toolRead_(inp);
    case "drive_write":   return toolWrite_(inp);
    case "register_read": return toolRegister_(inp);
    default: return { error: "Unknown tool " + name };
  }
}

function toolDetail_(name, inp, out) {
  inp = inp || {};
  if (name === "drive_search")  return inp.query || "";
  if (name === "drive_list")    return (out && out.folder) || inp.folderId || "";
  if (name === "drive_read")    return (out && out.name) || inp.fileId || "";
  if (name === "drive_write")   return inp.title || (out && out.name) || inp.fileId || "";
  if (name === "register_read") return inp.register || "";
  return "";
}

function fileRow_(f) {
  let folder = "";
  try { const ps = f.getParents(); if (ps.hasNext()) folder = ps.next().getName(); } catch (e) { /* shared roots */ }
  return { fileId: f.getId(), name: f.getName(), mimeType: f.getMimeType(),
           url: f.getUrl(), modified: f.getLastUpdated().toISOString(), folder: folder };
}

function toolSearch_(inp) {
  const q = String(inp.query || "").replace(/'/g, "\\'").trim();
  if (!q) return { error: "query required" };
  const max = Math.min(Math.max(inp.maxResults || 10, 1), 20);
  const out = [], seen = {};
  ["title contains '" + q + "'", "fullText contains '" + q + "'"].forEach(function (expr) {
    if (out.length >= max) return;
    const it = DriveApp.searchFiles(expr + " and trashed = false");
    while (it.hasNext() && out.length < max) {
      const f = it.next();
      if (seen[f.getId()]) continue;
      seen[f.getId()] = 1;
      out.push(fileRow_(f));
    }
  });
  return { results: out, count: out.length };
}

function toolList_(inp) {
  const folder = DriveApp.getFolderById(String(inp.folderId || ""));
  const folders = [], files = [];
  const fi = folder.getFolders();
  while (fi.hasNext() && folders.length < 50) { const f = fi.next(); folders.push({ folderId: f.getId(), name: f.getName(), url: f.getUrl() }); }
  const gi = folder.getFiles();
  while (gi.hasNext() && files.length < 50) files.push(fileRow_(gi.next()));
  return { folder: folder.getName(), url: folder.getUrl(), folders: folders, files: files };
}

function toolRead_(inp) {
  const file = DriveApp.getFileById(String(inp.fileId || ""));
  const mime = file.getMimeType();
  const cap = Math.min(Math.max(inp.maxChars || 20000, 1000), 50000);
  let text;
  if (mime === MimeType.GOOGLE_DOCS) {
    text = DocumentApp.openById(file.getId()).getBody().getText();
  } else if (mime === MimeType.GOOGLE_SHEETS) {
    const parts = [];
    SpreadsheetApp.openById(file.getId()).getSheets().slice(0, 5).forEach(function (sh) {
      const rows = Math.min(sh.getLastRow(), 200), cols = Math.min(sh.getLastColumn(), 26);
      if (!rows || !cols) return;
      parts.push("## Tab: " + sh.getName() + "\n" +
        sh.getRange(1, 1, rows, cols).getValues().map(function (r) { return r.join("\t"); }).join("\n"));
    });
    text = parts.join("\n\n");
  } else if (/^text\/|json|csv|xml/.test(mime)) {
    text = file.getBlob().getDataAsString();
  } else {
    return { name: file.getName(), mimeType: mime, url: file.getUrl(),
             error: "Binary format — cannot read as text; give the user the link instead." };
  }
  return { name: file.getName(), mimeType: mime, url: file.getUrl(),
           truncated: text.length > cap, content: text.slice(0, cap) };
}

function toolWrite_(inp) {
  const content = String(inp.content || "");
  if (inp.fileId) {
    const doc = DocumentApp.openById(String(inp.fileId));
    if (inp.mode === "replace") doc.getBody().setText(content);
    else doc.getBody().appendParagraph(content);
    doc.saveAndClose();
    return { fileId: doc.getId(), name: doc.getName(), url: doc.getUrl(),
             action: inp.mode === "replace" ? "replaced body" : "appended" };
  }
  if (!inp.title) return { error: "Give fileId (existing doc) or title (new doc)" };
  const doc = DocumentApp.create(String(inp.title));
  doc.getBody().setText(content);
  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  const dest = String(inp.folderId || CONFIG.REGISTRY_FOLDER_ID);
  try { file.moveTo(DriveApp.getFolderById(dest)); }
  catch (e) { return { fileId: doc.getId(), name: doc.getName(), url: doc.getUrl(), action: "created (could not move to folder " + dest + ")" }; }
  return { fileId: doc.getId(), name: doc.getName(), url: doc.getUrl(), action: "created" };
}

function toolRegister_(inp) {
  const res = listRegistry_({ register: inp.register });
  if (!res.ok) return { error: res.error || "register unreadable" };
  return { register: inp.register, headers: res.headers,
           total: res.rows.length, rows: res.rows.slice(-100), url: res.registerUrl };
}


/* ── the registers — the Drive-side source of truth for IDs ───────────────── */

/**
 * Resolve a register to an editable Google Sheet.
 *
 * These registers are REAL, live files with years of rows in them, so this is
 * deliberately careful: an .xlsx is refused (with instructions) unless
 * AUTO_CONVERT_REGISTERS says otherwise, and nothing is ever created on top
 * of an existing file. Only a completely unconfigured register is created
 * from scratch.
 */
function register_(idProp, title, headers) {
  let id = CONFIG[idProp];
  const tabWanted = CONFIG[idProp.replace(/_ID$/, "_TAB")] || "";
  const props = PropertiesService.getScriptProperties();
  if (!id) id = props.getProperty(idProp) || "";

  let ss;
  if (id) {
    const file = DriveApp.getFileById(id);
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      if (!CONFIG.AUTO_CONVERT_REGISTERS) {
        throw new Error(
          '"' + file.getName() + '" is an .xlsx, and a script cannot append a row to an .xlsx. ' +
          'Either open it and use File → Save as Google Sheets (then put the NEW file id in ' +
          idProp + '), or set AUTO_CONVERT_REGISTERS: true to let this script convert it once.');
      }
      // Registers are linked from all over the company, so the original is
      // left exactly where it is — only a Sheets twin is made alongside it.
      const converted = convertToSheet_(file, null, false);
      props.setProperty(idProp, converted.getId());   // remember the new id
      ss = SpreadsheetApp.openById(converted.getId());
    } else {
      ss = SpreadsheetApp.openById(id);
    }
  } else {
    ss = SpreadsheetApp.create(title);
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(CONFIG.REGISTRY_FOLDER_ID));
    props.setProperty(idProp, ss.getId());
  }

  // The right tab, not merely the first one — these workbooks carry
  // "Discarded" and archive tabs that must never receive a new row.
  let sheet = null;
  if (tabWanted) {
    const want = normHeader_(tabWanted);
    ss.getSheets().forEach(function (s) {
      if (!sheet && normHeader_(s.getName()) === want) sheet = s;
    });
    if (!sheet) {
      throw new Error('Tab "' + tabWanted + '" not found in "' + ss.getName() +
        '". Tabs present: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(" · "));
    }
  } else {
    sheet = ss.getSheets()[0];
  }

  if (sheet.getLastRow() === 0) {          // only ever true for a register we just created
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return { ss: ss, sheet: sheet };
}

const normHeader_ = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Header aliases: the same column under the names these sheets actually use.
   The exact headers of the three live Elecbits registers are all in here. */
const HEADER_ALIASES = {
  "Client ID":    ["clientid", "clientidno", "ebclientid", "clientcode"],
  "Client Name":  ["clientname", "client", "companyname", "company", "nameoftheclient",
                   "customername", "customer", "organisationname", "organizationname", "orgname"],
  "Industry":     ["industry", "industrytype", "sector", "domain", "categoryindustry", "industrycategory"],
  "Org Size":     ["orgsize", "organisationsize", "organizationsize", "companysize",
                   "clienttype", "clientcategoryorgsize", "clientcategory"],
  "Contact":      ["contact", "contactperson", "contactname", "spoc", "spocname", "poc",
                   "pointofcontact", "customerspoc", "clientspoc"],
  "Designation":  ["designation", "role", "title", "contactdesignation"],
  "Email":        ["email", "emailid", "mail", "contactemail"],
  "Phone":        ["phone", "phoneno", "phonenumber", "mobile", "contactno", "contactnumber"],
  "Project ID":   ["projectid", "projectidno", "ebprojectid", "projectcode"],
  "Project Name": ["projectname", "project", "nameoftheproject", "productname", "generaldevicename", "devicename"],
  "Kind":         ["kind", "type", "projecttype", "category", "deliverytype"],
  "Description":  ["description", "desc", "scope", "details", "remarks"],
  "Status":       ["status", "projectstatus", "currentstatus", "activestatus"],
  "Deadline":     ["deadline", "duedate", "targetdate", "enddate", "deliverydate"],
  "Folder Link":  ["folderlink", "drivelink", "folder", "link", "folderurl",
                   "productfolderlink", "clientfolder", "projectfolder", "projectfolderlink"],
  "Board Name":   ["boardname", "board", "pcbname", "generaldevicename", "devicename", "skuname"],
  // The Hardware SKU sheet files its board ids under "Eb Project ID"; that is
  // a different workbook from the project register, so there is no clash.
  "PCB ID":       ["pcbid", "pcbidno", "ebpcbid", "boardid", "ebprojectid", "projectid", "sku", "skuid"],
  "Created By":   ["createdby", "raisedby", "owner", "addedby", "by"],
  "Created At":   ["createdat", "createdon", "date", "dateadded", "timestamp", "projectcreatedon", "projectcreated"],
};

/* A running serial column ("S. no.", "S. No") — filled with the next number
   so the register keeps counting the way a human would continue it. */
const SERIAL_HEADERS = ["sno", "sno.", "serialno", "srno", "sl", "slno", "serialnumber", "s"];
function serialColumnOf_(headerRow) {
  for (let c = 0; c < headerRow.length; c++) {
    const h = normHeader_(headerRow[c]);
    if (h && SERIAL_HEADERS.indexOf(h) >= 0) return c + 1;
  }
  return 0;
}

/** Find the column (1-based) whose header matches this logical field. */
function columnFor_(headerRow, field) {
  const wanted = [normHeader_(field)].concat(HEADER_ALIASES[field] || []);
  for (let c = 0; c < headerRow.length; c++) {
    const h = normHeader_(headerRow[c]);
    if (!h) continue;
    if (wanted.indexOf(h) >= 0) return c + 1;
  }
  // Softer second pass: a header that CONTAINS the field name.
  const key = normHeader_(field);
  for (let c = 0; c < headerRow.length; c++) {
    const h = normHeader_(headerRow[c]);
    if (h && (h.indexOf(key) >= 0 || key.indexOf(h) >= 0) && h.length > 3) return c + 1;
  }
  return 0;
}

/** The header row of a register: the first row that maps at least 2 fields. */
function headerRowOf_(sheet, fields) {
  const probe = Math.min(sheet.getLastRow(), 12) || 1;
  const width = Math.max(sheet.getLastColumn(), 1);
  const grid = sheet.getRange(1, 1, probe, width).getValues();
  let best = { row: 1, hits: 0, values: grid[0] || [] };
  for (let r = 0; r < grid.length; r++) {
    let hits = 0;
    fields.forEach(function (f) { if (columnFor_(grid[r], f)) hits++; });
    if (hits > best.hits) best = { row: r + 1, hits: hits, values: grid[r] };
  }
  return best;
}

/**
 * Append a row into the register's OWN column layout.
 *
 * `values` is { "Client ID": "...", "Client Name": "..." }. Each key is
 * matched to a column by header name, so a register with its own ordering,
 * extra columns or different wording still gets clean data — and columns the
 * portal knows nothing about are left untouched for a human to fill.
 * Skipped entirely when that ID is already present, so retries are safe.
 */
function appendMapped_(sheet, idField, idValue, values) {
  const fields = Object.keys(values);
  const header = headerRowOf_(sheet, fields);
  const idCol = columnFor_(header.values, idField);

  // Already there? Then this is a retry — do nothing.
  if (idCol && sheet.getLastRow() > header.row) {
    const existing = sheet.getRange(header.row + 1, idCol, sheet.getLastRow() - header.row, 1).getValues();
    for (let i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim().toUpperCase() === String(idValue).trim().toUpperCase()) {
        return { added: false, matchedColumns: header.hits };
      }
    }
  }

  const width = Math.max(sheet.getLastColumn(), header.values.length, 1);
  const row = new Array(width).fill("");
  let placed = 0;
  fields.forEach(function (f) {
    const c = columnFor_(header.values, f);
    if (c) { row[c - 1] = values[f]; placed++; }
  });

  // Continue the sheet's own numbering rather than leaving a blank S. no.
  const serialCol = serialColumnOf_(header.values);
  if (serialCol && sheet.getLastRow() > header.row) {
    const seen = sheet.getRange(header.row + 1, serialCol, sheet.getLastRow() - header.row, 1).getValues();
    let max = 0;
    seen.forEach(function (r) {
      const n = parseInt(String(r[0]).replace(/[^0-9]/g, ""), 10);
      if (!isNaN(n)) max = Math.max(max, n);
    });
    row[serialCol - 1] = max + 1;
  } else if (serialCol) {
    row[serialCol - 1] = 1;
  }

  // A register whose headers match nothing is almost certainly the wrong
  // file — better to say so than to append a row of blanks to it.
  if (!placed) {
    throw new Error("None of the expected columns were found in the register sheet — check the register file id.");
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, 1, width).setValues([row]);
  return { added: true, matchedColumns: placed };
}

function registerClient_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // serialise ID allocation
  try {
    const reg = register_("CLIENT_REGISTER_ID", "Client-ID-Register", CLIENT_HEADERS);
    const clientId = b.clientId ||
      nextSequentialId_(reg.sheet, idColumnOf_(reg.sheet, "Client ID").col,
                        "EBC-" + (b.industryCode || "XX") + (b.sizeCode || "X") + "-", 3);
    const res = appendMapped_(reg.sheet, "Client ID", clientId, {
      "Client ID": clientId,
      "Client Name": b.name || "",
      "Industry": b.industry || "",
      "Org Size": b.orgSize || "",
      "Contact": b.contact || "",
      "Designation": b.designation || "",
      "Email": b.email || "",
      "Phone": b.phone || "",
      "Created By": b.by || "",
      "Created At": new Date(),
    });
    return { ok: true, clientId: clientId, registerUrl: reg.ss.getUrl(), added: res.added };
  } finally { lock.releaseLock(); }
}

function registerProject_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const reg = register_("PROJECT_REGISTER_ID", "Project-ID-Register", PROJECT_HEADERS);
    const projectId = b.projectId ||
      nextSequentialId_(reg.sheet, idColumnOf_(reg.sheet, "Project ID").col, b.prefix || "Eb-", 4);
    const res = appendMapped_(reg.sheet, "Project ID", projectId, {
      "Project ID": projectId,
      "Project Name": b.name || "",
      "Client ID": b.clientId || "",
      "Client Name": b.clientName || "",
      "Contact": b.contact || "",
      "Kind": b.kind || "",
      "Description": b.desc || "",
      "Status": b.status || "",
      "Deadline": b.deadline || "",
      "Folder Link": b.folderUrl || "",
      "Created By": b.by || "",
      "Created At": new Date(),
    });
    return { ok: true, projectId: projectId, registerUrl: reg.ss.getUrl(), added: res.added };
  } finally { lock.releaseLock(); }
}

/** Which column holds this register's IDs, whatever its layout. */
function idColumnOf_(sheet, idField) {
  const header = headerRowOf_(sheet, [idField]);
  return { col: columnFor_(header.values, idField) || 1, headerRow: header.row };
}

/** Next "<prefix><n>" where n = 1 + the highest numeric tail in the column. */
function nextSequentialId_(sheet, col, prefix, pad) {
  const last = sheet.getLastRow();
  let max = 0;
  if (last > 1) {
    const vals = sheet.getRange(2, col, last - 1, 1).getValues();
    vals.forEach(function (r) {
      const m = String(r[0] || "").match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  }
  let n = String(max + 1);
  while (n.length < (pad || 0)) n = "0" + n;
  return prefix + n;
}

function listRegistry_(b) {
  const which = b.register === "clients" ? "CLIENT_REGISTER_ID"
              : b.register === "pcbs"    ? "PCB_REGISTER_ID"
              : "PROJECT_REGISTER_ID";
  const title = b.register === "clients" ? "Client-ID-Register"
              : b.register === "pcbs"    ? "PCB-ID-Register"
              : "Project-ID-Register";
  const headers = b.register === "clients" ? CLIENT_HEADERS
                : b.register === "pcbs"    ? PCB_HEADERS
                : PROJECT_HEADERS;
  const reg = register_(which, title, headers);
  const last = reg.sheet.getLastRow();
  const rows = last > 1
    ? reg.sheet.getRange(2, 1, last - 1, headers.length).getValues()
    : [];
  return { ok: true, headers: headers, rows: rows, registerUrl: reg.ss.getUrl() };
}

/* ── project provisioning — the PM tree ───────────────────────────────────── */

function provisionProject_(b) {
  if (!b.projectId) return { ok: false, error: "projectId is required" };
  const template = DriveApp.getFolderById(CONFIG.PROJECT_TEMPLATE_FOLDER_ID);
  const parent   = DriveApp.getFolderById(CONFIG.PROJECTS_PARENT_FOLDER_ID);

  const found = folderByName_(parent, b.projectId);
  const dest = found || parent.createFolder(b.projectId);
  const resumed = Boolean(found);
  const wasComplete = resumed && String(dest.getDescription() || "").indexOf(DONE_MARK) === 0;

  // Copy (or finish copying) the tree. Already-present items are skipped by
  // name, so this is safe to call repeatedly.
  const count = { files: 0, folders: 0, skipped: 0, done: true };
  if (!wasComplete) copyTree_(template, dest, count);

  if (count.done && !wasComplete) {
    dest.setDescription(DONE_MARK + " " + new Date().toISOString());
  }

  // Only touch the process map once the tree is actually all there.
  let processMap = { updated: 0, note: "copy still in progress" };
  if (count.done) processMap = updateProcessMap_(dest, b);

  return {
    ok: true,
    resumed: resumed,
    alreadyComplete: wasComplete,
    done: count.done,                    // false → call again to resume
    folderId: dest.getId(),
    folderUrl: dest.getUrl(),
    copied: count.files,
    folders: count.folders,
    skipped: count.skipped,
    processMap: processMap,
  };
}

/* ── PCB provisioning — the engineering tree, one folder per board ─────────
   A project can carry several boards, each with its own PCB ID (assigned at
   process step 8, once the Designer LLD fixes the board count), so this is
   called once per PCB ID. */

function provisionPcb_(b) {
  if (!b.pcbId) return { ok: false, error: "pcbId is required" };
  const template = DriveApp.getFolderById(CONFIG.PCB_TEMPLATE_FOLDER_ID);
  const parent   = DriveApp.getFolderById(CONFIG.PCB_PARENT_FOLDER_ID);

  const found = folderByName_(parent, b.pcbId);
  const dest = found || parent.createFolder(b.pcbId);
  const resumed = Boolean(found);
  const wasComplete = resumed && String(dest.getDescription() || "").indexOf(DONE_MARK) === 0;

  const count = { files: 0, folders: 0, skipped: 0, done: true };
  if (!wasComplete) copyTree_(template, dest, count);
  if (count.done && !wasComplete) {
    dest.setDescription(DONE_MARK + " " + new Date().toISOString());
  }

  // Record the board in the PCB-ID register (idempotent).
  let registerUrl = "";
  if (count.done) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const reg = register_("PCB_REGISTER_ID", "PCB-ID-Register", PCB_HEADERS);
      // "Board Name" lands in the SKU sheet's "General Device Name"; the
      // board id goes under its "Eb Project ID"; the folder under
      // "Product Folder Link".
      appendMapped_(reg.sheet, "PCB ID", b.pcbId, {
        "PCB ID": b.pcbId,
        "Board Name": b.boardName || "",
        "Folder Link": dest.getUrl(),
        "Created By": b.by || "",
        "Created At": new Date(),
      });
      registerUrl = reg.ss.getUrl();
    } finally { lock.releaseLock(); }
  }

  return {
    ok: true,
    resumed: resumed,
    alreadyComplete: wasComplete,
    done: count.done,
    folderId: dest.getId(),
    folderUrl: dest.getUrl(),
    copied: count.files,
    folders: count.folders,
    skipped: count.skipped,
    registerUrl: registerUrl,
  };
}

function folderByName_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

/**
 * Copy src into dst, skipping anything already there by name. Stops early
 * (count.done = false) when the time budget runs out, so the caller can
 * resume rather than the request being killed mid-file.
 */
function copyTree_(src, dst, count) {
  if (outOfTime()) { count.done = false; return; }

  // What is already in the destination? One listing, not one query per file.
  const haveFiles = {}, haveFolders = {};
  let it = dst.getFiles();
  while (it.hasNext()) haveFiles[it.next().getName()] = true;
  it = dst.getFolders();
  while (it.hasNext()) { const f = it.next(); haveFolders[f.getName()] = f; }

  const files = src.getFiles();
  while (files.hasNext()) {
    if (outOfTime()) { count.done = false; return; }
    const f = files.next();
    if (haveFiles[f.getName()]) { count.skipped++; continue; }
    f.makeCopy(f.getName(), dst);
    count.files++;
  }

  const folders = src.getFolders();
  while (folders.hasNext()) {
    if (outOfTime()) { count.done = false; return; }
    const sub = folders.next();
    let copy = haveFolders[sub.getName()];
    if (!copy) { copy = dst.createFolder(sub.getName()); count.folders++; }
    copyTree_(sub, copy, count);
    if (!count.done) return;
  }
}

/* ── the process map — link every template row to a real file ──────────────
   The sheet ships as an uploaded .xlsx in most template folders, which
   SpreadsheetApp cannot open. Convert the project's own copy to a Google
   Sheet first (the .xlsx is moved into a "99-Source-Files" sub-folder rather
   than deleted), then write links into the Template Link column.            */

function updateProcessMap_(projectFolder, b) {
  let sheetFile = findProcessMap_(projectFolder);
  if (!sheetFile) return { updated: 0, note: "No process-map sheet found in the copied folder" };

  let converted = false;
  if (sheetFile.getMimeType() !== MimeType.GOOGLE_SHEETS) {
    try {
      const gs = convertToSheet_(sheetFile, projectFolder, true);
      if (!gs) return { updated: 0, note: "Process map is not a Google Sheet and could not be converted" };
      sheetFile = gs;
      converted = true;
    } catch (e) {
      return { updated: 0, note: "Could not convert the process map: " + (e && e.message || e) };
    }
  }

  // Where the links point: this project's own copies first (what a PM wants
  // to click), then the shared library for anything not in the tree.
  const index = indexTemplates_(projectFolder);
  if (CONFIG.TEMPLATES_LIBRARY_FOLDER_ID) {
    const lib = indexTemplates_(DriveApp.getFolderById(CONFIG.TEMPLATES_LIBRARY_FOLDER_ID));
    for (const k in lib) if (!index[k]) index[k] = lib[k];
  }

  const ss = SpreadsheetApp.openById(sheetFile.getId());
  let updated = 0, missing = 0;

  ss.getSheets().forEach(function (sheet) {
    const grid = sheet.getDataRange().getValues();
    if (!grid.length) return;

    // Locate the header row: the first row carrying a "Template ID" cell.
    let headerRow = -1, idCol = -1, linkCol = -1;
    for (let r = 0; r < Math.min(grid.length, 12); r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const v = String(grid[r][c] || "").trim().toLowerCase();
        if (v === "template id") { headerRow = r; idCol = c; }
        if (v === "template link" || v === "open") linkCol = c;
      }
      if (headerRow >= 0) break;
    }
    if (headerRow < 0 || idCol < 0) return;
    if (linkCol < 0) { // add the column at the end
      linkCol = grid[headerRow].length;
      sheet.getRange(headerRow + 1, linkCol + 1).setValue("Template Link");
    }

    for (let r = headerRow + 1; r < grid.length; r++) {
      const tid = String(grid[r][idCol] || "").trim().toUpperCase();
      if (!/^EB-T-\d+/.test(tid)) continue;
      const hit = index[tid.match(/^EB-T-\d+/)[0]];
      if (!hit) { missing++; continue; }
      sheet.getRange(r + 1, linkCol + 1)
        .setRichTextValue(SpreadsheetApp.newRichTextValue()
          .setText(hit.name).setLinkUrl(hit.url).build());
      updated++;
    }
  });

  return {
    updated: updated, missing: missing, converted: converted,
    sheetId: sheetFile.getId(), sheetUrl: sheetFile.getUrl(),
  };
}

/** The process-map file inside a project folder: name hint + a spreadsheet. */
function findProcessMap_(folder) {
  const hint = String(CONFIG.PROCESS_MAP_NAME_HINT || "process").toLowerCase();
  let best = null;
  walk_(folder, function (file) {
    if (best && best.getMimeType() === MimeType.GOOGLE_SHEETS) return;
    const name = file.getName().toLowerCase();
    if (name.indexOf(hint) < 0) return;
    const mime = file.getMimeType();
    const isSheet = mime === MimeType.GOOGLE_SHEETS;
    const isXlsx = mime === MimeType.MICROSOFT_EXCEL || /\.xlsx?$/.test(name);
    if (!isSheet && !isXlsx) return;
    if (!best || isSheet) best = file;      // a real Google Sheet wins
  }, 0);
  return best;
}

/**
 * Convert an uploaded .xlsx into a Google Sheet beside it. Uses the Drive
 * REST API with the script's own token — no advanced service to enable, no
 * extra scope beyond the Drive access DriveApp already needs.
 *
 * moveOriginal: true for a project's own process map (the folder should hold
 * exactly one live map, so the .xlsx is parked in "99-Source-Files"); false
 * for a company register, whose original is linked from everywhere and must
 * stay exactly where it is.
 */
function convertToSheet_(file, fallbackFolder, moveOriginal) {
  const name = file.getName().replace(/\.xlsx?$/i, "");
  const parents = [];
  const it = file.getParents();
  while (it.hasNext()) parents.push(it.next());
  const parent = parents.length ? parents[0] : fallbackFolder;

  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/drive/v3/files/" + file.getId() + "/copy?supportsAllDrives=true",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({
        name: name,
        mimeType: MimeType.GOOGLE_SHEETS,
        parents: [parent.getId()],
      }),
      muteHttpExceptions: true,
    });
  if (res.getResponseCode() >= 300) {
    throw new Error("Drive convert failed: " + res.getContentText().slice(0, 300));
  }
  const created = JSON.parse(res.getContentText());

  // Park the .xlsx rather than deleting it — the original upload stays
  // recoverable, but nobody edits the wrong file by accident.
  if (moveOriginal) {
    try {
      let src = folderByName_(parent, "99-Source-Files");
      if (!src) src = parent.createFolder("99-Source-Files");
      file.moveTo(src);
    } catch (e) { /* leaving it in place is not worth failing the run for */ }
  }

  return DriveApp.getFileById(created.id);
}

/** Map "EB-T-nnn" → { name, url } for every template file under a folder. */
function indexTemplates_(root) {
  const index = {};
  walk_(root, function (file) {
    const m = file.getName().toUpperCase().match(/^(EB-T-\d+)/);
    if (m && !index[m[1]]) index[m[1]] = { name: file.getName(), url: file.getUrl() };
  }, 0);
  return index;
}

function walk_(folder, onFile, depth) {
  if (depth > 8 || outOfTime()) return;
  const files = folder.getFiles();
  while (files.hasNext()) onFile(files.next());
  const folders = folder.getFolders();
  while (folders.hasNext()) walk_(folders.next(), onFile, depth + 1);
}
