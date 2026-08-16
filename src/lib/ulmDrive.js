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

/** Register a client in the Drive register; returns { ok, clientId, registerUrl } */
export const driveRegisterClient = (client) => call("client.register", client);

/** Register a project in the Drive register; returns { ok, projectId, registerUrl } */
export const driveRegisterProject = (project) => call("project.register", project);

/** Replicate the PROJECT-ID (PM) template folder into the Project Management
    area; returns { ok, folderId, folderUrl, copied, folders,
    processMap:{updated, sheetUrl} } */
export const driveProvisionProject = (params) => call("project.provision", params);

/** Replicate the PCB-ID (engineering) template folder into the PCB & Firmware
    area and append the PCB-ID register. Called once per board:
    driveProvisionPcb({ pcbId, projectId, boardName, by }) →
    { ok, folderId, folderUrl, copied, folders, registerUrl } */
export const driveProvisionPcb = (params) => call("pcb.provision", params);

/** Read a register back: driveListRegistry("clients"|"projects"|"pcbs") */
export const driveListRegistry = (register) => call("registry.list", { register });
