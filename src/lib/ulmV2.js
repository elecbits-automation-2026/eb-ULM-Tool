/* ─── The v2.0 registrar client ──────────────────────────────────────────────
   Every call goes through the ulm-proxy Edge Function when it is configured:
   the proxy verifies the caller's JWT, checks ulm.has_role AS THE CALLER for
   registrar actions, and holds the Drive token in secrets — so the token is
   not in this bundle. With no proxy configured it falls back to the direct
   Drive web-app transport (v1 behaviour) so a half-migrated deployment still
   works, and `v2Secure` says which mode is live.                             */

import { supabase, supabaseAnonKey } from "./supabase.js";

const clean = (s) => String(s || "").trim().replace(/^["']+|["']+$/g, "");
const proxyUrl = clean(import.meta.env.VITE_ULM_PROXY_URL);
const rawUrl = clean(import.meta.env.VITE_ULM_DRIVE_URL);
const rawToken = clean(import.meta.env.VITE_ULM_DRIVE_TOKEN);

export const v2Secure = Boolean(proxyUrl);
export const v2Configured = Boolean(proxyUrl || rawUrl);

const MISROUTED = "POST JSON { token, action";

async function callProxy(action, params) {
  // The proxy checks ulm.has_role AS THE CALLER, so it needs the signed-in
  // user's access token — the anon key would resolve auth.uid() to NULL and
  // every registrar action would come back 403.
  let jwt = "";
  try { jwt = (await supabase?.auth?.getSession())?.data?.session?.access_token || ""; }
  catch { /* unauthenticated — the proxy will say so */ }
  const res = await fetch(proxyUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(supabaseAnonKey ? { apikey: supabaseAnonKey } : {}),
      ...(jwt || supabaseAnonKey ? { authorization: `Bearer ${jwt || supabaseAnonKey}` } : {}),
    },
    body: JSON.stringify({ action, ...params }),
  });
  const body = await res.json().catch(() => null);
  if (!body) return { ok: false, error: `ulm-proxy HTTP ${res.status}` };
  return body;
}

/* Direct transport — same POST→GET redirect survival as the v1 client. */
async function callDirect(action, params) {
  if (!rawUrl) return { ok: false, error: "Neither VITE_ULM_PROXY_URL nor VITE_ULM_DRIVE_URL is configured" };
  const payload = JSON.stringify({ token: rawToken, action, ...params });
  let body = null;
  try {
    const res = await fetch(rawUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: payload,
    });
    body = await res.json().catch(() => null);
    if (body && !(body.ok === false && String(body.error || "").startsWith(MISROUTED))) return body;
  } catch { /* fall through */ }
  if (payload.length <= 6000) {
    try {
      const res = await fetch(rawUrl + (rawUrl.includes("?") ? "&" : "?") + "body=" + encodeURIComponent(payload));
      const viaGet = await res.json().catch(() => null);
      if (viaGet) return viaGet;
    } catch { /* keep the POST result */ }
  }
  return body || { ok: false, error: "Drive backend unreachable" };
}

export async function v2(action, params = {}) {
  if (!v2Configured) return { ok: false, error: "The v2 registrar backend is not configured" };
  try {
    return proxyUrl ? await callProxy(action, params) : await callDirect(action, params);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/* ── cutover ─────────────────────────────────────────────────────────────── */
/** Candidate live registers, so a human can pin the right fileId. */
export const v2Locate = () => v2("v2.locate");
/** Tab apparatus, format-law breaches, blue example rows, allocation-ready. */
export const v2Validate = () => v2("v2.validate");

/* ── the registrar ───────────────────────────────────────────────────────── */
/** Allocate an identifier AND write its row in one locked call.
    v2Allocate({ family:'C', fields:{...} })
    v2Allocate({ family:'DEAL', parent:'EB-C-26-0004', fields:{...} })
    v2Allocate({ family:'DEALINPUT', parent:'EB-C-26-0004-D01', type:'PCB' })
    v2Allocate({ family:'MFG', parent:'EB-P-26-0007', qty:250 })
    Family P is refused — projects come only from v2Convert. */
export const v2Allocate = (params) => v2("v2.allocate", params);
/** Read a register tab back: v2List('Deals') */
export const v2List = (tab) => v2("v2.list", { tab });
/** Correct descriptive columns in place; identifier columns are refused. */
export const v2Update = (tab, id, values) => v2("v2.update", { tab, id, values });

/* ── conversion & provisioning ───────────────────────────────────────────── */
/** The atomic sitting: mint EB-P, append Projects, write both link ends. */
export const v2Convert = (dealId, fields, by) => v2("v2.convert", { dealId, fields, by });

/* A blueprint tree can outlast one request; the backend answers done:false
   and resumes where it stopped, exactly like v1 provisioning. */
async function loop(action, params, onProgress) {
  let total = { copied: 0, folders: 0 };
  for (let round = 1; round <= 10; round++) {
    const res = await v2(action, params);
    if (!res.ok) return res;
    total = { copied: total.copied + (res.copied || 0), folders: total.folders + (res.folders || 0) };
    if (res.done !== false) return { ...res, ...total, rounds: round };
    onProgress?.({ ...res, ...total, round });
  }
  return { ok: false, error: "Folder is unusually large — provisioning did not finish in 10 rounds. Run it again to continue." };
}

/** Project blueprint → Eb-17-Projects, link back, LLDs filed, governance seeded. */
export const v2ProvisionProject = (params, onProgress) => loop("v2.provision.project", params, onProgress);
/** PCB / FW / ED blueprint → its engineering container, link back. */
export const v2ProvisionEng = (params, onProgress) => loop("v2.provision.eng", params, onProgress);
/** MFG run folder under 03-…SCS/06-Production, one sub-folder per board. */
export const v2ProvisionRun = (params) => v2("v2.provision.run", params);

/* ── register-wide ───────────────────────────────────────────────────────── */
/** One Master row per live combination, with the rule recorded. */
export const v2Master = (values) => v2("v2.master", { values });
/** Append an auditable line to a project's 00-Governance log. */
export const v2Governance = (projectId, line, by) => v2("v2.governance", { projectId, line, by });
/** Duplicates, format breaches, link debt, delivered≠ordered. */
export const v2Health = () => v2("v2.health");
