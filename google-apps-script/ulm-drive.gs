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
 * 2. ⚙ Project Settings → Script properties → add SHARED_TOKEN (a long
 *    random string; same value as VITE_ULM_DRIVE_TOKEN in the portal env).
 *    Set once — future pastes of this file need no edits at all.
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
  // The web app's access token; must equal VITE_ULM_DRIVE_TOKEN in the portal
  // env. DON'T edit this line — put the real value in Script Properties
  // instead (⚙ Project Settings → Script properties → SHARED_TOKEN), the same
  // place ANTHROPIC_API_KEY lives. Properties survive every code paste, so
  // the file from the repo works untouched. This constant is only a fallback
  // and must never hold a real token in a public repo.
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

/** The real token: Script Properties first (survives every code paste), the
    CONFIG constant as fallback. The placeholder never authenticates. */
function sharedToken_() {
  let t = "";
  try { t = String(PropertiesService.getScriptProperties().getProperty("SHARED_TOKEN") || "").trim(); }
  catch (e) { /* fall through */ }
  if (!t) t = String(CONFIG.SHARED_TOKEN || "").trim();
  return t.indexOf("REPLACE") === 0 ? "" : t;
}

function handle_(body) {
  DEADLINE = Date.now() + TIME_BUDGET_MS;
  try {
    const tok = sharedToken_();
    if (!tok) {
      return json_({ ok: false, error: "No token configured — add SHARED_TOKEN in ⚙ Project Settings → Script properties" });
    }
    if (body.token !== tok) {
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
      case "registry.update":   return json_(updateRegistry_(body));
      case "ai.chat":           return json_(aiChat_(body));
      case "ai.agent":          return json_(aiAgent_(body));
      // One Drive tool, executed for the Supabase claude-ulm-agent Edge
      // Function — that variant runs the Claude loop in Supabase and only
      // borrows this script's Drive hands.
      case "tool.run":          return json_({ ok: true, result: runAiTool_(String(body.name || ""), body.input || {}) });
      // ── SOP v2.0 registrar engine (see the V2 section at the end) ──
      case "v2.locate":         return json_(v2Locate_());
      case "v2.validate":       return json_(v2Validate_());
      case "v2.allocate":       return json_(v2Allocate_(body));
      case "v2.list":           return json_(v2List_(body));
      case "v2.update":         return json_(v2Update_(body));
      case "v2.convert":        return json_(v2Convert_(body));
      case "v2.provision.project": return json_(v2ProvisionProject_(body));
      case "v2.provision.eng":  return json_(v2ProvisionEng_(body));
      case "v2.provision.run":  return json_(v2ProvisionRun_(body));
      case "v2.master":         return json_(v2Master_(body));
      case "v2.governance":     return json_(v2Governance_(body));
      case "v2.health":         return json_(v2Health_());
      case "v2.backfill":       return json_(v2Backfill_(body));
      case "v2.products":       return json_(v2Products_(body));
      case "v2.products.toSheet": return json_(v2ProductsToSheet_(body));
      case "v2.consolidate":    return json_(v2Consolidate_(body));
      case "v2.publish":        return json_(v2Publish_(body));
      case "v2.share":          return json_(v2Share_(body));
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
    name: "register_update",
    description: "Fix ONE register row in place, found by its id. Give only the columns to change, by these logical names — clients: Client Name, Industry, Org Size, Contact, Email, Phone; projects: Project Name, Client Name, Kind, Status, Deadline, Description, Folder Link; pcbs: Board Name, Folder Link. Use only when the user explicitly asks to correct or change register data; ids are never changed.",
    input_schema: { type: "object", properties: {
      register: { type: "string", enum: ["clients", "projects", "pcbs"] },
      id: { type: "string", description: "The row's Client ID / Project ID / PCB ID" },
      values: { type: "object", description: "logical column name → new value", additionalProperties: { type: "string" } },
    }, required: ["register", "id", "values"] },
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
    case "register_update": {
      const r = updateRegistry_(inp);
      return r.ok ? { row: r.row, changed: r.changed, unmapped: r.unmapped, url: r.registerUrl } : { error: r.error };
    }
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
  if (name === "register_update") return (inp.register || "") + " " + (inp.id || "");
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
  // The sheet's OWN header row and columns, values formatted as displayed —
  // this is a mirror of the master, not a projection onto this tool's fields.
  const head = headerRowOf_(reg.sheet, headers);
  const lastRow = reg.sheet.getLastRow();
  const lastCol = Math.min(Math.max(reg.sheet.getLastColumn(), 1), 26);
  const hvals = reg.sheet.getRange(head.row, 1, 1, lastCol).getDisplayValues()[0];
  const rows = lastRow > head.row
    ? reg.sheet.getRange(head.row + 1, 1, lastRow - head.row, lastCol).getDisplayValues()
    : [];
  return { ok: true, headers: hvals, rows: rows, headerRow: head.row, registerUrl: reg.ss.getUrl() };
}

/**
 * Fix ONE register row in place, found by its id.
 *   { register: clients|projects|pcbs, id: "Eb-20-ML-521",
 *     values: { "Client Name": "Curefit", ... } }
 * Field names are this tool's logical ones — they map onto whatever columns
 * the sheet actually has (same aliases as appending). Only the named columns
 * change; everything else in the row is left exactly as it is.
 */
function updateRegistry_(b) {
  const which = b.register === "clients" ? "CLIENT_REGISTER_ID"
              : b.register === "pcbs"    ? "PCB_REGISTER_ID"
              : "PROJECT_REGISTER_ID";
  const title = b.register === "clients" ? "Client-ID-Register"
              : b.register === "pcbs"    ? "PCB-ID-Register"
              : "Project-ID-Register";
  const headers = b.register === "clients" ? CLIENT_HEADERS
                : b.register === "pcbs"    ? PCB_HEADERS
                : PROJECT_HEADERS;
  const idField = b.register === "clients" ? "Client ID"
                : b.register === "pcbs"    ? "PCB ID"
                : "Project ID";
  const values = b.values || {};
  if (!b.id) return { ok: false, error: "registry.update needs the row's id" };
  if (!Object.keys(values).length) return { ok: false, error: "registry.update needs values to change" };

  const reg = register_(which, title, headers);
  const header = headerRowOf_(reg.sheet, [idField].concat(Object.keys(values)));
  const idCol = columnFor_(header.values, idField);
  if (!idCol) return { ok: false, error: "No " + idField + " column in the register" };
  const last = reg.sheet.getLastRow();
  if (last <= header.row) return { ok: false, error: "The register is empty" };

  const ids = reg.sheet.getRange(header.row + 1, idCol, last - header.row, 1).getValues();
  let row = -1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim().toUpperCase() === String(b.id).trim().toUpperCase()) { row = header.row + 1 + i; break; }
  }
  if (row < 0) return { ok: false, error: String(b.id) + " is not in the " + (b.register || "projects") + " register" };

  const changed = [], unmapped = [];
  Object.keys(values).forEach(function (f) {
    if (values[f] === undefined || values[f] === null) return;
    const c = columnFor_(header.values, f);
    if (c) { reg.sheet.getRange(row, c).setValue(values[f]); changed.push(f); }
    else unmapped.push(f);
  });
  return { ok: true, row: row, changed: changed, unmapped: unmapped, registerUrl: reg.ss.getUrl() };
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


/* ═══ SOP v2.0 — THE REGISTRAR ENGINE ═══════════════════════════════════════
   Implements Eb-SOP_Project-Creation-and-ID-Creation_v2.0 against the LIVE
   Eb-Master_Register (a native Google Sheet — the one the XOR bot already
   writes). Coexists with every v1 action above; nothing v1 changes until the
   Phase-1 UI ships.

   Doctrine (the ten laws, in code):
   - The sheet is the sole identity authority. ALLOCATION IS THE APPEND: the
     next id is computed and its row written in the same locked execution,
     then re-read; on a collision with a co-writer (XOR), the LATER row
     repairs itself to the next free serial — the shared convention.
   - Independent ids: EB-{C,P,PCB,FW,ED,V}-YY-nnnn. YY is the Asia/Kolkata
     year at issue; serials restart at 0001 each January (the allocator only
     counts rows of the current year). PRD is read-only here; EB-PO / EB-T
     are untouched live systems. Serial 0000 is never issued (EB-C-26-0000
     is reserved for Elecbits Internal).
   - Family P is REFUSED by the generic allocator — a Project ID exists only
     through the gate-checked conversion (Phase 1), per Law 10.
   - Derived ids run per parent, never per year: Deal D%02 per client,
     BOM-%03 per board, deal-input PCB/BOM-%03 per deal, MFG-%03 per project
     (stem + ordered qty, frozen).
   - Blue worked-example rows that ship with the workbook are excluded from
     counting and reported by v2.validate; allocation REFUSES to run while
     any is present (delete them at cutover — real rows already exist).     */

const V2 = {
  // Pin the LIVE register by fileId (run v2.locate / testLocateRegister to
  // find it — it must be the same file XOR's binding points at). Blank =
  // v2 actions refuse with a clear message. Property V2_REGISTER_ID wins,
  // so pinning survives code pastes just like SHARED_TOKEN.
  MASTER_REGISTER_ID: "",
  NAME_HINT: "Eb-Master_Register",
};

const V2_TABS = {
  C:    { tab: "Clients",     regex: /^EB-C-\d{2}-\d{4}$/,   prefix: "EB-C" },
  P:    { tab: "Projects",    regex: /^EB-P-\d{2}-\d{4}$/,   prefix: "EB-P" },
  PCB:  { tab: "PCB",         regex: /^EB-PCB-\d{2}-\d{4}$/, prefix: "EB-PCB" },
  FW:   { tab: "FW",          regex: /^EB-FW-\d{2}-\d{4}$/,  prefix: "EB-FW" },
  ED:   { tab: "Enclosure",   regex: /^EB-ED-\d{2}-\d{4}$/,  prefix: "EB-ED" },
  V:    { tab: "Vendors",     regex: /^EB-V-\d{2}-\d{4}$/,   prefix: "EB-V" },
  PRD:  { tab: "PRD",         regex: /^EB-PRD-\d{2}-\d{4}$/, prefix: "EB-PRD", readOnly: true },
  DEAL:      { tab: "Deals",       regex: /^EB-C-\d{2}-\d{4}-D\d{2}$/ },
  BOM:       { tab: "BOM",         regex: /^EB-PCB-\d{2}-\d{4}-BOM-\d{3}$/ },
  DEALINPUT: { tab: "Deal Inputs", regex: /^EB-C-\d{2}-\d{4}-D\d{2}-(PCB|BOM)-\d{3}$/ },
  MFG:       { tab: "MFG",         regex: /^EB-P-\d{2}-\d{4}-MFG-\d{3}-\d+$/ },
  MASTER:    { tab: "Master" },
};

/* Explicit column order per tab — v2 writes NEVER go through the fuzzy v1
   HEADER_ALIASES (a Master row would corrupt under them). Straight from
   Eb-Master_Register_v2.0.xlsx. */
const V2_COLUMNS = {
  Clients:       ["Client ID", "Legacy ID", "Organisation Name", "Sector", "Org Size", "Status", "Drive Folder Link", "Date Added", "Added By", "Point of Contact", "Notes"],
  Deals:         ["Deal ID", "Client ID", "Deal Name", "Status", "Deal Value", "Currency", "Deal Owner", "Date Opened", "Date Closed", "Converted to Project ID", "Loss Reason", "Drive Folder Link", "Notes"],
  "Deal Inputs": ["Input ID", "Deal ID", "Client ID", "Type", "Description", "Received On", "Version as Received", "Linked PCB Input ID", "Status", "Notes"],
  Projects:      ["Project ID", "Source Deal ID", "Client ID", "Project Name", "Kind", "Status", "Project Manager", "Start Date", "Drive Folder Link", "Date Added", "Added By", "Notes"],
  PCB:           ["PCB ID", "Project ID", "Name / Alias", "Drive Folder Link", "Legacy SKU Code", "Silkscreen Marking", "Platform", "Class", "Version", "Status", "Date Added", "Added By", "Notes"],
  BOM:           ["BOM ID", "PCB ID", "Revision Reason", "Line Count", "Costed?", "Cost per Unit", "Costed On", "Status", "Date Added", "Added By", "Notes"],
  FW:            ["FW ID", "PCB ID", "Project ID", "Platform", "Latest Version (Git tag)", "Repo", "Drive Folder Link", "Status", "Date Added", "Added By", "Notes"],
  Enclosure:     ["Enclosure ID", "Project ID", "Name", "Drive Folder Link", "Material", "Version", "Status", "Date Added", "Added By", "Notes"],
  MFG:           ["MFG ID", "Project ID", "Type", "Build Stage", "Ordered Qty", "Delivered Qty", "Boards in this run", "PARENT board", "Run Folder Link", "Status", "Date Added", "Added By", "Notes"],
  Vendors:       ["Vendor ID", "Legacy ID", "Vendor Name", "Country", "Primary Service", "Additional Services", "NDA Status", "Status", "Date Added", "Added By", "Notes"],
  Master:        ["Client ID", "Deal ID", "Project ID", "PCB ID", "BOM ID", "FW ID", "Enclosure ID", "MFG ID", "Client Name (auto)", "Project Name (auto)", "Rule", "Notes"],
};

/* The workbook's blue worked-example rows (SOP §5.4). Counting ignores them;
   allocation refuses while any is still present. */
const V2_EXAMPLE_IDS = [
  "EB-C-26-0001", "EB-C-26-0002",
  "EB-C-26-0001-D01", "EB-C-26-0001-D02", "EB-C-26-0001-D03", "EB-C-26-0001-D04",
  "EB-C-26-0002-D01", "EB-C-26-0002-D02",
  "EB-C-26-0002-D01-PCB-001", "EB-C-26-0002-D01-PCB-002",
  "EB-C-26-0002-D01-BOM-001", "EB-C-26-0002-D01-BOM-002",
  "EB-P-26-0001", "EB-P-26-0002",
  "EB-PCB-26-0001", "EB-PCB-26-0002", "EB-PCB-26-0003",
  "EB-PCB-26-0001-BOM-001", "EB-PCB-26-0002-BOM-001", "EB-PCB-26-0003-BOM-001",
  "EB-FW-26-0001", "EB-FW-26-0002", "EB-FW-26-0003",
  "EB-ED-26-0001", "EB-PRD-26-0001", "EB-V-26-0001",
  "EB-P-26-0001-MFG-001-05", "EB-P-26-0001-MFG-002-50",
  "EB-P-26-0002-MFG-001-1000", "EB-P-26-0002-MFG-002-2500",
];
const v2IsExample_ = (id) => V2_EXAMPLE_IDS.indexOf(String(id).trim()) >= 0;

const v2Yy_ = () => Utilities.formatDate(new Date(), "Asia/Kolkata", "yy");
const v2Today_ = () => Utilities.formatDate(new Date(), "Asia/Kolkata", "yyyy-MM-dd");
const pad_ = (n, w) => { let s = String(n); while (s.length < w) s = "0" + s; return s; };

function v2RegisterId_() {
  let id = "";
  try { id = String(PropertiesService.getScriptProperties().getProperty("V2_REGISTER_ID") || "").trim(); }
  catch (e) { /* fall through */ }
  return id || String(V2.MASTER_REGISTER_ID || "").trim();
}

function v2Sheet_(tabName) {
  const id = v2RegisterId_();
  if (!id) throw new Error("The v2 register is not pinned. Run v2.locate, pick the LIVE Eb-Master_Register (the file XOR writes), and store its fileId as Script property V2_REGISTER_ID.");
  const ss = SpreadsheetApp.openById(id);
  const sh = ss.getSheetByName(tabName);
  if (!sh) throw new Error("The pinned register has no '" + tabName + "' tab — is this really Eb-Master_Register_v2.0? Tabs: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
  return { ss: ss, sheet: sh };
}

/* The header row: the first row whose first cell equals the tab's first
   column name (title rows sit above it). */
function v2HeaderRow_(sheet, tabName) {
  const want = (V2_COLUMNS[tabName] || [])[0];
  const probe = sheet.getRange(1, 1, Math.min(sheet.getLastRow(), 6), 1).getValues();
  for (let i = 0; i < probe.length; i++) {
    if (String(probe[i][0]).trim() === want) return i + 1;
  }
  throw new Error("Could not find the header row of '" + tabName + "' (looked for '" + want + "' in column A)");
}

/* All ids in a tab's first column below the header, with row numbers and
   font colors (blue text = shipped example). */
function v2Ids_(sheet, tabName) {
  const head = v2HeaderRow_(sheet, tabName);
  const last = sheet.getLastRow();
  if (last <= head) return { head: head, rows: [] };
  const rng = sheet.getRange(head + 1, 1, last - head, 1);
  const vals = rng.getValues();
  const colors = rng.getFontColors();
  const rows = [];
  for (let i = 0; i < vals.length; i++) {
    const id = String(vals[i][0] == null ? "" : vals[i][0]).trim();
    if (!id) continue;
    const c = String(colors[i][0] || "").toLowerCase();
    const blue = ["#0000ff", "#1155cc", "#4a86e8", "#3c78d8", "#0b5394"].indexOf(c) >= 0;
    rows.push({ id: id, row: head + 1 + i, example: blue || v2IsExample_(id) });
  }
  return { head: head, rows: rows };
}

/* ── v2.locate — find the live register so a human can pin it ────────────── */
function v2Locate_() {
  const out = { ok: true, pinned: v2RegisterId_() || null, candidates: [] };
  const it = DriveApp.searchFiles("title contains '" + V2.NAME_HINT + "' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  while (it.hasNext() && out.candidates.length < 8) {
    const f = it.next();
    const cand = { fileId: f.getId(), name: f.getName(), url: f.getUrl(), updated: f.getLastUpdated().toISOString() };
    try {
      const tabs = SpreadsheetApp.openById(f.getId()).getSheets().map(function (s) { return s.getName(); });
      cand.hasApparatus = tabs.indexOf("Counters") >= 0 && tabs.indexOf("Rules") >= 0;
      cand.hasCoreTabs = tabs.indexOf("Clients") >= 0 && tabs.indexOf("Deals") >= 0;
    } catch (e) { cand.error = String(e && e.message || e); }
    out.candidates.push(cand);
  }
  if (!out.candidates.length) out.note = "No native Sheet named like '" + V2.NAME_HINT + "' found. If only the .xlsx exists, convert it ONCE (File → Save as Google Sheets), archive the .xlsx, then locate again.";
  return out;
}

/** Editor helper: run this, read the log, put the right fileId into the
    V2_REGISTER_ID Script property. */
function testLocateRegister() {
  Logger.log(JSON.stringify(v2Locate_(), null, 2));
}

/* ── v2.validate — is the pinned register ready for allocation? ──────────── */
function v2Validate_() {
  const out = { ok: true, registerId: v2RegisterId_() || null, tabs: {}, exampleRows: [], problems: [] };
  if (!out.registerId) { out.ok = false; out.problems.push("Not pinned — run v2.locate first"); return out; }
  for (const fam in V2_TABS) {
    const t = V2_TABS[fam];
    if (fam === "MASTER") continue;
    try {
      const reg = v2Sheet_(t.tab);
      const ids = v2Ids_(reg.sheet, t.tab);
      const real = ids.rows.filter(function (r) { return !r.example; });
      // Strict-format check applies only to v2-style ids; legacy ids (mixed
      // case "Eb-…") are exempt from the format law and from counters.
      const bad = real.filter(function (r) { return t.regex && r.id.indexOf("EB-") === 0 && !t.regex.test(r.id); });
      out.tabs[t.tab] = { rows: ids.rows.length, real: real.length, examples: ids.rows.length - real.length };
      ids.rows.filter(function (r) { return r.example; }).forEach(function (r) { out.exampleRows.push(t.tab + "!" + r.row + " " + r.id); });
      if (bad.length) out.problems.push(t.tab + ": " + bad.length + " rows breach the format law (legacy ids are exempt)");
    } catch (e) { out.ok = false; out.problems.push(String(e && e.message || e)); }
  }
  if (out.exampleRows.length) out.problems.push(out.exampleRows.length + " blue worked-example rows still present — delete them before allocation (SOP §5.4); the allocator refuses while they exist.");
  out.allocationReady = out.ok && out.exampleRows.length === 0;
  return out;
}

/* ── v2.allocate — the registrar's one door ────────────────────────────────
   { family: C|PCB|FW|ED|V }                      independent
   { family: DEAL,      parent: <Client ID> }
   { family: BOM,       parent: <PCB ID> }
   { family: DEALINPUT, parent: <Deal ID>, type: PCB|BOM }
   { family: MFG,       parent: <Project ID>, qty: <ordered, positive int> }
   plus fields: { "Organisation Name": "...", ... }   (explicit v2 columns)
   Returns { ok, id, row, registerUrl }. Family P is refused — Project IDs
   exist only through the gate-checked conversion.                          */
function v2Allocate_(b) {
  const fam = String(b.family || "").toUpperCase();
  const t = V2_TABS[fam];
  if (!t || fam === "MASTER") return { ok: false, error: "Unknown family: " + b.family };
  if (fam === "P") return { ok: false, error: "Law 10: a Project ID is only minted by the sanction-gated conversion, never by the generic allocator." };
  if (t.readOnly) return { ok: false, error: fam + " issuance is governed outside this SOP (read-only here)." };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const reg = v2Sheet_(t.tab);
    let ids = v2Ids_(reg.sheet, t.tab);
    if (ids.rows.some(function (r) { return r.example; })) {
      return { ok: false, error: "Blue worked-example rows are still in '" + t.tab + "' — run v2.validate and delete them first." };
    }

    const compute = function () {
      ids = v2Ids_(reg.sheet, t.tab);
      const valid = ids.rows.filter(function (r) { return t.regex.test(r.id); }).map(function (r) { return r.id; });
      if (fam === "DEAL") {
        const parent = String(b.parent || "").trim().toUpperCase();
        if (!V2_TABS.C.regex.test(parent)) return { error: "DEAL needs a valid Client ID parent" };
        v2AssertRow_("Clients", parent);
        const n = Math.max.apply(null, [0].concat(valid.filter(function (id) { return id.indexOf(parent + "-D") === 0; }).map(function (id) { return parseInt(id.slice(-2), 10); })));
        return { id: parent + "-D" + pad_(n + 1, 2) };
      }
      if (fam === "BOM") {
        const parent = String(b.parent || "").trim().toUpperCase();
        if (!V2_TABS.PCB.regex.test(parent)) return { error: "BOM needs a valid PCB ID parent" };
        v2AssertRow_("PCB", parent);
        const n = Math.max.apply(null, [0].concat(valid.filter(function (id) { return id.indexOf(parent + "-BOM-") === 0; }).map(function (id) { return parseInt(id.slice(-3), 10); })));
        return { id: parent + "-BOM-" + pad_(n + 1, 3) };
      }
      if (fam === "DEALINPUT") {
        const parent = String(b.parent || "").trim().toUpperCase();
        const type = String(b.type || "").toUpperCase();
        if (!V2_TABS.DEAL.regex.test(parent)) return { error: "A deal input needs a valid Deal ID parent" };
        if (type !== "PCB" && type !== "BOM") return { error: "type must be PCB or BOM" };
        v2AssertRow_("Deals", parent);
        const stem = parent + "-" + type + "-";
        const n = Math.max.apply(null, [0].concat(valid.filter(function (id) { return id.indexOf(stem) === 0; }).map(function (id) { return parseInt(id.slice(-3), 10); })));
        return { id: stem + pad_(n + 1, 3) };
      }
      if (fam === "MFG") {
        const parent = String(b.parent || "").trim().toUpperCase();
        const qty = parseInt(b.qty, 10);
        if (!V2_TABS.P.regex.test(parent)) return { error: "MFG needs a valid Project ID parent" };
        if (!(qty > 0)) return { error: "MFG needs the ORDERED qty (positive integer, frozen at issue — Law 8)" };
        v2AssertRow_("Projects", parent);
        const runs = valid.filter(function (id) { return id.indexOf(parent + "-MFG-") === 0; })
          .map(function (id) { return parseInt(id.slice(parent.length + 5, parent.length + 8), 10); });
        const n = Math.max.apply(null, [0].concat(runs));
        return { id: parent + "-MFG-" + pad_(n + 1, 3) + "-" + qty };
      }
      // independent: C, PCB, FW, ED, V — serials of the CURRENT year only
      const yy = v2Yy_();
      const stem = t.prefix + "-" + yy + "-";
      const n = Math.max.apply(null, [0].concat(valid.filter(function (id) { return id.indexOf(stem) === 0; }).map(function (id) { return parseInt(id.slice(-4), 10); })));
      return { id: stem + pad_(n + 1, 4) };   // year rolls via yy; serial 0000 never returned
    };

    let got = compute();
    if (got.error) return { ok: false, error: got.error };

    // ALLOCATION IS THE APPEND — then verify, and repair OUR later row on a
    // collision with a co-writer (XOR's convention: the earlier row stands).
    const cols = V2_COLUMNS[t.tab];
    const writeRow = function (id) {
      const fields = b.fields || {};
      const row = cols.map(function (c, i) {
        if (i === 0) return id;
        if (c === "Date Added" || c === "Date Opened") return fields[c] || v2Today_();
        if (c === "Added By") return fields[c] || String(b.by || "");
        if (c === "Status") return fields[c] || (fam === "DEAL" ? "Open" : "Active");
        return fields[c] != null ? fields[c] : "";
      });
      reg.sheet.appendRow(row);
      return reg.sheet.getLastRow();
    };

    let myRow = writeRow(got.id);
    for (let attempt = 0; attempt < 3; attempt++) {
      SpreadsheetApp.flush();
      const check = v2Ids_(reg.sheet, t.tab).rows.filter(function (r) { return r.id.toUpperCase() === got.id.toUpperCase(); });
      if (check.length <= 1) break;
      const earliest = Math.min.apply(null, check.map(function (r) { return r.row; }));
      if (myRow === earliest) break;                 // ours stands; the other writer repairs
      got = compute();                               // take the next free id
      if (got.error) return { ok: false, error: got.error };
      reg.sheet.getRange(myRow, 1).setValue(got.id); // repair OUR row in place
    }

    return { ok: true, id: got.id, row: myRow, tab: t.tab, registerUrl: reg.ss.getUrl() };
  } finally {
    lock.releaseLock();
  }
}

/** Law 6 helper for derived parents: the parent must exist as a row. */
function v2AssertRow_(tabName, id) {
  const reg = v2Sheet_(tabName);
  const ok = v2Ids_(reg.sheet, tabName).rows.some(function (r) { return r.id.toUpperCase() === String(id).toUpperCase(); });
  if (!ok) throw new Error(id + " has no row in '" + tabName + "' — no register row, no children (Law 6).");
}

/* ── v2.list — read a v2 tab back (mirror / dashboards) ───────────────────── */
function v2List_(b) {
  const tabName = V2_COLUMNS[b.tab] ? b.tab : null;
  if (!tabName) return { ok: false, error: "tab must be one of: " + Object.keys(V2_COLUMNS).join(", ") };
  const reg = v2Sheet_(tabName);
  const head = v2HeaderRow_(reg.sheet, tabName);
  const lastRow = reg.sheet.getLastRow(), lastCol = Math.min(reg.sheet.getLastColumn(), 20);
  const rows = lastRow > head ? reg.sheet.getRange(head + 1, 1, lastRow - head, lastCol).getDisplayValues() : [];
  return { ok: true, headers: reg.sheet.getRange(head, 1, 1, lastCol).getDisplayValues()[0], rows: rows, registerUrl: reg.ss.getUrl() };
}


/* ═══ v2 OPERATIONS — conversion, provisioning, master, governance ══════════
   The doing half of the registrar engine. Folder anchors are pinned like the
   register: Script property V2_<KEY> wins over the constant, so pasting new
   code never loses the pins.
     V2_PROJECTS_PARENT    Eb-17-Projects
     V2_PROJECT_BLUEPRINT  01-Project-ID-Folder-PM (master, eb-templates)
     V2_PCB_CONTAINER / V2_PCB_TEMPLATE     PCB - Engineers / Developers
     V2_FW_CONTAINER  / V2_FW_TEMPLATE      Firmware-Engineers/ Developer
     V2_ED_CONTAINER  / V2_ED_TEMPLATE      Enclosure-Engineers/ Developer   */

const V2_ANCHOR_DEFAULTS = {
  PROJECTS_PARENT: "", PROJECT_BLUEPRINT: "",
  PCB_CONTAINER: "", PCB_TEMPLATE: "",
  FW_CONTAINER: "", FW_TEMPLATE: "",
  ED_CONTAINER: "", ED_TEMPLATE: "",
};
function v2Anchor_(key) {
  let v = "";
  try { v = String(PropertiesService.getScriptProperties().getProperty("V2_" + key) || "").trim(); }
  catch (e) { /* fall through */ }
  return v || String(V2_ANCHOR_DEFAULTS[key] || "").trim();
}
function v2AnchorFolder_(key, what) {
  const id = v2Anchor_(key);
  if (!id) throw new Error("Anchor V2_" + key + " is not pinned (" + what + ") — add it in Script properties.");
  return DriveApp.getFolderById(id);
}
const v2DriveId_ = (url) => {
  const m = String(url || "").match(/[-\w]{25,}/);
  return m ? m[0] : "";
};

/** Find a row by id in a v2 tab. Returns { sheet, head, row, values } or null. */
function v2FindRow_(tabName, id) {
  const reg = v2Sheet_(tabName);
  const head = v2HeaderRow_(reg.sheet, tabName);
  const last = reg.sheet.getLastRow();
  if (last <= head) return null;
  const ids = reg.sheet.getRange(head + 1, 1, last - head, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim().toUpperCase() === String(id).trim().toUpperCase()) {
      const row = head + 1 + i;
      const width = V2_COLUMNS[tabName].length;
      return { reg: reg, head: head, row: row,
               values: reg.sheet.getRange(row, 1, 1, width).getDisplayValues()[0] };
    }
  }
  return null;
}
const v2Col_ = (tabName, colName) => {
  const i = V2_COLUMNS[tabName].indexOf(colName);
  if (i < 0) throw new Error(tabName + " has no column '" + colName + "'");
  return i + 1;
};

/* ── v2.update — fix named columns of one row; ID columns are untouchable ── */
function v2Update_(b) {
  const tabName = V2_COLUMNS[b.tab] ? b.tab : null;
  if (!tabName) return { ok: false, error: "tab must be one of: " + Object.keys(V2_COLUMNS).join(", ") };
  const hit = v2FindRow_(tabName, b.id);
  if (!hit) return { ok: false, error: String(b.id) + " is not in '" + tabName + "'" };
  const values = b.values || {};
  const changed = [], refused = [];
  Object.keys(values).forEach(function (c) {
    if (values[c] === undefined || values[c] === null) return;
    if (V2_COLUMNS[tabName].indexOf(c) < 0) { refused.push(c + " (no such column)"); return; }
    // Law 1: identifiers are permanent — every *ID column is read-only here.
    if (/\bID\b/i.test(c) && c !== "Legacy ID" && c !== "Legacy SKU Code" && c !== "Linked PCB Input ID") {
      refused.push(c + " (identifier columns never change)"); return;
    }
    hit.reg.sheet.getRange(hit.row, v2Col_(tabName, c)).setValue(values[c]);
    changed.push(c);
  });
  return { ok: true, row: hit.row, changed: changed, refused: refused, registerUrl: hit.reg.ss.getUrl() };
}

/* ── v2.convert — the atomic sitting (Law 10, rule 0.2) ────────────────────
   { dealId, fields: { "Project Name", "Kind", "Project Manager" }, by }
   Gate checks live OUTSIDE (Supabase, role-gated; the ulm-proxy enforces
   them before this action). Here: assert deal Won, mint EB-P, append the
   Projects row, write Converted to Project ID — idempotent-resumable: an
   existing Projects row with this Source Deal ID completes the missing end
   instead of re-minting.                                                    */
function v2Convert_(b) {
  const dealId = String(b.dealId || "").trim().toUpperCase();
  if (!V2_TABS.DEAL.regex.test(dealId)) return { ok: false, error: "dealId must be a valid EB-C-YY-nnnn-Dss" };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const deal = v2FindRow_("Deals", dealId);
    if (!deal) return { ok: false, error: dealId + " has no row in Deals (Law 6)" };
    const status = deal.values[v2Col_("Deals", "Status") - 1];
    if (String(status).trim() !== "Won") return { ok: false, error: "Rule 0.2: only a WON deal converts — this one is '" + status + "'" };
    const clientId = String(deal.values[v2Col_("Deals", "Client ID") - 1]).trim();

    // Resume: an existing project for this deal? Complete the link instead.
    const preg = v2Sheet_("Projects");
    const phead = v2HeaderRow_(preg.sheet, "Projects");
    const plast = preg.sheet.getLastRow();
    let projectId = "", prow = 0;
    if (plast > phead) {
      const width = V2_COLUMNS.Projects.length;
      const rows = preg.sheet.getRange(phead + 1, 1, plast - phead, width).getDisplayValues();
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i][v2Col_("Projects", "Source Deal ID") - 1]).trim().toUpperCase() === dealId) {
          projectId = String(rows[i][0]).trim(); prow = phead + 1 + i; break;
        }
      }
    }
    const already = deal.values[v2Col_("Deals", "Converted to Project ID") - 1];
    if (String(already).trim() && !projectId) projectId = String(already).trim();

    if (!projectId) {
      // Mint EB-P here — the ONE lawful door (generic allocator refuses P).
      const ids = v2Ids_(preg.sheet, "Projects");
      if (ids.rows.some(function (r) { return r.example; })) return { ok: false, error: "Blue example rows still in Projects — delete them first (v2.validate)." };
      const yy = v2Yy_();
      const stem = "EB-P-" + yy + "-";
      const valid = ids.rows.map(function (r) { return r.id; }).filter(function (id) { return V2_TABS.P.regex.test(id) && id.indexOf(stem) === 0; });
      const n = Math.max.apply(null, [0].concat(valid.map(function (id) { return parseInt(id.slice(-4), 10); })));
      projectId = stem + pad_(n + 1, 4);
      const f = b.fields || {};
      preg.sheet.appendRow(V2_COLUMNS.Projects.map(function (c) {
        if (c === "Project ID") return projectId;
        if (c === "Source Deal ID") return dealId;
        if (c === "Client ID") return clientId;
        if (c === "Status") return "Active";
        if (c === "Start Date") return v2Today_();
        if (c === "Date Added") return v2Today_();
        if (c === "Added By") return String(b.by || "");
        return f[c] != null ? f[c] : "";
      }));
      prow = preg.sheet.getLastRow();
    }

    // Both ends of the link, same sitting (rule 0.2 / SOP §3.2).
    deal.reg.sheet.getRange(deal.row, v2Col_("Deals", "Converted to Project ID")).setValue(projectId);
    const dcCol = v2Col_("Deals", "Date Closed");
    if (!String(deal.values[dcCol - 1]).trim()) deal.reg.sheet.getRange(deal.row, dcCol).setValue(v2Today_());

    return { ok: true, projectId: projectId, dealId: dealId, clientId: clientId, projectRow: prow, registerUrl: preg.ss.getUrl() };
  } finally { lock.releaseLock(); }
}

/* ── v2 provisioning — register row FIRST, folder second, link third ─────── */

function v2CopyTo_(templateKey, parentKey, name) {
  const template = v2AnchorFolder_(templateKey, "blueprint");
  const parent = v2AnchorFolder_(parentKey, "container");
  let dst = folderByName_(parent, name);
  if (!dst) dst = parent.createFolder(name);
  if ((dst.getDescription() || "").indexOf(DONE_MARK) >= 0) {
    return { folder: dst, done: true, copied: 0, folders: 0, already: true };
  }
  const count = { copied: 0, folders: 0, skipped: 0 };
  const finished = copyTree_(template, dst, count);
  if (finished) dst.setDescription(DONE_MARK + " " + new Date().toISOString());
  return { folder: dst, done: finished, copied: count.copied, folders: count.folders };
}

/** { projectId, lldUrls?: [customer, designer], by } — blueprint copy into
    Eb-17-Projects, link back, LLD PDFs copied into 03-LLD-HLD, governance
    doc seeded. done:false = call again (same resume protocol as v1). */
function v2ProvisionProject_(b) {
  const projectId = String(b.projectId || "").trim().toUpperCase();
  const hit = v2FindRow_("Projects", projectId);
  if (!hit) return { ok: false, error: projectId + " has no Projects row — no register row, no folder (Law 6)" };
  const res = v2CopyTo_("PROJECT_BLUEPRINT", "PROJECTS_PARENT", projectId);
  const out = { ok: true, projectId: projectId, folderId: res.folder.getId(), folderUrl: res.folder.getUrl(),
                copied: res.copied, folders: res.folders, done: res.done };
  if (!res.done) return out;                      // caller loops
  hit.reg.sheet.getRange(hit.row, v2Col_("Projects", "Drive Folder Link")).setValue(res.folder.getUrl());

  // Gate evidence into the tree: locked LLD PDFs → 02-…R&D-PM / 03-LLD-HLD.
  out.lldCopied = 0;
  (b.lldUrls || []).forEach(function (u) {
    try {
      const fid = v2DriveId_(u);
      if (!fid) return;
      const rnd = v2SubByPattern_(res.folder, /R&D/i);
      const lld = rnd ? v2SubByPattern_(rnd, /LLD/i) : null;
      if (lld) { DriveApp.getFileById(fid).makeCopy(DriveApp.getFileById(fid).getName(), lld); out.lldCopied++; }
    } catch (e) { /* evidence stays linked in the gate record */ }
  });
  out.governance = v2Governance_({ projectId: projectId, line: "Project opened from " +
    String(hit.values[v2Col_("Projects", "Source Deal ID") - 1] || "?") + ". Six gate conditions verified in the portal.", by: b.by }).docUrl || "";
  return out;
}
function v2SubByPattern_(folder, re) {
  const it = folder.getFolders();
  while (it.hasNext()) { const f = it.next(); if (re.test(f.getName())) return f; }
  return null;
}

/** { family: PCB|FW|ED, id } — engineering container copy + link back. */
function v2ProvisionEng_(b) {
  const fam = String(b.family || "").toUpperCase();
  const map = { PCB: ["PCB_TEMPLATE", "PCB_CONTAINER", "PCB"], FW: ["FW_TEMPLATE", "FW_CONTAINER", "FW"], ED: ["ED_TEMPLATE", "ED_CONTAINER", "Enclosure"] };
  if (!map[fam]) return { ok: false, error: "family must be PCB, FW or ED" };
  const id = String(b.id || "").trim().toUpperCase();
  const hit = v2FindRow_(map[fam][2], id);
  if (!hit) return { ok: false, error: id + " has no register row (Law 6)" };
  const res = v2CopyTo_(map[fam][0], map[fam][1], id);
  const out = { ok: true, id: id, folderId: res.folder.getId(), folderUrl: res.folder.getUrl(), copied: res.copied, folders: res.folders, done: res.done };
  if (!res.done) return out;
  hit.reg.sheet.getRange(hit.row, v2Col_(map[fam][2], "Drive Folder Link")).setValue(res.folder.getUrl());
  return out;
}

/** { mfgId } — run folder under <project>/03-…SCS/06-Production, one
    sub-folder per board from the MFG row, link back. */
function v2ProvisionRun_(b) {
  const mfgId = String(b.mfgId || "").trim().toUpperCase();
  if (!V2_TABS.MFG.regex.test(mfgId)) return { ok: false, error: "mfgId must be EB-P-YY-nnnn-MFG-nnn-qty" };
  const hit = v2FindRow_("MFG", mfgId);
  if (!hit) return { ok: false, error: mfgId + " has no MFG row (Law 6)" };
  const projectId = mfgId.replace(/-MFG-\d{3}-\d+$/, "");
  const proj = v2FindRow_("Projects", projectId);
  if (!proj) return { ok: false, error: projectId + " has no Projects row" };
  const pfid = v2DriveId_(proj.values[v2Col_("Projects", "Drive Folder Link") - 1]);
  if (!pfid) return { ok: false, error: projectId + " has no Drive Folder Link yet — provision the project first" };
  const pfolder = DriveApp.getFolderById(pfid);
  const scs = v2SubByPattern_(pfolder, /SCS/i);
  const prod = scs ? (v2SubByPattern_(scs, /Production/i) || scs.createFolder("06-Production")) : null;
  if (!prod) return { ok: false, error: "Could not find the 03-…SCS branch inside " + projectId };
  let run = folderByName_(prod, mfgId);
  if (!run) run = prod.createFolder(mfgId);
  const boards = String(hit.values[v2Col_("MFG", "Boards in this run") - 1] || "").split(",").map(function (s) { return s.trim(); }).filter(String);
  boards.forEach(function (bid) { if (!folderByName_(run, bid)) run.createFolder(bid); });
  hit.reg.sheet.getRange(hit.row, v2Col_("MFG", "Run Folder Link")).setValue(run.getUrl());
  return { ok: true, mfgId: mfgId, folderUrl: run.getUrl(), folderId: run.getId(), boards: boards.length };
}

/* ── v2.master — one row per live combination, rule recorded ──────────────── */
function v2Master_(b) {
  const reg = v2Sheet_("Master");
  const head = v2HeaderRow_(reg.sheet, "Master");
  const f = b.values || {};
  reg.sheet.appendRow(V2_COLUMNS.Master.map(function (c) { return f[c] != null ? f[c] : ""; }));
  return { ok: true, row: reg.sheet.getLastRow(), registerUrl: reg.ss.getUrl() };
}

/* ── v2.governance — the auditable one-liner (rules calls, gate record) ───── */
function v2Governance_(b) {
  const projectId = String(b.projectId || "").trim().toUpperCase();
  const proj = v2FindRow_("Projects", projectId);
  if (!proj) return { ok: false, error: projectId + " has no Projects row" };
  const pfid = v2DriveId_(proj.values[v2Col_("Projects", "Drive Folder Link") - 1]);
  if (!pfid) return { ok: false, error: projectId + " has no folder yet — provision first" };
  const gov = v2SubByPattern_(DriveApp.getFolderById(pfid), /Governance/i);
  if (!gov) return { ok: false, error: "No 00-Governance folder inside " + projectId };
  const docName = projectId + "_Governance-Log_v1.0";
  let doc = null;
  const it = gov.getFilesByName(docName);
  if (it.hasNext()) doc = DocumentApp.openById(it.next().getId());
  else {
    doc = DocumentApp.create(docName);
    DriveApp.getFileById(doc.getId()).moveTo(gov);
    doc.getBody().appendParagraph(projectId + " — governance log").setHeading(DocumentApp.ParagraphHeading.HEADING1);
  }
  doc.getBody().appendParagraph(v2Today_() + " · " + String(b.by || "portal") + " — " + String(b.line || ""));
  doc.saveAndClose();
  return { ok: true, docUrl: doc.getUrl() };
}

/* ── v2.health — the sweep the register's colours do by hand ──────────────── */
function v2Health_() {
  const out = { ok: true, duplicates: [], formatBreaches: [], linkDebt: [], qtyMismatch: [] };
  const LINKED = { Projects: "Drive Folder Link", PCB: "Drive Folder Link", FW: "Drive Folder Link", Enclosure: "Drive Folder Link", MFG: "Run Folder Link" };
  for (const fam in V2_TABS) {
    if (fam === "MASTER") continue;
    const t = V2_TABS[fam];
    let reg, ids;
    try { reg = v2Sheet_(t.tab); ids = v2Ids_(reg.sheet, t.tab); } catch (e) { out.ok = false; out.error = String(e && e.message || e); return out; }
    const seen = {};
    ids.rows.filter(function (r) { return !r.example; }).forEach(function (r) {
      const k = r.id.toUpperCase();
      if (seen[k]) out.duplicates.push(t.tab + ": " + r.id + " (rows " + seen[k] + " & " + r.row + ")");
      else seen[k] = r.row;
      if (t.regex && r.id.indexOf("EB-") === 0 && !t.regex.test(r.id)) out.formatBreaches.push(t.tab + "!" + r.row + " " + r.id);
    });
    if (LINKED[t.tab]) {
      const col = v2Col_(t.tab, LINKED[t.tab]);
      ids.rows.filter(function (r) { return !r.example; }).forEach(function (r) {
        const v = reg.sheet.getRange(r.row, col).getDisplayValue();
        if (!String(v).trim()) out.linkDebt.push(t.tab + ": " + r.id);
      });
    }
  }
  try {
    const reg = v2Sheet_("MFG");
    const ids = v2Ids_(reg.sheet, "MFG");
    ids.rows.filter(function (r) { return !r.example; }).forEach(function (r) {
      const ordered = parseInt(String(r.id).match(/-(\d+)$/)[1], 10);
      const delivered = String(reg.sheet.getRange(r.row, v2Col_("MFG", "Delivered Qty")).getDisplayValue()).trim();
      if (delivered && parseInt(delivered, 10) !== ordered) out.qtyMismatch.push(r.id + " delivered " + delivered);
    });
  } catch (e) { /* MFG tab issues already reported above */ }
  return out;
}


/* ═══ v2.backfill — legacy boards, given new-scheme identities ══════════════
   The artefact audit lists every board under the OLD naming
   (AT32-EC20-ATA6-WQ32-DCPW-GW), some with an old project id. This walks
   that sheet and issues a v2.0 identity for each thing it finds, writing the
   result back into the same workbook: five new columns on the audit tab, and
   an "EB-Master Map" tab that joins them.

   Serials run INDEPENDENTLY per family — a board's PCB number says nothing
   about its firmware number — because the Master row, not the name, is what
   relates them. That is the whole point of a meaning-free identifier.

     PCB  every board                        EB-PCB-YY-nnnn
     BOM  every board, as-designed           EB-PCB-YY-nnnn-BOM-001
     FW   boards with firmware evidence      EB-FW-YY-nnnn   (Law 7: no GW/SS marker)
     ED   one per project with enclosure     EB-ED-YY-nnnn
          evidence; per board when the board has no project
     P    one per distinct legacy project    EB-P-YY-nnnn

   A board with no legacy project keeps an empty Project ID: a project comes
   from a won deal (Law 10) and cannot be invented by a backfill. The old
   Board ID is never destroyed — it becomes the alias and the legacy SKU code.

   { action:"v2.backfill", sheetId, tab?, dryRun?, start?:{P,PCB,FW,ED} }
   dryRun true reports what it WOULD issue and writes nothing.              */

function v2Backfill_(b) {
  const sheetId = String(b.sheetId || "").trim();
  if (!sheetId) return { ok: false, error: "v2.backfill needs the audit sheetId" };
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = b.tab ? ss.getSheetByName(String(b.tab)) : ss.getSheets()[0];
  if (!sheet) return { ok: false, error: "No tab '" + b.tab + "' in that workbook. Tabs: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", ") };

  const lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { ok: false, error: "That tab has no data rows" };
  const head = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  const idx = function (name) { return head.indexOf(name); };
  const cBoard = idx("Board ID"), cProj = idx("Project ID");
  if (cBoard < 0) return { ok: false, error: "No 'Board ID' column on that tab" };

  // Evidence columns: the audit's own presence vocabulary.
  const fwCols = [], enCols = [];
  head.forEach(function (h, i) {
    if (/- files$/.test(h)) return;
    if (/^FW \d/.test(h)) fwCols.push(i);
    if (/^EN \d/.test(h)) enCols.push(i);
  });
  const body = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
  const present = function (row, cols) {
    for (let i = 0; i < cols.length; i++) {
      if (String(row[cols[i]] || "").toUpperCase().indexOf("PRESENT") >= 0) return true;
    }
    return false;
  };

  const yy = v2Yy_();
  const start = b.start || {};
  const from = function (fam) { return Math.max(parseInt(start[fam], 10) || 1, 1); };
  const mk = function (fam, n) { return "EB-" + fam + "-" + yy + "-" + pad_(n, 4); };

  const projMap = {}, edMap = {};
  let nP = 0, nPcb = 0, nFw = 0, nEd = 0;
  const out = [];      // one entry per audit row, in sheet order

  // Projects first, so a shared legacy project keeps one identity across its
  // boards — the audit's own row order decides the sequence.
  body.forEach(function (row) {
    const legacy = cProj >= 0 ? String(row[cProj] || "").trim() : "";
    if (legacy && !projMap[legacy]) { nP++; projMap[legacy] = mk("P", from("P") + nP - 1); }
  });

  body.forEach(function (row) {
    const board = String(row[cBoard] || "").trim();
    if (!board) { out.push(null); return; }
    const legacy = cProj >= 0 ? String(row[cProj] || "").trim() : "";
    const project = legacy ? projMap[legacy] : "";
    nPcb++;
    const pcb = mk("PCB", from("PCB") + nPcb - 1);
    let fw = "";
    if (present(row, fwCols)) { nFw++; fw = mk("FW", from("FW") + nFw - 1); }
    let ed = "";
    if (present(row, enCols)) {
      const key = project || ("board:" + pcb);
      if (!edMap[key]) { nEd++; edMap[key] = mk("ED", from("ED") + nEd - 1); }
      ed = edMap[key];
    }
    out.push({ board: board, legacy: legacy, project: project, pcb: pcb,
               bom: pcb + "-BOM-001", fw: fw, ed: ed,
               platform: board.split("-")[0].toUpperCase(),
               cls: /-(GW)(-\d+)?$/i.test(board) ? "Gateway" : /-(SS)(-\d+)?$/i.test(board) ? "Sensor Node" : "Other" });
  });

  const summary = { ok: true, boards: nPcb, projects: nP, pcb: nPcb, bom: nPcb, firmware: nFw, enclosures: nEd,
                    lastIssued: { project: nP ? mk("P", from("P") + nP - 1) : "", pcb: nPcb ? mk("PCB", from("PCB") + nPcb - 1) : "",
                                  firmware: nFw ? mk("FW", from("FW") + nFw - 1) : "", enclosure: nEd ? mk("ED", from("ED") + nEd - 1) : "" },
                    sheetUrl: ss.getUrl(), tab: sheet.getName() };
  if (b.dryRun) { summary.dryRun = true; summary.sample = out.filter(String).slice(0, 5); return summary; }

  // Write the five columns back, appending them if they are not there yet.
  const NEW = ["EB Project ID", "EB PCB ID", "EB BOM ID", "EB FW ID", "EB Enclosure ID"];
  const at = {};
  let width = lastCol;
  NEW.forEach(function (name) {
    let c = head.indexOf(name);
    if (c < 0) { width++; c = width - 1; sheet.getRange(1, width).setValue(name).setFontWeight("bold"); }
    at[name] = c + 1;
  });
  const cells = out.map(function (o) {
    return o ? [o.project, o.pcb, o.bom, o.fw, o.ed] : ["", "", "", "", ""];
  });
  // Contiguous when freshly appended; written column by column regardless so
  // a re-run into existing columns behaves the same.
  NEW.forEach(function (name, k) {
    sheet.getRange(2, at[name], cells.length, 1).setValues(cells.map(function (r) { return [r[k]]; }));
  });

  // The join. One row per board — the only place the families meet.
  const mapName = "EB-Master Map";
  let map = ss.getSheetByName(mapName);
  if (map) map.clear(); else map = ss.insertSheet(mapName);
  const MAP_HEAD = ["Client ID", "Deal ID", "Project ID", "PCB ID", "BOM ID", "FW ID", "Enclosure ID",
                    "MFG ID", "Legacy Board ID", "Legacy Project ID", "Platform", "Class", "Rule", "Notes"];
  const mapRows = out.filter(String).map(function (o) {
    return ["", "", o.project, o.pcb, o.bom, o.fw, o.ed, "", o.board, o.legacy, o.platform, o.cls, "1.0",
            "Backfilled from the artefact audit"];
  });
  map.getRange(1, 1, 1, MAP_HEAD.length).setValues([MAP_HEAD]).setFontWeight("bold").setBackground("#1f3864").setFontColor("#ffffff");
  if (mapRows.length) map.getRange(2, 1, mapRows.length, MAP_HEAD.length).setValues(mapRows);
  map.setFrozenRows(1);
  summary.mapTab = mapName;
  summary.mapRows = mapRows.length;
  return summary;
}

/* The artefact-audit workbook this backfill was written against. Run
   testBackfillDryRun first — it issues nothing and reports what it would
   do — then testBackfillApply once the counts look right. */
const AUDIT_SHEET_ID = "1BYDhvxLjiGuxN0AfBL8i051_Pm_fBJq8LTlEt1ooGyo";

function testBackfillDryRun() {
  Logger.log(JSON.stringify(v2Backfill_({ sheetId: AUDIT_SHEET_ID, dryRun: true }), null, 2));
}
function testBackfillApply() {
  Logger.log(JSON.stringify(v2Backfill_({ sheetId: AUDIT_SHEET_ID }), null, 2));
}


/* ═══ v2.products — EVSO · Pro-connect · Repeater, into the register ════════
   The version tracker lists seven product versions, each carrying four
   boards. This issues their identities and writes them into the pinned
   master register — Projects, PCB, BOM, FW and the Master join.

   What it encodes, from the product owner:
     PCB  four per version, always
     BOM  four for EVSO and Repeater; two for Pro-connect, whose Left and
          Right boards are covered by the HMI and Power bills
     FW   ONE per version — a version runs a single build across its boards.
          The FW row names its host board; the Master rows carry that
          firmware against every board of the version, which is what the
          Master tab is for.

   Five of the seven legacy projects already hold an EB-P number, so those
   are reused: Law 1 renumbers nothing. Serials for everything else continue
   from `start`, and the run REFUSES if any identifier it would issue is
   already in the register — a double-issued serial cannot be taken back.

   { action:"v2.products", start?:{P,PCB,FW}, dryRun? }                     */

const V2_PRODUCTS = [
  { product: "EVSO (Outdoor)",       version: "V1", legacy: "Eb-21-EL-287-01-1453", reuse: "EB-P-26-0028", legacyProduct: "ES3C5-STE5-LK306-GW-101" },
  { product: "EVSO (Outdoor)",       version: "V2", legacy: "Eb-21-EL-287-01-1466", reuse: "" },
  { product: "EVSO (Outdoor)",       version: "V3", legacy: "Eb-21-EL-287-01-1628", reuse: "EB-P-26-0008", legacyProduct: "Eb-21-EL-287-01-1628-GW-109" },
  { product: "Pro-connect (Indoor)", version: "V1", legacy: "Eb-21-EL-287-01-1452", reuse: "EB-P-26-0029", legacyProduct: "ES3C5-SX13-GW-105" },
  { product: "Pro-connect (Indoor)", version: "V2", legacy: "Eb-21-EL-287-01-1481", reuse: "" },
  { product: "Pro-connect (Indoor)", version: "V3", legacy: "Eb-21-EL-287-01-1629", reuse: "EB-P-26-0009", legacyProduct: "Eb-21-EL-287-01-1629-GW-110" },
  { product: "Repeater",             version: "V1", legacy: "Eb-21-EL-287-01-1579", reuse: "EB-P-26-0007", legacyProduct: "Eb-21-EL-287-01-1579-GW-108" },
];
const V2_PRODUCT_BOARDS = {
  "EVSO (Outdoor)":       ["Mainboard", "Daughterboard", "HMI", "LED"],
  "Repeater":             ["Mainboard", "Daughterboard", "HMI", "LED"],
  "Pro-connect (Indoor)": ["HMI", "Power", "Left", "Right"],
};
const V2_FW_HOST  = { "EVSO (Outdoor)": "Mainboard", "Repeater": "Mainboard", "Pro-connect (Indoor)": "HMI" };
const V2_BOM_ONLY = { "EVSO (Outdoor)": null, "Repeater": null, "Pro-connect (Indoor)": ["HMI", "Power"] };
const V2_BOARD_CLASS = { Mainboard: "Gateway", Daughterboard: "Controller", HMI: "Controller",
                         LED: "Power", Power: "Power", Left: "Sensor Node", Right: "Sensor Node" };

function v2Products_(b) {
  const yy = v2Yy_();
  const start = b.start || {};
  const from = function (fam, dflt) { return Math.max(parseInt(start[fam], 10) || dflt, 1); };
  const mk = function (fam, n) { return "EB-" + fam + "-" + yy + "-" + pad_(n, 4); };
  let nP = 0, nPcb = 0, nFw = 0;

  const plan = { Projects: [], PCB: [], BOM: [], FW: [], Master: [] };
  V2_PRODUCTS.forEach(function (v) {
    const project = v.reuse || mk("P", from("P", 39) + nP++);
    if (!v.reuse) {
      plan.Projects.push({ "Project ID": project, "Project Name": v.product + " " + v.version,
        "Kind": "RND+MFG", "Status": "Active", "Date Added": v2Today_(), "Added By": String(b.by || "backfill"),
        "Notes": "Legacy project " + v.legacy });
    }
    const fw = mk("FW", from("FW", 60) + nFw++);
    const boards = V2_PRODUCT_BOARDS[v.product];
    const bomOnly = V2_BOM_ONLY[v.product];
    boards.forEach(function (board) {
      const pcb = mk("PCB", from("PCB", 154) + nPcb++);
      const hasBom = !bomOnly || bomOnly.indexOf(board) >= 0;
      const label = v.product + " " + v.version + " — " + board;
      plan.PCB.push({ "PCB ID": pcb, "Project ID": project, "Name / Alias": label,
        "Silkscreen Marking": pcb + " V1", "Class": V2_BOARD_CLASS[board] || "Other",
        "Version": v.version, "Status": "Active", "Date Added": v2Today_(),
        "Added By": String(b.by || "backfill"), "Notes": board + " of " + v.product + " " + v.version });
      if (hasBom) {
        plan.BOM.push({ "BOM ID": pcb + "-BOM-001", "PCB ID": pcb, "Revision Reason": "As designed",
          "Status": "Active", "Date Added": v2Today_(), "Added By": String(b.by || "backfill"),
          "Notes": "As-designed revision of the " + board });
      }
      if (board === V2_FW_HOST[v.product]) {
        plan.FW.push({ "FW ID": fw, "PCB ID": pcb, "Project ID": project,
          "Repo": "fw-product-eb-fw-" + yy + "-" + fw.slice(-4), "Status": "Active",
          "Date Added": v2Today_(), "Added By": String(b.by || "backfill"),
          "Notes": "One firmware for " + v.product + " " + v.version + " — hosted on the " + board +
                   ", running across all " + boards.length + " boards of the version" });
      }
      plan.Master.push({ "Project ID": project, "PCB ID": pcb, "BOM ID": hasBom ? pcb + "-BOM-001" : "",
        "FW ID": fw, "Project Name (auto)": v.product + " " + v.version, "Rule": "1.0",
        "Notes": board + (hasBom ? "" : " · no BOM of its own") });
    });
  });

  const counts = { projects: plan.Projects.length, pcb: plan.PCB.length, bom: plan.BOM.length,
                   fw: plan.FW.length, master: plan.Master.length };
  if (b.dryRun) return { ok: true, dryRun: true, counts: counts, plan: plan };
  return v2Publish_({ plan: plan, by: b.by });
}

/**
 * Append prepared rows into the pinned master register, tab by tab.
 * Refuses outright if ANY incoming identifier is already there: an issued
 * serial is spent forever (Law 1), so a partial re-run must not double-issue.
 * Nothing is written until every tab has been checked.
 */
function v2Publish_(b) {
  const plan = b.plan || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prepared = [], clashes = [];
    for (const tabName in plan) {
      const rows = plan[tabName] || [];
      if (!rows.length) continue;
      if (!V2_COLUMNS[tabName]) return { ok: false, error: "Unknown register tab: " + tabName };
      const reg = v2Sheet_(tabName);
      const head = v2HeaderRow_(reg.sheet, tabName);
      const idCol = V2_COLUMNS[tabName][0];
      const existing = {};
      if (tabName !== "Master") {
        v2Ids_(reg.sheet, tabName).rows.forEach(function (r) { existing[r.id.toUpperCase()] = r.row; });
        rows.forEach(function (r) {
          const id = String(r[idCol] || "").trim().toUpperCase();
          if (id && existing[id]) clashes.push(tabName + ": " + id + " already at row " + existing[id]);
        });
      }
      prepared.push({ tabName: tabName, reg: reg, head: head, rows: rows });
    }
    if (clashes.length) {
      return { ok: false, error: "Refusing to write — these identifiers are already in the register. " +
               "Re-run with a higher `start` so nothing is issued twice (Law 1).", clashes: clashes };
    }

    const written = {};
    prepared.forEach(function (p) {
      const cols = V2_COLUMNS[p.tabName];
      const values = p.rows.map(function (r) {
        return cols.map(function (c) { return r[c] != null ? r[c] : ""; });
      });
      p.reg.sheet.getRange(p.reg.sheet.getLastRow() + 1, 1, values.length, cols.length).setValues(values);
      written[p.tabName] = values.length;
    });
    return { ok: true, written: written, registerUrl: prepared.length ? prepared[0].reg.ss.getUrl() : "" };
  } finally { lock.releaseLock(); }
}

/* ── v2.share — who may read the register ──────────────────────────────────
   Default is the Elecbits domain with VIEW access: a register carries
   commercial data, so "everyone" means everyone inside the company, not
   anyone with the link. Public sharing needs anyone:true, said out loud.
   { action:"v2.share", fileId?, emails?:[], role?:"view"|"edit",
     domain?:"elecbits.in", anyone?:false }                                 */
function v2Share_(b) {
  const fileId = String(b.fileId || v2RegisterId_() || "").trim();
  if (!fileId) return { ok: false, error: "Nothing to share — pin the register or pass a fileId" };
  const file = DriveApp.getFileById(fileId);
  const edit = String(b.role || "view").toLowerCase() === "edit";
  const out = { ok: true, file: file.getName(), url: file.getUrl(), role: edit ? "edit" : "view", shared: [] };

  (b.emails || []).forEach(function (e) {
    const email = String(e).trim();
    if (!email) return;
    try {
      if (edit) file.addEditor(email); else file.addViewer(email);
      out.shared.push(email);
    } catch (err) { (out.failed = out.failed || []).push(email + ": " + String(err && err.message || err)); }
  });

  if (b.anyone) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, edit ? DriveApp.Permission.EDIT : DriveApp.Permission.VIEW);
    out.audience = "anyone with the link";
  } else if (b.domain !== null) {
    const domain = String(b.domain || "elecbits.in").trim();
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, edit ? DriveApp.Permission.EDIT : DriveApp.Permission.VIEW);
      out.audience = "anyone at " + domain + " with the link";
    } catch (err) {
      out.audience = "domain sharing refused: " + String(err && err.message || err) +
                     " — name the people in `emails` instead";
    }
  }
  return out;
}

/* Editor helpers — dry run first, then write, then share. */
function testProductsDryRun() { Logger.log(JSON.stringify(v2Products_({ dryRun: true }).counts, null, 2)); }
function testProductsApply()  { Logger.log(JSON.stringify(v2Products_({ by: Session.getActiveUser().getEmail() }), null, 2)); }
function testShareRegister()  { Logger.log(JSON.stringify(v2Share_({ role: "view" }), null, 2)); }


/* ── v2.products.toSheet — the same allocation, written into a workbook ─────
   The register is where identifiers eventually live, but a review workbook
   is where they get read first. This writes the EVSO / Pro-connect /
   Repeater allocation into any sheet you name: a human map, four
   register-shaped tabs ready to paste, and the rows appended to the
   EB-Master Map so one join covers every backfill in the book.

   Re-running replaces the tabs it owns rather than appending twice — the
   allocation is deterministic, so a second run writes the same identifiers.

   { action:"v2.products.toSheet", sheetId, start?:{P,PCB,FW} }             */

function v2ProductsToSheet_(b) {
  const sheetId = String(b.sheetId || "").trim();
  if (!sheetId) return { ok: false, error: "v2.products.toSheet needs the target sheetId" };
  const ss = SpreadsheetApp.openById(sheetId);
  const built = v2Products_({ start: b.start, dryRun: true, by: b.by });
  if (!built.ok) return built;
  const plan = built.plan;

  // The map: one row per board, in reading order.
  const MAP_HEAD = ["Product", "Version", "Board", "EB Project ID", "EB PCB ID", "EB BOM ID", "EB FW ID",
                    "FW host board", "BOM note", "Class", "Legacy Project ID", "Project ID source"];
  const byPcb = {};
  plan.PCB.forEach(function (r) { byPcb[r["PCB ID"]] = r; });
  const fwHostPcb = {};
  plan.FW.forEach(function (r) { fwHostPcb[r["PCB ID"]] = r["FW ID"]; });
  const newProjects = {};
  plan.Projects.forEach(function (r) { newProjects[r["Project ID"]] = true; });

  const mapRows = plan.Master.map(function (m) {
    const pcb = byPcb[m["PCB ID"]] || {};
    const name = String(pcb["Name / Alias"] || "");          // "Product Vn — Board"
    const parts = name.split(" — ");
    const head = (parts[0] || "").trim();
    const board = (parts[1] || "").trim();
    const cut = head.lastIndexOf(" ");
    return [head.slice(0, cut), head.slice(cut + 1), board, m["Project ID"], m["PCB ID"],
            m["BOM ID"] || "", m["FW ID"], fwHostPcb[m["PCB ID"]] ? "yes" : "",
            m["BOM ID"] ? "" : "covered by the HMI and Power BOMs",
            pcb["Class"] || "", "", newProjects[m["Project ID"]] ? "newly issued" : "reused from the audit backfill"];
  });

  const write = function (name, head, rows, colour) {
    let s = ss.getSheetByName(name);
    if (s) s.clear(); else s = ss.insertSheet(name);
    s.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight("bold")
      .setBackground(colour || "#1f3864").setFontColor("#ffffff");
    if (rows.length) s.getRange(2, 1, rows.length, head.length).setValues(rows);
    s.setFrozenRows(1);
    return rows.length;
  };
  const shaped = function (tabName, rows) {
    const cols = V2_COLUMNS[tabName];
    return rows.map(function (r) { return cols.map(function (c) { return r[c] != null ? r[c] : ""; }); });
  };

  const out = { ok: true, sheetUrl: ss.getUrl(), tabs: {} };
  out.tabs["EB Product IDs"]      = write("EB Product IDs", MAP_HEAD, mapRows, "#0b5394");
  out.tabs["EB Product PCB"]      = write("EB Product PCB", V2_COLUMNS.PCB, shaped("PCB", plan.PCB));
  out.tabs["EB Product BOM"]      = write("EB Product BOM", V2_COLUMNS.BOM, shaped("BOM", plan.BOM));
  out.tabs["EB Product FW"]       = write("EB Product FW", V2_COLUMNS.FW, shaped("FW", plan.FW));
  out.tabs["EB Product Projects"] = write("EB Product Projects", V2_COLUMNS.Projects, shaped("Projects", plan.Projects));

  // Extend the master join rather than starting a second one.
  const MAP_TAB = "EB-Master Map";
  const MASTER_HEAD = ["Client ID", "Deal ID", "Project ID", "PCB ID", "BOM ID", "FW ID", "Enclosure ID",
                       "MFG ID", "Legacy Board ID", "Legacy Project ID", "Platform", "Class", "Rule", "Notes"];
  let map = ss.getSheetByName(MAP_TAB);
  if (!map) {
    map = ss.insertSheet(MAP_TAB);
    map.getRange(1, 1, 1, MASTER_HEAD.length).setValues([MASTER_HEAD]).setFontWeight("bold")
      .setBackground("#1f3864").setFontColor("#ffffff");
    map.setFrozenRows(1);
  }
  // Drop any rows a previous run of THIS allocation left, so re-running is safe.
  const last = map.getLastRow();
  if (last > 1) {
    const have = map.getRange(2, 1, last - 1, MASTER_HEAD.length).getDisplayValues();
    const keep = have.filter(function (r) { return String(r[13] || "").indexOf("product backfill") < 0; });
    map.getRange(2, 1, last - 1, MASTER_HEAD.length).clearContent();
    if (keep.length) map.getRange(2, 1, keep.length, MASTER_HEAD.length).setValues(keep);
  }
  const masterRows = mapRows.map(function (r) {
    return ["", "", r[3], r[4], r[5], r[6], "", "", "", r[10], "", r[9], "1.0",
            "product backfill — " + r[0] + " " + r[1] + " " + r[2]];
  });
  map.getRange(map.getLastRow() + 1, 1, masterRows.length, MASTER_HEAD.length).setValues(masterRows);
  out.tabs[MAP_TAB] = "+" + masterRows.length + " rows";
  out.counts = built.counts;
  return out;
}

/** The workbook this allocation was reviewed against. */
function testProductsIntoAuditSheet() {
  Logger.log(JSON.stringify(v2ProductsToSheet_({ sheetId: AUDIT_SHEET_ID, by: Session.getActiveUser().getEmail() }), null, 2));
}


/* ═══ v2.consolidate — the whole allocation, into one workbook ══════════════
   Everything the two backfills produce, written into the sheet you name:
   the audit tab gains its five identity columns, and the register-shaped
   tabs (PCB, BOM, FW, Enclosure, Projects) plus one Master join are
   rebuilt beside it.

   The allocation is deterministic — the same audit rows always yield the
   same identifiers — so re-running restates rather than doubles. That is
   what makes it safe to run twice while a decision is still being argued.

   Order matters and is fixed: audited boards are numbered by board name so
   the run is reproducible, products continue after them. Five audited rows
   are the old gateway-board NAMES of the product versions; they named a
   product, not one of its boards, so they are marked Superseded and point
   at the four identities that replace them. Law 1 retires a row, never
   deletes it.

   { action:"v2.consolidate", sheetId, tab? }                               */

function v2Consolidate_(b) {
  const sheetId = String(b.sheetId || "").trim();
  if (!sheetId) return { ok: false, error: "v2.consolidate needs the target sheetId" };
  const ss = SpreadsheetApp.openById(sheetId);
  const tabName = String(b.tab || "Audit 01-Sep 2233");
  const aud = ss.getSheetByName(tabName) || ss.getSheets()[0];
  if (!aud) return { ok: false, error: "No audit tab found" };

  const yy = v2Yy_(), today = v2Today_(), by = String(b.by || "backfill");
  const mk = function (f, n) { return "EB-" + f + "-" + yy + "-" + pad_(n, 4); };

  // ── read the audit ──
  const lastRow = aud.getLastRow(), lastCol = aud.getLastColumn();
  const head = aud.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  const cBoard = head.indexOf("Board ID"), cProj = head.indexOf("Project ID");
  if (cBoard < 0) return { ok: false, error: "No 'Board ID' column on " + aud.getName() };
  const fwC = [], enC = [];
  head.forEach(function (h, i) {
    if (/- files$/.test(h)) return;
    if (/^FW \d/.test(h)) fwC.push(i);
    if (/^EN \d/.test(h)) enC.push(i);
  });
  const body = lastRow > 1 ? aud.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues() : [];
  const seen_ = function (row, cols) {
    for (let i = 0; i < cols.length; i++) if (String(row[cols[i]] || "").toUpperCase().indexOf("PRESENT") >= 0) return true;
    return false;
  };
  const boards = [];
  body.forEach(function (row, i) {
    const name = String(row[cBoard] || "").trim();
    if (!name) return;
    boards.push({ i: i, board: name, legacy: cProj >= 0 ? String(row[cProj] || "").trim() : "",
                  fw: seen_(row, fwC), en: seen_(row, enC),
                  platform: name.split("-")[0].toUpperCase(),
                  cls: /-GW(-\d+)?$/i.test(name) ? "Gateway" : (/-SS(-\d+)?$/i.test(name) ? "Sensor Node" : "Other") });
  });

  // ── allocate: audited boards, numbered by name so the run repeats ──
  const order = boards.slice().sort(function (x, y) { return x.board.toUpperCase() < y.board.toUpperCase() ? -1 : 1; });
  const projOf = {}, projSeq = [];
  order.forEach(function (b2) {
    if (b2.legacy && !projOf[b2.legacy]) { projOf[b2.legacy] = mk("P", 1 + projSeq.length); projSeq.push(b2.legacy); }
  });
  let nP = projSeq.length, nPcb = 0, nFw = 0, nEd = 0;
  const edFor = {};
  order.forEach(function (b2) {
    nPcb++; b2.pcb = mk("PCB", nPcb); b2.bom = b2.pcb + "-BOM-001";
    b2.project = projOf[b2.legacy] || "";
    b2.fwId = b2.fw ? mk("FW", ++nFw) : "";
    b2.edId = "";
    if (b2.en) {
      const key = b2.project || ("board:" + b2.pcb);
      if (!edFor[key]) edFor[key] = mk("ED", ++nEd);
      b2.edId = edFor[key];
    }
  });

  // ── allocate: the product versions, continuing the same runs ──
  const prods = [];
  V2_PRODUCTS.forEach(function (v) {
    const project = projOf[v.legacy] || mk("P", ++nP);
    if (!projOf[v.legacy]) projOf[v.legacy] = project;      // a version the audit never saw
    const fw = mk("FW", ++nFw);
    const list = V2_PRODUCT_BOARDS[v.product], only = V2_BOM_ONLY[v.product];
    list.forEach(function (board) {
      const pcb = mk("PCB", ++nPcb);
      const has = !only || only.indexOf(board) >= 0;
      prods.push({ product: v.product, version: v.version, board: board, project: project, pcb: pcb,
                   bom: has ? pcb + "-BOM-001" : "", fw: fw, host: board === V2_FW_HOST[v.product],
                   cls: V2_BOARD_CLASS[board] || "Other", legacy: v.legacy,
                   legacyProduct: v.legacyProduct || "",
                   alias: v.product + " " + v.version + " — " + board,
                   newProject: !projSeq.length || projSeq.indexOf(v.legacy) < 0 });
    });
  });
  // Which audited rows were really product-level names?
  const superseded = {};
  V2_PRODUCTS.forEach(function (v) {
    if (!v.legacyProduct) return;
    const mine = prods.filter(function (p) { return p.product === v.product && p.version === v.version; });
    boards.forEach(function (b2) {
      if (b2.board.toUpperCase() === v.legacyProduct.toUpperCase()) {
        b2.superseded = "Product-level entry — replaced by the four board identities " +
                        mine[0].pcb + ".." + mine[mine.length - 1].pcb;
        superseded[b2.pcb] = true;
      }
    });
  });

  // ── write: the five identity columns on the audit tab ──
  const NEW = ["EB Project ID", "EB PCB ID", "EB BOM ID", "EB FW ID", "EB Enclosure ID", "ID note"];
  let width = lastCol;
  const at = {};
  NEW.forEach(function (n) {
    let c = head.indexOf(n);
    if (c < 0) { width++; c = width - 1; aud.getRange(1, width).setValue(n).setFontWeight("bold"); }
    at[n] = c + 1;
  });
  const byRow = {};
  boards.forEach(function (b2) { byRow[b2.i] = b2; });
  const cells = body.map(function (_, i) {
    const b2 = byRow[i];
    return b2 ? [b2.project, b2.pcb, b2.bom, b2.fwId, b2.edId, b2.superseded || ""] : ["", "", "", "", "", ""];
  });
  NEW.forEach(function (n, k) {
    aud.getRange(2, at[n], cells.length, 1).setValues(cells.map(function (r) { return [r[k]]; }));
  });

  // ── write: the register-shaped tabs and the join ──
  const put = function (name, headRow, rows, colour) {
    let s = ss.getSheetByName(name);
    if (s) s.clear(); else s = ss.insertSheet(name);
    s.getRange(1, 1, 1, headRow.length).setValues([headRow]).setFontWeight("bold")
      .setBackground(colour || "#1f3864").setFontColor("#ffffff");
    if (rows.length) s.getRange(2, 1, rows.length, headRow.length).setValues(rows);
    s.setFrozenRows(1);
    return rows.length;
  };
  const status = function (pcb) { return superseded[pcb] ? "Superseded" : "Active"; };
  const out = { ok: true, sheetUrl: ss.getUrl(), tabs: {} };

  out.tabs["EB Product IDs"] = put("EB Product IDs",
    ["Product", "Version", "Board", "EB Project ID", "EB PCB ID", "EB BOM ID", "EB FW ID",
     "FW host", "BOM note", "Class", "Legacy Project ID"],
    prods.map(function (p) {
      return [p.product, p.version, p.board, p.project, p.pcb, p.bom, p.fw, p.host ? "yes" : "",
              p.bom ? "" : "covered by the HMI and Power BOMs", p.cls, p.legacy];
    }), "#0b5394");

  out.tabs.PCB = put("PCB", V2_COLUMNS.PCB,
    boards.map(function (b2) {
      return [b2.pcb, b2.project, b2.board, "", b2.board, b2.pcb + " V1", b2.platform, b2.cls, "V1",
              status(b2.pcb), today, by, b2.superseded || "Legacy board carried over from the artefact audit"];
    }).concat(prods.map(function (p) {
      return [p.pcb, p.project, p.alias, "", "", p.pcb + " V1", "", p.cls, p.version, "Active", today, by,
              p.board + " of " + p.product + " " + p.version];
    })));

  out.tabs.BOM = put("BOM", V2_COLUMNS.BOM,
    boards.filter(function (b2) { return !superseded[b2.pcb]; }).map(function (b2) {
      return [b2.bom, b2.pcb, "As designed", "", "", "", "", "Active", today, by,
              "BOM-001 is always the as-designed revision"];
    }).concat(prods.filter(function (p) { return p.bom; }).map(function (p) {
      return [p.bom, p.pcb, "As designed", "", "", "", "", "Active", today, by,
              "As-designed revision of the " + p.board];
    })));

  out.tabs.FW = put("FW", V2_COLUMNS.FW,
    boards.filter(function (b2) { return b2.fwId; }).map(function (b2) {
      return [b2.fwId, b2.pcb, b2.project, b2.platform, "", "fw-product-eb-fw-" + yy + "-" + b2.fwId.slice(-4), "",
              status(b2.pcb), today, by, b2.superseded || "Firmware artefacts found in the audit"];
    }).concat(prods.filter(function (p) { return p.host; }).map(function (p) {
      return [p.fw, p.pcb, p.project, "", "", "fw-product-eb-fw-" + yy + "-" + p.fw.slice(-4), "", "Active", today, by,
              "One firmware for " + p.product + " " + p.version + " — hosted on the " + p.board +
              ", running across all " + V2_PRODUCT_BOARDS[p.product].length + " boards"];
    })));

  const edSeen = {}, edRows = [];
  order.forEach(function (b2) {
    if (b2.edId && !edSeen[b2.edId]) {
      edSeen[b2.edId] = true;
      edRows.push([b2.edId, b2.project, "Enclosure for " + b2.board, "", "", "V1", "Active", today, by,
                   "Enclosure artefacts found in the audit"]);
    }
  });
  out.tabs.Enclosure = put("Enclosure", V2_COLUMNS.Enclosure, edRows);

  const pjRows = projSeq.map(function (lp) {
    let n = 0;
    boards.forEach(function (b2) { if (b2.project === projOf[lp]) n++; });
    return [projOf[lp], "", "", lp, "", "Active", "", "", "", today, by,
            "Legacy project " + lp + " — " + n + " audited board(s)"];
  });
  V2_PRODUCTS.forEach(function (v) {
    if (projSeq.indexOf(v.legacy) >= 0) return;         // already listed from the audit
    pjRows.push([projOf[v.legacy], "", "", v.product + " " + v.version, "RND+MFG", "Active", "", "", "",
                 today, by, "Legacy project " + v.legacy]);
  });
  out.tabs.Projects = put("Projects", V2_COLUMNS.Projects, pjRows);

  const MASTER = ["Client ID", "Deal ID", "Project ID", "PCB ID", "BOM ID", "FW ID", "Enclosure ID", "MFG ID",
                  "Legacy Board ID", "Legacy Project ID", "Platform", "Class", "Rule", "Notes"];
  out.tabs.Master = put("Master", MASTER,
    boards.map(function (b2) {
      return ["", "", b2.project, b2.pcb, superseded[b2.pcb] ? "" : b2.bom, b2.fwId, b2.edId, "",
              b2.board, b2.legacy, b2.platform, b2.cls, "1.0", b2.superseded || "audit backfill"];
    }).concat(prods.map(function (p) {
      return ["", "", p.project, p.pcb, p.bom, p.fw, "", "", "", p.legacy, "", p.cls, "1.0",
              "product backfill — " + p.product + " " + p.version + " " + p.board];
    })));

  out.counts = { auditedBoards: boards.length, productBoards: prods.length,
                 projects: pjRows.length, pcb: out.tabs.PCB, bom: out.tabs.BOM,
                 fw: out.tabs.FW, enclosures: out.tabs.Enclosure, master: out.tabs.Master,
                 superseded: Object.keys(superseded).length };
  return out;
}

/** Everything, into the audit workbook. This is the one to run. */
function testConsolidateAll() {
  Logger.log(JSON.stringify(v2Consolidate_({ sheetId: AUDIT_SHEET_ID, by: Session.getActiveUser().getEmail() }), null, 2));
}
