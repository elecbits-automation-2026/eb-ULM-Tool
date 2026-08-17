/* ─── Assistant — Claude with Drive hands ────────────────────────────────────
   Free chat with the same Claude that powers the wizard, but with TOOLS: it
   searches Drive, lists folders, reads Docs/Sheets, writes Docs and reads the
   ID registers — all server-side in the Apps Script web app, running as the
   admin account. Ask it "find the LLD for EbX-22-PL-03-47", "summarise the
   process map", "draft kickoff notes in the project folder"…

   Every tool call it makes is shown under the reply, so nothing happens in
   Drive silently.                                                            */

import { useEffect, useRef, useState } from "react";
import { Send, Sparkles, Search, FolderOpen, FileText, PenLine, Table2, AlertTriangle, ExternalLink } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, TypingDots, uid } from "../ui.jsx";
import { MONO } from "../constants.js";
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

export default function AssistantModule() {
  const { isAdmin } = useUlm();
  const [msgs, setMsgs] = useState([]);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(null);
  const history = useRef([]); // [{role, content}] — text only, sent with every turn
  const bodyRef = useRef(null);

  useEffect(() => { aiProbe().then(setAi).catch(() => setAi({ ok: false, error: "probe failed" })); }, []);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, busy]);

  const send = async (text) => {
    const v = (text ?? val).trim();
    if (!v || busy) return;
    setVal("");
    setMsgs((x) => [...x, { id: uid(), who: "me", text: v }]);
    history.current = [...history.current, { role: "user", content: v }].slice(-16);
    setBusy(true);
    const res = await aiAgent({ messages: history.current });
    setBusy(false);
    if (!res.ok) {
      setMsgs((x) => [...x, { id: uid(), who: "sys", error: res.error || "The assistant call failed." }]);
      return;
    }
    history.current = [...history.current, { role: "assistant", content: res.text || "(did tool work)" }].slice(-16);
    setMsgs((x) => [...x, { id: uid(), who: "sys", text: res.text, trace: res.trace || [], partial: res.partial }]);
  };

  if (!isAdmin) {
    return <div className="fade card" style={{ padding: 40, textAlign: "center", color: "var(--txt2)", fontSize: 13 }}>The assistant works with the admin's Drive — only superadmin / dept-head profiles can use it.</div>;
  }

  // Either agent backend works: the claude-agent Edge Function (with the
  // Drive web app behind it for tools) or the Apps Script loop directly —
  // both need the Drive web app configured.
  const ready = driveConfigured && ai?.ok;

  return (
    <div className="fade card" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 150px)", minHeight: 480, overflow: "hidden" }}>
      <div style={{ padding: "13px 18px", borderBottom: "1px solid var(--bdr)", background: "var(--soft)", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center" }}><Sparkles size={15} /></span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}>
            Assistant
            <span title={ai?.ok ? `${ai.model} via ${ai.via}` : ai?.error || ""}>
              <Pill color={ready ? "var(--green)" : "var(--amber)"}>{ready ? "Drive access on" : "off"}</Pill>
            </span>
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
        {ready && !msgs.length && (
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

      <div style={{ padding: 12, borderTop: "1px solid var(--bdr)", display: "flex", gap: 8 }}>
        <input className="inp" disabled={!ready || busy} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={ready ? "Ask about files, projects, registers — or ask it to draft a doc…" : "Configure the Drive backend + ANTHROPIC_API_KEY first"} />
        <Btn icon={Send} disabled={!ready || busy || !val.trim()} onClick={() => send()}>Send</Btn>
      </div>
    </div>
  );
}
