/* ─── UI primitives ──────────────────────────────────────────────────────────
   The design system, carried VERBATIM from the ODM PMS app so the two tools
   are visually one product: same theme variables, same CSS block, same
   inline-styled primitives (Pill, Btn, Modal, …). Change these there first,
   then here — or better, not at all.                                          */

import { useState } from "react";
import { X, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { MONO } from "./constants.js";

export const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{height:100%}
.eb-root{min-height:100vh;background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased;transition:background .25s,color .25s}
.eb-root input,.eb-root select,.eb-root textarea,.eb-root button{font-family:inherit;font-size:13px;color:var(--txt)}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--bdr2);border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulseDot{50%{opacity:.25}}
.fade{animation:fadeUp .25s ease both}
.spin{animation:spin 1s linear infinite}
.inp{width:100%;background:var(--s1);border:1px solid var(--bdr);border-radius:8px;padding:9px 12px;outline:none;transition:border-color .15s,box-shadow .15s}
.inp:focus{border-color:var(--acc);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.card{background:var(--s1);border:1px solid var(--bdr);border-radius:12px}
.navItem{display:flex;align-items:center;gap:11px;padding:10px 14px;border-radius:9px;cursor:pointer;color:var(--txt2);font-weight:500;font-size:13px;border:1px solid transparent;transition:all .15s;user-select:none}
.navItem:hover{background:var(--s2);color:var(--txt)}
.navItem.on{background:var(--soft);color:var(--acc);border-color:var(--bdr);font-weight:600}
.rowHover{transition:background .15s}.rowHover:hover{background:var(--s2)}
.branchRail{position:relative;padding-left:18px}
.branchRail::before{content:"";position:absolute;left:6px;top:4px;bottom:4px;width:2px;background:var(--bdr2);border-radius:2px}
.branchRail>div{position:relative}
.branchRail>div::before{content:"";position:absolute;left:-16px;top:12px;width:12px;height:2px;background:var(--bdr2)}
input[type=checkbox]{accent-color:var(--acc);width:15px;height:15px;cursor:pointer}
input[type=date],input[type=time]{color-scheme:light dark}
@media(max-width:900px){.eb-side{display:none!important}.eb-sideM{display:flex!important}}
`;

/* ── tiny helpers ─────────────────────────────────────────────────────────── */
export const uid = () => Math.random().toString(36).slice(2, 10);
export const initials = (n) => String(n || "?").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (d) => { if (!d) return "—"; const x = new Date(String(d).length <= 10 ? d + "T12:00:00" : d); return isNaN(x) ? "—" : x.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); };
export const fmtDateTime = (d) => { if (!d) return "—"; const x = new Date(d); return isNaN(x) ? "—" : x.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
export const daysLeft = (d) => Math.ceil((new Date(d + "T23:59:59") - new Date()) / 86400000);
export const inr = (n) => (n == null || n === "" ? "—" : "₹" + Number(n).toLocaleString("en-IN"));

/* Bold-in-text: splits on ** pairs. The whole markdown story this app needs. */
export const MD = ({ t }) => (
  <>{String(t || "").split("**").map((s, i) => (i % 2 ? <strong key={i}>{s}</strong> : <span key={i}>{s}</span>))}</>
);

/* ── the primitives ───────────────────────────────────────────────────────── */

export const Pill = ({ children, color = "var(--txt2)", bg, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, color, background: bg || "color-mix(in srgb, " + color + " 12%, transparent)", whiteSpace: "nowrap", ...style }}>{children}</span>
);

export const Btn = ({ children, onClick, kind = "primary", disabled, style, small, icon: Ic, title }) => (
  <button title={title} onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: small ? "6px 12px" : "9px 16px", borderRadius: 8, border: kind === "ghost" ? "1px solid var(--bdr)" : "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", fontSize: small ? 12 : 13, fontWeight: 600, opacity: disabled ? 0.45 : 1, background: kind === "primary" ? "var(--acc)" : kind === "danger" ? "var(--red)" : kind === "green" ? "var(--green)" : kind === "ghost" ? "transparent" : "var(--s2)", color: ["primary", "danger", "green"].includes(kind) ? "#fff" : "var(--txt)", transition: "all .15s", ...style }}>
    {Ic && <Ic size={small ? 13 : 15} />}{children}
  </button>
);

export const AvatarDot = ({ user, size = 26 }) => (
  <span title={user?.name} style={{ width: size, height: size, borderRadius: "50%", background: user?.color || "var(--txt3)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.38, fontWeight: 700, flexShrink: 0, fontFamily: MONO }}>{initials(user?.name)}</span>
);

export const Field = ({ label, children, req, hint }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>
      {label}{req && <span style={{ color: "var(--red)" }}> *</span>}
      {hint && <span style={{ marginLeft: 6, textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--txt3)" }}>{hint}</span>}
    </span>
    {children}
  </div>
);

export const PasswordInput = ({ value, onChange, onEnter, placeholder = "••••••••", autoComplete = "current-password" }) => {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input className="inp" type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} placeholder={placeholder} style={{ paddingRight: 42 }} />
      <button type="button" onClick={() => setShow(!show)} tabIndex={-1} style={{ position: "absolute", top: "50%", right: 6, transform: "translateY(-50%)", background: "none", border: "none", color: "var(--txt3)", cursor: "pointer", padding: 6, display: "flex" }}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
};

export const Seg = ({ options, value, onChange }) => (
  <div style={{ display: "inline-flex", background: "var(--s2)", border: "1px solid var(--bdr)", borderRadius: 9, padding: 3, gap: 2 }}>
    {options.map((o) => (
      <button key={o.k} onClick={() => onChange(o.k)} style={{ padding: "6px 13px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: value === o.k ? "var(--s1)" : "transparent", color: value === o.k ? "var(--acc)" : "var(--txt2)", boxShadow: value === o.k ? "0 1px 4px rgba(0,0,0,.12)" : "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
        {o.icon && <o.icon size={13} />}{o.label}
      </button>
    ))}
  </div>
);

export const chipS = (on) => ({ padding: "6px 13px", borderRadius: 99, border: `1.5px solid ${on ? "var(--acc)" : "var(--bdr)"}`, background: on ? "var(--soft)" : "var(--s1)", color: on ? "var(--acc)" : "var(--txt)", fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all .15s" });

export const Modal = ({ title, sub, onClose, children, width = 720, footer }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.5)", backdropFilter: "blur(5px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div className="fade" style={{ width: "100%", maxWidth: width, maxHeight: "92vh", display: "flex", flexDirection: "column", background: "var(--s1)", border: "1px solid var(--bdr)", borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.35)", overflow: "hidden" }}>
      {title && (
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--bdr)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>{sub && <div style={{ fontSize: 12, color: "var(--txt2)", marginTop: 2 }}>{sub}</div>}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--txt2)", cursor: "pointer", padding: 4 }}><X size={18} /></button>
        </div>
      )}
      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>{children}</div>
      {footer && <div style={{ padding: "12px 20px", borderTop: "1px solid var(--bdr)", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexWrap: "wrap" }}>{footer}</div>}
    </div>
  </div>
);

export const Progress = ({ pct, color = "var(--acc)", h = 6 }) => (
  <div style={{ height: h, background: "var(--s2)", borderRadius: 99, overflow: "hidden", flex: 1 }}>
    <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, pct))}%`, background: color, borderRadius: 99, transition: "width .4s ease" }} />
  </div>
);

export const TypingDots = () => (
  <span style={{ display: "inline-flex", gap: 4, padding: "4px 2px" }}>
    {[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--txt3)", animation: `pulseDot .9s ease ${i * 0.18}s infinite` }} />)}
  </span>
);

export const Empty = ({ icon: Ic, title, sub }) => (
  <div style={{ padding: "44px 20px", textAlign: "center", color: "var(--txt2)" }}>
    <Ic size={30} style={{ opacity: 0.4, marginBottom: 10 }} />
    <div style={{ fontWeight: 600, color: "var(--txt)", marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 12.5, maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>{sub}</div>
  </div>
);

export const SectionTitle = ({ icon: Ic, children, right }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14 }}>{Ic && <Ic size={16} style={{ color: "var(--acc)" }} />}{children}</div>
    {right}
  </div>
);

export const Section = ({ children, style }) => <div className="card" style={{ padding: 16, ...style }}>{children}</div>;

export const CardLabel = ({ children, right }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>{children}</span>
    {right}
  </div>
);

export const KV = ({ k, v, mono }) => (
  <div style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.6 }}>
    <span style={{ color: "var(--txt2)", minWidth: 130, flexShrink: 0 }}>{k}</span>
    <span style={{ fontWeight: 600, fontFamily: mono ? MONO : "inherit", overflowWrap: "anywhere" }}>{v ?? "—"}</span>
  </div>
);

export const Done = ({ s }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--txt2)", fontWeight: 600 }}>
    <CheckCircle2 size={14} style={{ color: "var(--green)" }} /> {s}
  </span>
);

export const ChoiceCard = ({ icon: Ic, title, sub, onClick, accent }) => (
  <button onClick={onClick} style={{ flex: 1, minWidth: 200, textAlign: "left", padding: 14, borderRadius: 11, cursor: "pointer", border: `1.5px solid ${accent ? "var(--acc)" : "var(--bdr)"}`, background: accent ? "var(--soft)" : "var(--s1)", display: "flex", flexDirection: "column", gap: 6, transition: "all .15s" }}>
    <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 13, color: accent ? "var(--acc)" : "var(--txt)" }}>{Ic && <Ic size={15} />}{title}</span>
    <span style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.55 }}>{sub}</span>
  </button>
);
