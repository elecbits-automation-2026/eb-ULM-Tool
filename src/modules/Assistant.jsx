/* ─── Assistant — Claude with Drive hands ────────────────────────────────────
   Free chat with the same Claude that powers the wizard, but with TOOLS: it
   searches Drive, lists folders, reads Docs/Sheets, writes Docs and reads the
   ID registers — all server-side, running as the admin account. Every tool
   call it makes is shown under the reply, so nothing happens in Drive
   silently.

   Conversations are stored DATE-WISE: each message lands in the database
   under today's date (ulm.chat_messages, per person), and the rail on the
   left reopens any previous day. Today's thread also feeds the model its
   context again after a refresh. Demo mode keeps the same structure in this
   browser instead.                                                           */

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, Search, FolderOpen, FileText, PenLine, Table2, AlertTriangle, ExternalLink, CalendarDays } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, TypingDots, uid } from "../ui.jsx";
import { MONO } from "../constants.js";
import { supabase, supabaseEnabled } from "../lib/supabase.js";
import { driveConfigured } from "../lib/ulmDrive.js";
import { aiProbe, aiAgent } from "../lib/ai.js";

const TOOL_META = {
  drive_search: { icon: Search, verb: "searched" },
  drive_list: { icon: FolderOpen, verb: "listed" },
  drive_read: { icon: FileText, verb: "read" },
  drive_write: { icon: PenLine, verb: "wrote" },
  register_read: { icon: Table2, verb: "register" },
};

/* Markdown-ish renderer: **bold**, [text](url), bullet lines. Enough for the
   agent's replies without pulling in a renderer. */
const Rich = ({ t }) => (
  <>
    {String(t || "").split("\n").map((line, i) => {
      const parts = [];
      let rest = line, k = 0;
      const rx = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*/;
      for (let m = rx.exec(rest); m; m = rx.exec(rest)) {
        if (m.index) parts.push(<span key={k++}>{rest.slice(0, m.index)}</span>);
        parts.push(m[2]
          ? <a key={k++} href={m[2]} target="_blank" rel="noreferrer" style={{ color: "var(--acc)", fontWeight: 600 }}>{m[1]} <ExternalLink size={10} style={{ verticalAlign: -1 }} /></a>
          : <strong key={k++}>{m[3]}</strong>);
        rest = rest.slice(m.index + m[0].length);
      }
      parts.push(<span key={k++}>{rest}</span>);
      const bullet = /^\s*[-•]\s+/.test(line);
      return <div key={i} style={{ paddingLeft: bullet ? 14 : 0, minHeight: line.trim() ? undefined : 8 }}>{parts}</div>;
    })}
  </>
);

const SUGGESTIONS = [
  "What are our 5 most recent projects in the register?",
  "Find the process map for the latest project and summarise it",
  "Which clients are in the register from the IoT industry?",
  "Draft kickoff meeting notes for our newest project, in its folder",
];

/* The user's local calendar date, YYYY-MM-DD — the storage key for a day. */
const localDay = () => new Date().toLocaleDateString("en-CA");
const dayLabel = (day) => {
  if (day === localDay()) return "Today";
  const dt = new Date(day + "T12:00:00");
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.toLocaleDateString("en-CA")) return "Yesterday";
  return dt.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const LS_KEY = "ulm_chat_v1";
const localChats = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } };
const saveLocalMsg = (day, m) => {
  const all = localChats();
  all[day] = [...(all[day] || []), m];
  try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* full */ }
};

export default function AssistantModule() {
  const { live, isAdmin, toast } = useUlm();
  const today = localDay();
  const [msgs, setMsgs] = useState([]);
  const [day, setDay] = useState(today);
  const [days, setDays] = useState([]);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(null);
  const [stored, setStored] = useState(true); // false → history table missing
  const history = useRef([]); // [{role, content}] — text only, sent with every turn
  const bodyRef = useRef(null);

  useEffect(() => { aiProbe().then(setAi).catch(() => setAi({ ok: false, error: "probe failed" })); }, []);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, busy]);

  /* ── date-wise load ──────────────────────────────────────────────────── */
  const loadDays = useCallback(async () => {
    if (live && supabaseEnabled) {
      try {
        const { data, error } = await supabase.schema("ulm").from("chat_messages").select("day").order("day", { ascending: false }).range(0, 4999);
        if (error) throw new Error(error.message);
        setDays([...new Set((data || []).map((r) => r.day))]);
        setStored(true);
      } catch { setStored(false); setDays([]); }
    } else {
      setDays(Object.keys(localChats()).sort().reverse());
    }
  }, [live]);

  const loadDay = useCallback(async (d) => {
    let list = [];
    if (live && supabaseEnabled) {
      try {
        const { data, error } = await supabase.schema("ulm").from("chat_messages")
          .select("who,text,trace,partial,created_at").eq("day", d).order("created_at").range(0, 1999);
        if (error) throw new Error(error.message);
        list = (data || []).map((r) => ({ id: uid(), who: r.who === "me" ? "me" : "sys", text: r.text, trace: r.trace || [], partial: r.partial, at: r.created_at }));
        setStored(true);
      } catch { setStored(false); }
    } else {
      list = (localChats()[d] || []).map((m) => ({ ...m, id: uid() }));
    }
    setMsgs(list);
    // Rebuild the model's context from today's stored thread.
    if (d === today) {
      history.current = list.slice(-16).map((m) => ({ role: m.who === "me" ? "user" : "assistant", content: m.text || "…" }));
    }
  }, [live, today]);

  useEffect(() => { loadDays(); }, [loadDays]);
  useEffect(() => { loadDay(day); }, [day, loadDay]);

  const persist = async (who, m) => {
    if (live && supabaseEnabled) {
      try {
        const { error } = await supabase.schema("ulm").rpc("portal_chat_log", {
          p_day: today, p_who: who, p_text: m.text || "", p_trace: m.trace || [], p_partial: !!m.partial,
        });
        if (error) throw new Error(error.message);
      } catch (e) {
        if (stored) toast(`Chat not saved (${e.message}) — run supabase/12-chat.sql`, "amber");
        setStored(false);
      }
    } else {
      saveLocalMsg(today, { who: m.who, text: m.text || "", trace: m.trace || [], partial: !!m.partial });
    }
  };

  /* ── send ────────────────────────────────────────────────────────────── */
  const send = async (text) => {
    const v = (text ?? val).trim();
    if (!v || busy) return;
    if (day !== today) setDay(today); // typing always lands in today's thread
    setVal("");
    const mine = { id: uid(), who: "me", text: v };
    setMsgs((x) => [...x, mine]);
    persist("me", mine);
    history.current = [...history.current, { role: "user", content: v }].slice(-16);
    setBusy(true);
    const res = await aiAgent({ messages: history.current });
    setBusy(false);
    if (!res.ok) {
      setMsgs((x) => [...x, { id: uid(), who: "sys", error: res.error || "The assistant call failed." }]);
      return;
    }
    history.current = [...history.current, { role: "assistant", content: res.text || "(did tool work)" }].slice(-16);
    const reply = { id: uid(), who: "sys", text: res.text, trace: res.trace || [], partial: res.partial };
    setMsgs((x) => [...x, reply]);
    persist("ai", reply);
    if (!days.includes(today)) setDays((ds) => [today, ...ds]);
  };

  if (!isAdmin) {
    return <div className="fade card" style={{ padding: 40, textAlign: "center", color: "var(--txt2)", fontSize: 13 }}>The assistant works with the admin's Drive — only superadmin / dept-head profiles can use it.</div>;
  }

  const ready = driveConfigured && ai?.ok;
  const viewingPast = day !== today;
  const railDays = days.includes(today) ? days : [today, ...days];

  return (
    <div className="fade card" style={{ display: "flex", height: "calc(100vh - 150px)", minHeight: 480, overflow: "hidden" }}>
      {/* ── the date rail — one thread per day ── */}
      <div style={{ width: 148, flexShrink: 0, borderRight: "1px solid var(--bdr)", background: "var(--s2)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "13px 14px 9px", fontSize: 11, fontWeight: 700, color: "var(--txt2)", display: "flex", alignItems: "center", gap: 6 }}><CalendarDays size={12} /> HISTORY</div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {railDays.map((dd) => (
            <button key={dd} onClick={() => setDay(dd)}
              style={{ textAlign: "left", padding: "7px 10px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: dd === day ? 700 : 500, background: dd === day ? "var(--s1)" : "transparent", color: dd === day ? "var(--acc)" : "var(--txt2)" }}>
              {dayLabel(dd)}
              <div style={{ fontSize: 10, color: "var(--txt3)", fontFamily: MONO }}>{dd}</div>
            </button>
          ))}
        </div>
        {!stored && live && (
          <div style={{ padding: "8px 10px", fontSize: 10, color: "var(--amber)", lineHeight: 1.5, borderTop: "1px solid var(--bdr)" }}>
            Not persisting — run supabase/12-chat.sql
          </div>
        )}
      </div>

      {/* ── the chat ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--bdr)", background: "var(--soft)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={15} /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
              Assistant
              <span title={ai?.ok ? `${ai.model} via ${ai.via}` : ai?.error || ""}>
                <Pill color={ready ? "var(--green)" : "var(--amber)"}>{ready ? "Drive access on" : "off"}</Pill>
              </span>
              {viewingPast && <Pill color="var(--purple)">{dayLabel(day)} · {day}</Pill>}
            </div>
            <div style={{ fontSize: 11, color: "var(--txt2)" }}>Searches Drive, reads Docs &amp; Sheets, writes Docs, reads the registers — every tool call shown.</div>
          </div>
        </div>

        <div ref={bodyRef} style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          {!ready && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: 11, border: "1px solid var(--amber)", background: "color-mix(in srgb, var(--amber) 8%, transparent)", fontSize: 12.5, lineHeight: 1.6 }}>
              <AlertTriangle size={14} style={{ color: "var(--amber)", marginTop: 2 }} />
              <span>
                {!driveConfigured
                  ? "The Drive backend is not configured (VITE_ULM_DRIVE_URL) — the assistant needs it for both Claude and Drive access."
                  : ai ? `Claude is not reachable: ${ai.error}` : "Checking the AI backend…"}
              </span>
            </div>
          )}
          {ready && !msgs.length && !viewingPast && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "auto", maxWidth: 520, textAlign: "center" }}>
              <Sparkles size={22} style={{ color: "var(--purple)", margin: "0 auto" }} />
              <div style={{ fontWeight: 700, fontSize: 14 }}>Ask anything about your Drive</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--bdr)", background: "var(--s1)", color: "var(--txt)", cursor: "pointer", fontSize: 12, textAlign: "left" }}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {!msgs.length && viewingPast && (
            <div style={{ margin: "auto", fontSize: 12.5, color: "var(--txt3)" }}>No messages on {dayLabel(day).toLowerCase()} ({day}).</div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className="fade" style={{ display: "flex", justifyContent: m.who === "me" ? "flex-end" : "flex-start", gap: 8 }}>
              {m.who === "sys" && <span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}><Sparkles size={12} /></span>}
              <div style={{ maxWidth: "82%", display: "flex", flexDirection: "column", gap: 6 }}>
                {m.error
                  ? <div style={{ padding: "10px 14px", borderRadius: 11, border: "1px solid var(--red)", color: "var(--red)", fontSize: 12.5, fontWeight: 600 }}>{m.error}</div>
                  : (
                    <div style={{ padding: "10px 14px", borderRadius: m.who === "me" ? "13px 13px 4px 13px" : "13px 13px 13px 4px", background: m.who === "me" ? "linear-gradient(135deg,#7c3aed,#4c1d95)" : "var(--s1)", border: m.who === "me" ? "none" : "1px solid var(--bdr)", color: m.who === "me" ? "#fff" : "var(--txt)", fontSize: 13, lineHeight: 1.65 }}>
                      <Rich t={m.text} />
                      {m.partial && <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600, marginTop: 6 }}>Stopped early (time/round limit) — say "continue" to keep going.</div>}
                    </div>
                  )}
                {m.trace?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {m.trace.map((t, i) => {
                      const meta = TOOL_META[t.tool] || { icon: Sparkles, verb: t.tool };
                      const Ic = meta.icon;
                      return <Pill key={i} color={t.ok ? "var(--purple)" : "var(--red)"} style={{ fontFamily: MONO, fontSize: 10.5 }}><Ic size={10} /> {meta.verb}: {String(t.detail || "").slice(0, 42)}</Pill>;
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--txt2)", fontSize: 12 }}><span style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={12} /></span><TypingDots /> working in Drive — searches &amp; reads can take a minute…</div>}
        </div>

        <div style={{ padding: 12, borderTop: "1px solid var(--bdr)", display: "flex", gap: 8, alignItems: "center" }}>
          {viewingPast ? (
            <>
              <span style={{ flex: 1, fontSize: 12, color: "var(--txt3)" }}>Viewing {dayLabel(day).toLowerCase()}'s chat — new messages go to today.</span>
              <Btn small onClick={() => setDay(today)}>Back to today</Btn>
            </>
          ) : (
            <>
              <input className="inp" disabled={!ready || busy} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={ready ? "Ask about files, projects, registers — or ask it to draft a doc…" : "Configure the Drive backend + the AI backend first"} />
              <Btn icon={Send} disabled={!ready || busy || !val.trim()} onClick={() => send()}>Send</Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
