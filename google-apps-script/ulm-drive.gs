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

  // "Eb-Client ID Sheet_"  ·  headers on row 1
  //   S. no. | Organisation Name | Category/Industry | Client category/org
  //   size | Client ID | Client Folder | Point of Contact | Designation
  CLIENT_REGISTER_ID:  "1AXZpSOM2v8zpfqgRUPBa187ULlmnarC7",
  CLIENT_REGISTER_TAB: "Client Data and IDs",

  // "Eb-Centralised Project Tracking Sheet_"  ·  headers on row 2
  //   S. No | Project ID | Organisation Name | Priority | Customer SPOC |
  //   Project Type | Description | Status | Project created…
  PROJECT_REGISTER_ID:  "19bOZiIvpvA6oqqHAZUkJptOiFJPRPPjH",
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

// GET supports the two read-only checks, so a browser hit can verify the
// wiring without the portal: ?action=ping&token=… / ?action=registry.check&token=…
function doGet(e) {
  const p = (e && e.parameter) || {};
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
      case "client.register":   return json_(registerClient_(body));
      case "project.register":  return json_(registerProject_(body));
      case "project.provision": return json_(provisionProject_(body));
      case "pcb.provision":     return json_(provisionPcb_(body));
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
  out.registryFolder  = tryName_(CONFIG.REGISTRY_FOLDER_ID);
  out.templateFolder  = tryName_(CONFIG.PROJECT_TEMPLATE_FOLDER_ID);
  out.projectsParent  = tryName_(CONFIG.PROJECTS_PARENT_FOLDER_ID);
  out.pcbTemplate     = tryName_(CONFIG.PCB_TEMPLATE_FOLDER_ID);
  out.pcbParent       = tryName_(CONFIG.PCB_PARENT_FOLDER_ID);
  out.templateLibrary = CONFIG.TEMPLATES_LIBRARY_FOLDER_ID
    ? tryName_(CONFIG.TEMPLATES_LIBRARY_FOLDER_ID)
    : "(not set — links point at the project's own copies)";
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
