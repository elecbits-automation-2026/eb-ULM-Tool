/* ─── Registers — the Drive masters, mirrored into the database ──────────────
   The Centralised Project Tracking Sheet (CPTS) and the Client ID sheet are
   the company's registers of record. This page keeps a database copy of both
   (ulm.registers / ulm.register_rows) so they can be listed and searched
   instantly, and joined by the rest of the portal.

   The sheets stay the source of truth: "Sync from Drive" re-reads a register
   through the web app and replaces the mirror wholesale. In demo mode the
   mirror lives in this browser instead of the database.                      */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ExternalLink, Search, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, Seg, TypingDots } from "../ui.jsx";
import { MONO } from "../constants.js";
import { supabase, supabaseEnabled } from "../lib/supabase.js";
import { driveConfigured, driveListRegistry } from "../lib/ulmDrive.js";

const REGS = [
  { k: "projects", label: "Projects — CPTS" },
  { k: "clients", label: "Clients — ID sheet" },
];
const LS_KEY = "ulm_register_mirror_v1";

const localMirror = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } };
const saveLocal = (which, entry) => {
  const all = localMirror(); all[which] = entry;
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* full — mirror stays in memory */ }
};

export default function RegistersModule() {
  const { live, isAdmin, toast } = useUlm();
  const [which, setWhich] = useState("projects");
  const [mirror, setMirror] = useState(null); // { headers, rows, url, syncedAt, count }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const load = useCallback(async (w) => {
    setLoading(true);
    if (live && supabaseEnabled) {
      try {
        const { data: meta, error: e1 } = await supabase.schema("ulm").from("registers").select("*").eq("register", w).maybeSingle();
        if (e1) throw new Error(e1.message);
        if (!meta) { setMirror(null); setLoading(false); return; }
        // PostgREST caps every response at 1000 rows — fetch in chunks until
        // the whole mirror is here, or the search quietly misses the tail.
        const rows = [];
        for (let from = 0; from < 100000; from += 1000) {
          const { data: chunk, error: e2 } = await supabase.schema("ulm").from("register_rows")
            .select("row_no,cells").eq("register", w).order("row_no").range(from, from + 999);
          if (e2) throw new Error(e2.message);
          (chunk || []).forEach((r) => rows.push(r.cells || []));
          if (!chunk || chunk.length < 1000) break;
        }
        setMirror({ headers: meta.headers || [], rows, url: meta.sheet_url || "", syncedAt: meta.synced_at, count: rows.length });
      } catch (e) {
        setMirror(null);
        toast(`Could not read the mirror: ${e.message} — run supabase/11-registers.sql?`, "red");
      }
    } else {
      setMirror(localMirror()[w] || null);
    }
    setLoading(false);
  }, [live]);

  useEffect(() => { setQ(""); load(which); }, [which, load]);

  const sync = async () => {
    setBusy(true);
    try {
      const res = await driveListRegistry(which);
      if (!res.ok) throw new Error(res.error);
      const entry = { headers: res.headers || [], rows: res.rows || [], url: res.registerUrl || "", syncedAt: new Date().toISOString(), count: (res.rows || []).length };
      if (live && supabaseEnabled) {
        const { error } = await supabase.schema("ulm").rpc("portal_sync_register", {
          p_register: which, p_headers: entry.headers, p_rows: entry.rows, p_url: entry.url,
        });
        if (error) throw new Error(error.message);
        await load(which);
      } else {
        saveLocal(which, entry);
        setMirror(entry);
      }
      toast(`${entry.count} rows synced from the ${which} register`, "green");
    } catch (e) {
      toast(`Sync failed: ${e.message}`, "red");
    }
    setBusy(false);
  };

  const needle = q.trim().toLowerCase();
  const allRows = mirror?.rows || [];
  const rows = needle
    ? allRows.filter((r) => r.some((c) => String(c ?? "").toLowerCase().includes(needle)))
    : allRows;
  const shown = rows.slice(0, 300);
  // Drop columns that are empty in the header AND every shown row.
  const headers = mirror?.headers || [];
  const usedCols = headers.map((h, i) => String(h ?? "").trim() !== "" || shown.some((r) => String(r[i] ?? "").trim() !== ""));

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Seg options={REGS.map((r) => ({ k: r.k, label: r.label }))} value={which} onChange={setWhich} />
        <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 380 }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--txt3)" }} />
          <input className="inp" style={{ paddingLeft: 30, width: "100%" }} placeholder="Search every column…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {mirror?.url && <a href={mirror.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)"><FileSpreadsheet size={11} /> Open the sheet <ExternalLink size={10} /></Pill></a>}
          {isAdmin && <Btn small icon={RefreshCw} onClick={sync} disabled={busy || !driveConfigured} title={driveConfigured ? "" : "Drive backend not configured"}>{busy ? "Syncing…" : "Sync from Drive"}</Btn>}
        </div>
      </div>

      {mirror && (
        <div style={{ fontSize: 11.5, color: "var(--txt2)" }}>
          <b>{mirror.count}</b> rows in the mirror · synced {mirror.syncedAt ? new Date(mirror.syncedAt).toLocaleString() : "—"}
          {needle && <> · <b>{rows.length}</b> match{rows.length === 1 ? "" : "es"}</>}
          {rows.length > shown.length && <> · showing the first {shown.length} — refine the search</>}
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 24, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> loading the mirror…</div>
        ) : !mirror ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 24, fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.7 }}>
            <AlertTriangle size={15} style={{ color: "var(--amber)", marginTop: 2, flexShrink: 0 }} />
            <span>
              No mirror of the <b>{which}</b> register yet. {isAdmin ? <>Press <b>Sync from Drive</b> to pull it in{live ? " (run supabase/11-registers.sql once first)" : ""}.</> : "Ask an admin to sync it."}
            </span>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  {headers.map((h, i) => usedCols[i] && (
                    <th key={i} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid var(--bdr)", background: "var(--s2)", fontSize: 11, whiteSpace: "nowrap", position: "sticky", top: 0 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, ri) => (
                  <tr key={ri} style={{ borderBottom: "1px solid var(--bdr)" }}>
                    {headers.map((h, ci) => usedCols[ci] && (
                      <td key={ci} style={{ padding: "7px 12px", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: /id$|^s\.? ?no/i.test(String(h).trim()) ? MONO : undefined }} title={String(r[ci] ?? "")}>{String(r[ci] ?? "")}</td>
                    ))}
                  </tr>
                ))}
                {!shown.length && (
                  <tr><td style={{ padding: 18, color: "var(--txt3)", fontSize: 12 }}>No rows{needle ? " match the search" : ""}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
