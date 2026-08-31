/* ─── ulm-sales-bridge — nothing wins in silence ─────────────────────────────
   The sales tool marks a deal Won (stage 'po' / temperature_moves to_temp
   'won') and then stops: no webhook, no project, no event. This function
   closes that loop from the ULM side. Run it on a schedule (Supabase cron,
   every 15 min) or hit it manually.

   For every ULM-linked deal it compares the sales-side state with the ULM
   ladder and raises a task when they disagree:
     sales Won   → ULM deal still Open/Quoted/Negotiation  → "mark it Won,
                   here is the PO line they typed"
     sales lost  → ULM deal not terminal                   → "close it Lost
                   or Dropped, with a reason"
   It NEVER writes the ladder itself: the two vocabularies do not map 1:1,
   and the SOP makes the status a human act by the Deal Owner. The bridge's
   job is only to make sure a human is asked.

   Deploy:  supabase functions deploy ulm-sales-bridge
   Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (set by the platform)
   Schedule: a Supabase cron job every 15 minutes.                          */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SALES_WON_STAGE = "po";
const ULM_OPEN = ["Open", "Quoted", "Negotiation"];

async function rest(path: string, init: RequestInit = {}, schema = "ulm") {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key, authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "accept-profile": schema, "content-profile": schema,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim()) {
    return json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not available to this function" });
  }

  try {
    // Only deals ULM knows about and has not already converted.
    const links = await rest("deal_links?select=deal_id,status,sales_deal_id,intake_request,converted_project&sales_deal_id=not.is.null&converted_project=is.null");
    if (!links.length) return json({ ok: true, checked: 0, tasks: [] });

    const ids = links.map((l: Record<string, string>) => l.sales_deal_id).filter(Boolean);
    const deals = await rest(`deals?select=id,code,stage,lost,lost_note&id=in.(${ids.join(",")})`, {}, "sales");
    const byId = new Map(deals.map((d: Record<string, unknown>) => [d.id, d]));

    const tasks: Array<Record<string, unknown>> = [];
    for (const l of links) {
      const d = byId.get(l.sales_deal_id) as Record<string, unknown> | undefined;
      if (!d) continue;
      if (d.stage === SALES_WON_STAGE && ULM_OPEN.includes(l.status)) {
        tasks.push({
          deal_id: l.deal_id, kind: "won",
          message: `Sales moved ${d.code ?? l.sales_deal_id} to '${SALES_WON_STAGE}' (won) — mark ${l.deal_id} as Won with its PO reference, then close the sanction gate.`,
        });
      } else if (d.lost === true && ULM_OPEN.includes(l.status)) {
        tasks.push({
          deal_id: l.deal_id, kind: "lost",
          message: `Sales marked ${d.code ?? l.sales_deal_id} lost${d.lost_note ? ` (“${String(d.lost_note).slice(0, 120)}”)` : ""} — close ${l.deal_id} as Lost or Dropped with a reason; the row stays as pipeline history.`,
        });
      }
    }

    // Tasks are advisory: upsert into ulm.bridge_tasks when it exists, and
    // always return them so a manual run shows what needs doing.
    if (tasks.length) {
      try {
        await rest("bridge_tasks?on_conflict=deal_id,kind", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(tasks.map((t) => ({ ...t, seen: false }))),
        });
      } catch { /* table optional — the response still carries the work */ }
    }

    return json({ ok: true, checked: links.length, tasks });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message });
  }
});
