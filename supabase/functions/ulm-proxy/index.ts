/* ─── ulm-proxy — the trust boundary for registrar actions ───────────────────
   v2.0 removes the Drive web-app token from the browser bundle: mutating
   calls go browser → THIS function (JWT-verified; role-checked via
   ulm.has_role under the CALLER's identity) → Apps Script, with the token
   held only in secrets. Registrar-only gating becomes real, not decorative.

   Deploy:   supabase functions deploy ulm-proxy
   Secrets:  supabase secrets set ULM_DRIVE_URL=…/exec  ULM_DRIVE_TOKEN=…
   Keep JWT verification ON.

   POST { action, ...params } → the web app's JSON, verbatim.               */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/* Actions that mint or mutate register identity — registrar role required.
   Everything else passes through with plain authentication. */
const REGISTRAR_ACTIONS = new Set(["v2.allocate", "v2.validate", "registry.update"]);

async function callerHasRole(req: Request, role: string): Promise<boolean> {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const anon = (Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
  const auth = req.headers.get("authorization") || "";
  if (!url || !anon || !auth) return false;
  // Run has_role AS THE CALLER: their JWT goes through PostgREST, so
  // auth.uid() resolves to them, not to any service identity.
  const res = await fetch(`${url}/rest/v1/rpc/has_role`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": anon,
      "authorization": auth,
      "content-profile": "ulm",
      "accept-profile": "ulm",
    },
    body: JSON.stringify({ p_role: role }),
  });
  if (!res.ok) return false;
  const out = await res.json().catch(() => null);
  return out === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const driveUrl = (Deno.env.get("ULM_DRIVE_URL") || "").trim();
  const token = (Deno.env.get("ULM_DRIVE_TOKEN") || "").trim();
  if (req.method === "GET") return json({ ok: true, driveSet: Boolean(driveUrl && token) });
  if (!driveUrl || !token) return json({ ok: false, error: "ULM_DRIVE_URL / ULM_DRIVE_TOKEN secrets are not set on ulm-proxy" });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "POST JSON { action, ... }" }, 400); }
  const action = String(body.action || "");
  if (!action) return json({ ok: false, error: "action required" }, 400);

  if (REGISTRAR_ACTIONS.has(action)) {
    const ok = await callerHasRole(req, "registrar");
    if (!ok) return json({ ok: false, error: `The ${action} action needs the registrar role (ulm.roles)` }, 403);
  }

  const payload = JSON.stringify({ ...body, token });
  try {
    const res = await fetch(driveUrl, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: payload,
      redirect: "follow",
    });
    let out = await res.json().catch(() => null);
    // Survive Google's POST→GET redirect rewrite, same as every other caller.
    if (!out || (out.ok === false && String(out.error || "").startsWith("POST JSON { token, action"))) {
      const res2 = await fetch(driveUrl + (driveUrl.includes("?") ? "&" : "?") + "body=" + encodeURIComponent(payload));
      out = await res2.json().catch(() => null);
      if (!out) return json({ ok: false, error: `Drive backend answered HTTP ${res2.status} without JSON` });
    }
    return json(out);
  } catch (e) {
    return json({ ok: false, error: `Could not reach the Drive backend: ${(e as Error).message}` });
  }
});
