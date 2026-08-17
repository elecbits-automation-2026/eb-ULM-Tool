/* ─── ULM ↔ Google Drive — the provisioning seam ─────────────────────────────
   Talks to the deployed Apps Script web app (google-apps-script/ulm-drive.gs):

     client.register    → append to the Client-ID-Register sheet, get the ID
     project.register   → append to the Project-ID-Register sheet, get the ID
     project.provision  → replicate the template folder, rename to the Project
                          ID, link the eb-templates library into the process-map
                          sheet stored in the new folder
     registry.list      → read a register back

   Off by default and degrades gracefully: with VITE_ULM_DRIVE_URL unset every
   call resolves locally (IDs are still generated, nothing leaves the browser)
   and the UI shows the step as a visible integration seam instead of a link.  */

const rawUrl = import.meta.env.VITE_ULM_DRIVE_URL;
const rawToken = import.meta.env.VITE_ULM_DRIVE_TOKEN;

const url = String(rawUrl || "").trim().replace(/^["']+|["']+$/g, "");
const token = String(rawToken || "").trim().replace(/^["']+|["']+$/g, "");

export const driveConfigured = Boolean(url);

async function call(action, params = {}) {
  if (!driveConfigured) return { ok: false, offline: true, error: "Drive backend not configured" };
  try {
    // text/plain avoids the CORS preflight that Apps Script web apps reject.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token, action, ...params }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { ok: false, error: `Drive backend HTTP ${res.status}` };
    return body;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export const drivePing = () => call("ping");

/** Dry run over the registers: which columns this tool's fields map onto in
    whatever layout those sheets already have. Writes nothing. */
export const driveCheckRegisters = () => call("registry.check");

/** Register a client in the Drive register; returns { ok, clientId, registerUrl } */
export const driveRegisterClient = (client) => call("client.register", client);

/** Register a project in the Drive register; returns { ok, projectId, registerUrl } */
export const driveRegisterProject = (project) => call("project.register", project);

/* A big template tree can outlast one Apps Script request (~6 min cap). The
   backend then answers done:false having copied what it could; calling again
   resumes where it stopped. This drives that loop and adds the rounds up, so
   callers just await one promise. */
async function provisionLoop(action, params, onProgress) {
  let total = { copied: 0, folders: 0, skipped: 0 };
  for (let round = 1; round <= 10; round++) {
    const res = await call(action, params);
    if (!res.ok) return res;
    total = {
      copied: total.copied + (res.copied || 0),
      folders: total.folders + (res.folders || 0),
      skipped: total.skipped + (res.skipped || 0),
    };
    if (res.done !== false) return { ...res, ...total, rounds: round };
    onProgress?.({ ...res, ...total, round });
  }
  return { ok: false, error: "Folder is unusually large — provisioning did not finish in 10 rounds. Run it again to continue where it stopped." };
}

/** Replicate the PROJECT-ID (PM) template folder into the Project Management
    area; returns { ok, folderId, folderUrl, copied, folders,
    processMap:{updated, sheetUrl} }. Resumes automatically if the copy needs
    more than one request. */
export const driveProvisionProject = (params, onProgress) =>
  provisionLoop("project.provision", params, onProgress);

/** Replicate the PCB-ID (engineering) template folder into the PCB & Firmware
    area and append the PCB-ID register. Called once per board:
    driveProvisionPcb({ pcbId, projectId, boardName, by }) →
    { ok, folderId, folderUrl, copied, folders, registerUrl } */
export const driveProvisionPcb = (params, onProgress) =>
  provisionLoop("pcb.provision", params, onProgress);

/** Read a register back: driveListRegistry("clients"|"projects"|"pcbs") */
export const driveListRegistry = (register) => call("registry.list", { register });

/** The next Client ID and Project ID, read live from the register sheets —
    they are the allocator of record, not any count held in this app.
    driveNextIds({ industryCode, sizeCode, clientName? }) →
    { ok, clientExisted, clientId, clientSeq, projectId, projectSeq,
      lastProjectId, clientsInRegister, projectsInRegister } */
export const driveNextIds = (params) => call("id.next", params);

/** Type-ahead over the client register — "does hitachi exist yet?" */
export const driveSearchClients = (q) => call("clients.search", { q });

/** Ask Claude through the web app, which holds the Anthropic key in its
    script properties — the key is never in this bundle.
    driveAi({ prompt, system?, maxTokens?, effort?, schema? }) →
    { ok, text, json?, model, stopReason, usage } */
export const driveAi = (params) => call("ai.chat", params);
