/**
 * Elecbits ULM — Drive provisioning web app (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════════════════
 * The ULM portal's hands inside Google Drive. One deployed web app, five
 * actions, everything the portal cannot do from the browser:
 *
 *   ping              sanity check — proves the token and folder wiring
 *   client.register   allocate the next Client ID and append it to the
 *                     Client-ID-Register sheet (the "backend file" for clients)
 *   project.register  allocate the next Project ID and append it to the
 *                     Project-ID-Register sheet (the "backend file" for projects)
 *   project.provision copy the project template folder, rename it to the
 *                     Project ID, then fill the process-map sheet inside the
 *                     new folder with links to the canonical templates that
 *                     live in the eb-templates library
 *   registry.list     read back either register (the portal's Clients page)
 *
 * ── Deploy ────────────────────────────────────────────────────────────────
 * 1. script.google.com → New project → paste this file.
 * 2. Fill in CONFIG below (folder + file IDs from your Drive).
 * 3. Deploy → New deployment → Web app:
 *      Execute as: **Me**   ·   Who has access: **Anyone**
 *    ("Anyone" is required for the portal to reach it; SHARED_TOKEN is the
 *     actual gate — every request must carry it.)
 * 4. Copy the /exec URL into the portal's .env as VITE_ULM_DRIVE_URL and the
 *    token as VITE_ULM_DRIVE_TOKEN.
 *
 * ── Contract ──────────────────────────────────────────────────────────────
 * POST JSON: { token, action, ...params }  →  { ok:true, ... } | { ok:false, error }
 * (POST body is used, not query params, so nothing sensitive lands in logs.)
 */

const CONFIG = {
  // Long random string; must equal VITE_ULM_DRIVE_TOKEN in the portal env.
  SHARED_TOKEN: "REPLACE-WITH-A-LONG-RANDOM-STRING",

  // Spreadsheet that holds the Client-ID register (one row per client).
  // Created on first use inside REGISTRY_FOLDER_ID if left blank.
  CLIENT_REGISTER_ID: "",

  // Spreadsheet that holds the Project-ID register (one row per project).
  // Created on first use inside REGISTRY_FOLDER_ID if left blank.
  PROJECT_REGISTER_ID: "",

  // Folder where the registers live (e.g. a "00-ULM-Backend" folder).
  REGISTRY_FOLDER_ID: "REPLACE-WITH-FOLDER-ID",

  // The canonical project template folder that gets replicated per project
  // (e.g. "1. Product ID_Template Folder").
  PROJECT_TEMPLATE_FOLDER_ID: "REPLACE-WITH-FOLDER-ID",

  // Where new project folders are created (e.g. "Eb-ODM Execution").
  PROJECTS_PARENT_FOLDER_ID: "REPLACE-WITH-FOLDER-ID",

  // The eb-templates library folder (holds the 178 EB-T-nnn template files).
  TEMPLATES_LIBRARY_FOLDER_ID: "REPLACE-WITH-FOLDER-ID",

  // Name fragment that identifies the process-map sheet inside a freshly
  // copied project folder (matched case-insensitively).
  PROCESS_MAP_NAME_HINT: "Process",
};

const CLIENT_HEADERS = [
  "Client ID", "Client Name", "Industry", "Industry Code", "Org Size",
  "Size Code", "Contact", "Email", "Phone", "Created By", "Created At",
];
const PROJECT_HEADERS = [
  "Project ID", "Project Name", "Client ID", "Client Name", "Kind",
  "Deadline", "Folder Link", "Created By", "Created At",
];

/* ── entry points ─────────────────────────────────────────────────────────── */

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData && e.postData.contents || "{}"); }
  catch (err) { return json_({ ok: false, error: "Bad JSON body" }); }
  return handle_(body);
}

// GET supports ping only, so a browser hit shows the app is alive.
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === "ping") return handle_({ token: p.token, action: "ping" });
  return json_({ ok: false, error: "POST JSON { token, action, ... }" });
}

function handle_(body) {
  try {
    if (!CONFIG.SHARED_TOKEN || body.token !== CONFIG.SHARED_TOKEN) {
      return json_({ ok: false, error: "Bad or missing token" });
    }
    switch (body.action) {
      case "ping":              return json_(ping_());
      case "client.register":   return json_(registerClient_(body));
      case "project.register":  return json_(registerProject_(body));
      case "project.provision": return json_(provisionProject_(body));
      case "registry.list":     return json_(listRegistry_(body));
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
  out.registryFolder  = tryName_(() => DriveApp.getFolderById(CONFIG.REGISTRY_FOLDER_ID).getName());
  out.templateFolder  = tryName_(() => DriveApp.getFolderById(CONFIG.PROJECT_TEMPLATE_FOLDER_ID).getName());
  out.projectsParent  = tryName_(() => DriveApp.getFolderById(CONFIG.PROJECTS_PARENT_FOLDER_ID).getName());
  out.templateLibrary = tryName_(() => DriveApp.getFolderById(CONFIG.TEMPLATES_LIBRARY_FOLDER_ID).getName());
  return out;
}
function tryName_(fn) { try { return fn(); } catch (e) { return "⚠ " + String(e && e.message || e); } }

/* ── the registers — the Drive-side source of truth for IDs ───────────────── */

function register_(idProp, title, headers) {
  let id = CONFIG[idProp];
  const props = PropertiesService.getScriptProperties();
  if (!id) id = props.getProperty(idProp) || "";
  let ss;
  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create(title);
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(CONFIG.REGISTRY_FOLDER_ID));
    props.setProperty(idProp, ss.getId());
  }
  const sheet = ss.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return { ss: ss, sheet: sheet };
}

function registerClient_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // serialise ID allocation
  try {
    const reg = register_("CLIENT_REGISTER_ID", "Client-ID-Register", CLIENT_HEADERS);
    const clientId = b.clientId ||
      nextSequentialId_(reg.sheet, 1, "EBC-" + (b.industryCode || "XX") + (b.sizeCode || "X") + "-", 3);
    reg.sheet.appendRow([
      clientId, b.name || "", b.industry || "", b.industryCode || "",
      b.orgSize || "", b.sizeCode || "", b.contact || "", b.email || "",
      b.phone || "", b.by || "", new Date().toISOString(),
    ]);
    return { ok: true, clientId: clientId, registerUrl: reg.ss.getUrl() };
  } finally { lock.releaseLock(); }
}

function registerProject_(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const reg = register_("PROJECT_REGISTER_ID", "Project-ID-Register", PROJECT_HEADERS);
    const projectId = b.projectId || nextSequentialId_(reg.sheet, 1, b.prefix || "Eb-", 4);
    reg.sheet.appendRow([
      projectId, b.name || "", b.clientId || "", b.clientName || "",
      b.kind || "", b.deadline || "", b.folderUrl || "", b.by || "",
      new Date().toISOString(),
    ]);
    return { ok: true, projectId: projectId, registerUrl: reg.ss.getUrl() };
  } finally { lock.releaseLock(); }
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
  const which = b.register === "clients" ? "CLIENT_REGISTER_ID" : "PROJECT_REGISTER_ID";
  const title = b.register === "clients" ? "Client-ID-Register" : "Project-ID-Register";
  const headers = b.register === "clients" ? CLIENT_HEADERS : PROJECT_HEADERS;
  const reg = register_(which, title, headers);
  const last = reg.sheet.getLastRow();
  const rows = last > 1
    ? reg.sheet.getRange(2, 1, last - 1, headers.length).getValues()
    : [];
  return { ok: true, headers: headers, rows: rows, registerUrl: reg.ss.getUrl() };
}

/* ── project provisioning — replicate the template folder ─────────────────── */

function provisionProject_(b) {
  if (!b.projectId) return { ok: false, error: "projectId is required" };
  const template = DriveApp.getFolderById(CONFIG.PROJECT_TEMPLATE_FOLDER_ID);
  const parent   = DriveApp.getFolderById(CONFIG.PROJECTS_PARENT_FOLDER_ID);

  // Refuse to double-provision: an existing folder with this name wins.
  const existing = parent.getFoldersByName(b.projectId);
  if (existing.hasNext()) {
    const f = existing.next();
    return { ok: true, alreadyExisted: true, folderId: f.getId(), folderUrl: f.getUrl(),
             copied: 0, processMap: updateProcessMap_(f, b) };
  }

  const dest = parent.createFolder(b.projectId);
  const count = { files: 0, folders: 0 };
  copyTree_(template, dest, count);

  // Wire the process-map sheet inside the fresh copy to the template library.
  const processMap = updateProcessMap_(dest, b);

  return {
    ok: true, folderId: dest.getId(), folderUrl: dest.getUrl(),
    copied: count.files, folders: count.folders, processMap: processMap,
  };
}

function copyTree_(src, dst, count) {
  const files = src.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    f.makeCopy(f.getName(), dst);
    count.files++;
  }
  const folders = src.getFolders();
  while (folders.hasNext()) {
    const sub = folders.next();
    const copy = dst.createFolder(sub.getName());
    count.folders++;
    copyTree_(sub, copy, count);
  }
}

/**
 * Find the process-map spreadsheet inside the new project folder and fill its
 * "Template Link" column with links to the canonical EB-T-nnn files in the
 * eb-templates library, matched by the Template ID column.
 */
function updateProcessMap_(projectFolder, b) {
  const sheetFile = findFileByHint_(projectFolder, CONFIG.PROCESS_MAP_NAME_HINT, MimeType.GOOGLE_SHEETS);
  if (!sheetFile) return { updated: 0, note: "No process-map sheet found in the copied folder" };

  const library = indexTemplateLibrary_();
  const ss = SpreadsheetApp.openById(sheetFile.getId());
  let updated = 0;

  ss.getSheets().forEach(function (sheet) {
    const grid = sheet.getDataRange().getValues();
    if (!grid.length) return;

    // Locate the header row: the first row containing a "Template ID" cell.
    let headerRow = -1, idCol = -1, linkCol = -1;
    for (let r = 0; r < Math.min(grid.length, 10); r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const v = String(grid[r][c] || "").trim().toLowerCase();
        if (v === "template id") { headerRow = r; idCol = c; }
        if (v === "template link") linkCol = c;
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
      const hit = library[tid];
      if (!hit) continue;
      sheet.getRange(r + 1, linkCol + 1)
        .setRichTextValue(SpreadsheetApp.newRichTextValue()
          .setText(hit.name).setLinkUrl(hit.url).build());
      updated++;
    }
  });

  return { updated: updated, sheetId: sheetFile.getId(), sheetUrl: sheetFile.getUrl() };
}

/** Map "EB-T-nnn" → { name, url } for every file in the templates library. */
function indexTemplateLibrary_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("template-library-index");
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* rebuild */ } }

  const index = {};
  walk_(DriveApp.getFolderById(CONFIG.TEMPLATES_LIBRARY_FOLDER_ID), function (file) {
    const m = file.getName().toUpperCase().match(/^(EB-T-\d+)/);
    if (m && !index[m[1]]) index[m[1]] = { name: file.getName(), url: file.getUrl() };
  }, 0);
  try { cache.put("template-library-index", JSON.stringify(index), 1800); } catch (e) { /* too big → skip cache */ }
  return index;
}

function walk_(folder, onFile, depth) {
  if (depth > 8) return;
  const files = folder.getFiles();
  while (files.hasNext()) onFile(files.next());
  const folders = folder.getFolders();
  while (folders.hasNext()) walk_(folders.next(), onFile, depth + 1);
}

function findFileByHint_(folder, hint, mime) {
  let found = null;
  const h = String(hint || "").toLowerCase();
  walk_(folder, function (file) {
    if (found) return;
    if (mime && file.getMimeType() !== mime) return;
    if (file.getName().toLowerCase().indexOf(h) >= 0) found = file;
  }, 0);
  return found;
}
