/* ─── claude-ulm — the Messages-API proxy Edge Function ──────────────────────
   The portal's plain Claude calls (wizard conversation, LLD extraction,
   designer drafts) come here; the Anthropic key stays in Supabase secrets and
   never reaches the browser. Named claude-ulm so it can live beside the ODM
   app's own claude function in the same Supabase project.

   Deploy (CLI):        supabase functions deploy claude-ulm
   Secret:              supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
   Or in the dashboard: Edge Functions → Deploy new function, named
                        "claude-ulm" → paste this →
                        then Edge Functions → Secrets → ANTHROPIC_API_KEY.

   Keep "Enforce JWT verification" ON — the portal sends its Supabase anon key
   with every call, so the function is scoped to your project instead of being
   an open proxy to your Anthropic credits.

   GET  → { ok, keySet }                     (health check, used by the portal)
   POST → the Messages API response, verbatim                                */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

/* Only the request fields the portal actually uses are forwarded. */
const ALLOWED = ["model", "max_tokens", "thinking", "output_config", "system", "messages", "tools", "stop_sequences", "metadata"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const key = (Deno.env.get("ANTHROPIC_API_KEY") || "").trim();
  if (req.method === "GET") return json({ ok: true, keySet: Boolean(key) });
  if (!key) return json({ error: { message: "ANTHROPIC_API_KEY is not set — add it under Edge Functions → Secrets (or: supabase secrets set ANTHROPIC_API_KEY=sk-ant-…)" } }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: { message: "POST a JSON Messages-API body" } }, 400); }

  const payload: Record<string, unknown> = {};
  for (const k of ALLOWED) if (body[k] !== undefined) payload[k] = body[k];
  payload.model ||= "claude-opus-5";
  payload.max_tokens ||= 4000;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { ...CORS, "content-type": "application/json" } });
});
