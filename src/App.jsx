/* ─── Elecbits ULM — project acceptance, sanction, allocation & architecture ──
   The shell: same look, same bones as the ODM PMS app — left sidebar,
   role-aware nav, "view as" switcher for admins, light/dark theme, the same
   auth ladder (config error → session check → one-door login → workspace).

   Modules:
     Sanction Inbox   requests for project creation & sanction (core.intake)
     Create a Project chat wizard → client ID → bifurcation → LLDs → Drive
     Projects         the spine, the ledger, the decide actions
     Allocation       delivery owners (senior PM) + roster load
     Clients          the shared client table + Drive register
     Integrations     every seam, visible                                     */

import { useEffect, useMemo, useState } from "react";
import {
  Inbox, FolderPlus, Layers, Users, Building2, PlugZap, Shield, Sun, Moon,
  Loader2, ArrowRight, LogOut, RefreshCw, CheckCircle2, AlertTriangle, Sparkles, FileSpreadsheet,
  Briefcase, Wrench, BookMarked,
} from "lucide-react";
import elecbitsLogo from "./assets/elecbits-logo.jpg";
import { supabaseConfigured, supabaseEnabled, supabaseInitError, supabaseUrl } from "./lib/supabase.js";
import { getSession, onAuthChange, signIn, signUp, signOut, resetPassword, setPassword, authReturnError } from "./lib/auth.js";
import { DARK, LIGHT, logoChip, MONO } from "./constants.js";
import { CSS, Btn, Field, Pill, PasswordInput, AvatarDot, MD } from "./ui.jsx";
import { UlmProvider, useUlm, SEED_PEOPLE } from "./data.jsx";
import InboxModule from "./modules/Inbox.jsx";
import WizardModule from "./modules/Wizard.jsx";
import ProjectsModule from "./modules/Projects.jsx";
import AllocationModule from "./modules/Allocation.jsx";
import ClientsModule from "./modules/Clients.jsx";
import IntegrationsModule from "./modules/Integrations.jsx";
import AssistantModule from "./modules/Assistant.jsx";
import RegistersModule from "./modules/Registers.jsx";
import DealsV2Module from "./modules/DealsV2.jsx";
import SetupV2Module from "./modules/SetupV2.jsx";
import RegistryV2Module from "./modules/RegistryV2.jsx";

const NAV_GROUPS = [
  /* SOP v2.0: a deal comes first and most deals die there, so the board
     leads. Create-a-Project is the v1 flow, kept until the board replaces
     it in daily use. */
  ["ULM", [
    { id: "deals", label: "Deals & Sanction", icon: Briefcase, admin: true },
    { id: "setup", label: "Project Setup", icon: Wrench, admin: true },
    { id: "inbox", label: "Sanction Inbox", icon: Inbox },
    { id: "create", label: "Create a Project", icon: FolderPlus, admin: true },
    { id: "projects", label: "Projects", icon: Layers },
    { id: "assistant", label: "Assistant", icon: Sparkles, admin: true },
  ]],
  ["People", [
    { id: "alloc", label: "Allocation", icon: Users },
  ]],
  ["Registry", [
    { id: "clients", label: "Clients", icon: Building2 },
    { id: "registers", label: "Registers", icon: FileSpreadsheet },
    { id: "registry", label: "Register Console", icon: BookMarked, admin: true },
  ]],
  ["System", [
    { id: "integrations", label: "Integrations", icon: PlugZap, admin: true },
  ]],
];
const NAV = NAV_GROUPS.flatMap(([, items]) => items);

const TITLES = {
  inbox: ["Sanction Inbox", "Requests for project creation & sanction — ULM decides"],
  create: ["Create a Project", "Client → ID → bifurcation → LLDs → sanction → Drive folder"],
  projects: ["Projects", "The spine — every project, its ledger, its allocation"],
  alloc: ["Allocation", "Hand sanctioned projects to their delivery owner"],
  clients: ["Clients", "The shared client table and the Drive-side register"],
  integrations: ["Integrations", "Supabase · Drive · AI — every seam, visible"],
  assistant: ["Assistant", "Claude with Drive hands — search, read, draft docs"],
  registers: ["Registers", "The Drive masters mirrored in the database — CPTS & Client IDs"],
  deals: ["Deals & Sanction", "Deal → won + PO → six-condition gate → project (SOP v2.0)"],
  setup: ["Project Setup", "Boards, firmware, enclosures and manufacturing runs"],
  registry: ["Register Console", "Cutover, every register tab, health sweep, vendors"],
};

const Shell = ({ dark, children }) => (
  <div className="eb-root" style={{ ...(dark ? DARK : LIGHT), display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 16 }}>
    <style>{CSS}</style>
    {children}
  </div>
);

function SupabaseConfigError({ dark }) {
  return (
    <Shell dark={dark}>
      <div className="fade card" style={{ width: "100%", maxWidth: 480, padding: 28 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>Supabase is configured but could not start</div>
        <div style={{ fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 14 }}>
          Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment (Vercel → Settings → Environment Variables), then redeploy.
        </div>
        {supabaseInitError && <pre style={{ fontSize: 11, color: "var(--red)", whiteSpace: "pre-wrap", background: "var(--s2)", padding: 10, borderRadius: 8, marginBottom: 8 }}>{supabaseInitError}</pre>}
        {supabaseUrl && <pre style={{ fontSize: 11, color: "var(--txt2)", whiteSpace: "pre-wrap", background: "var(--s2)", padding: 10, borderRadius: 8 }}>URL used: {supabaseUrl}</pre>}
      </div>
    </Shell>
  );
}

/* One-door login: sign-in tried first; unknown email silently becomes sign-up;
   an existing email with the wrong password offers a reset. Same flow as the
   ODM app. In demo mode: pick a seed user and jump in. */
function Login({ dark, onToggleTheme, demo, onDemoLogin, recovery }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(() => authReturnError());
  const [msg, setMsg] = useState("");
  const [wrongPw, setWrongPw] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (demo) return;
    if (!email.trim() || !pw) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await signIn(email.trim(), pw);
    } catch (e) {
      if (/invalid login credentials/i.test(e.message || "")) {
        try {
          const { user } = await signUp(email.trim(), pw, email.split("@")[0]);
          if (user && Array.isArray(user.identities) && user.identities.length === 0) {
            setWrongPw(true);
            setErr("That email already has an account — the password doesn't match. Reset it below, or try again.");
          } else if (user && !user.confirmed_at) {
            setMsg("Account created — check your inbox to confirm the email, then sign in.");
          }
        } catch (e2) { setErr(e2.message); }
      } else setErr(e.message);
    }
    setBusy(false);
  };

  const reset = async () => {
    if (!email.trim()) { setErr("Put your email in first, then hit reset."); return; }
    setBusy(true); setErr("");
    try { await resetPassword(email.trim()); setSent(true); } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const [newPw, setNewPw] = useState("");
  const saveNewPw = async () => {
    setBusy(true); setErr("");
    try { await setPassword(newPw); window.location.reload(); } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (recovery) {
    return (
      <Shell dark={dark}>
        <div className="fade card" style={{ width: "100%", maxWidth: 400, padding: 30 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>Choose a new password</div>
          <div style={{ fontSize: 12, color: "var(--txt2)", marginBottom: 16 }}>You're signed in through the reset link — set the new password now.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="New password"><PasswordInput value={newPw} onChange={setNewPw} onEnter={saveNewPw} autoComplete="new-password" /></Field>
            {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{err}</div>}
            <Btn disabled={busy || newPw.length < 6} onClick={saveNewPw} style={{ width: "100%" }}>{busy ? "Saving…" : "Save and continue"}</Btn>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell dark={dark}>
      <div className="fade card" style={{ width: "100%", maxWidth: 380, padding: 32, position: "relative" }}>
        <button onClick={onToggleTheme} title="Toggle theme" style={{ position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 8, border: "1px solid var(--bdr)", background: "var(--s2)", color: "var(--txt2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 24 }}>
          <img src={elecbitsLogo} alt="Elecbits" style={{ ...logoChip(dark, 38), marginBottom: 10 }} />
          <div style={{ fontSize: 12.5, color: "var(--txt2)" }}>ULM · Project Portal</div>
          <div style={{ fontSize: 12.5, color: "var(--txt3)", marginTop: 3 }}>{demo ? "Demo mode — jump in as anyone" : "Sign in, or sign up — same box"}</div>
        </div>

        {!demo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field label="Work email"><input className="inp" type="email" autoFocus autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setWrongPw(false); setSent(false); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@elecbits.in" /></Field>
            <Field label="Password"><PasswordInput value={pw} onChange={setPw} onEnter={submit} /></Field>
            {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600, lineHeight: 1.5 }}>{err}</div>}
            {msg && <div style={{ fontSize: 12, color: "var(--green)", fontWeight: 600, lineHeight: 1.5 }}>{msg}</div>}
            <Btn icon={busy ? Loader2 : ArrowRight} disabled={busy || !email.trim() || !pw} onClick={submit} style={{ width: "100%" }}>{busy ? "Please wait…" : "Continue"}</Btn>
            <button onClick={reset} disabled={busy || sent} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: wrongPw ? "var(--acc)" : "var(--txt3)", fontWeight: wrongPw ? 700 : 500 }}>
              {sent ? "Reset link sent — check your inbox" : wrongPw ? "Send me a reset link" : "Forgot your password?"}
            </button>
            <div style={{ fontSize: 11, color: "var(--txt3)", textAlign: "center" }}>First time? Use your work email and pick a password.</div>
          </div>
        )}

        {demo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, height: 1, background: "var(--bdr)" }} />
              <span style={{ fontSize: 11, color: "var(--txt3)" }}>jump in as</span>
              <span style={{ flex: 1, height: 1, background: "var(--bdr)" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {SEED_PEOPLE.map((u) => (
                <button key={u.id} title={u.email} onClick={() => onDemoLogin(u.id)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 99, border: "1px solid var(--bdr)", background: "var(--s1)", cursor: "pointer" }}>
                  <AvatarDot user={u} size={20} /><span style={{ fontSize: 12, fontWeight: 600 }}>{u.name}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--txt3)", textAlign: "center", lineHeight: 1.6 }}>No Supabase configured — seeded data, stored in this browser. Set the env vars to go live.</div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function AppBody({ dark, setDark, session }) {
  const ctx = useUlm();
  const { live, loading, loadError, refresh, people, me, setMe, my, realMe, isAdmin, toasts } = ctx;
  const [view, setView] = useState("inbox");
  const [projectFocus, setProjectFocus] = useState("");

  const openProject = (id) => { setProjectFocus(id); setView("projects"); };

  const visGroups = useMemo(() =>
    NAV_GROUPS.map(([g, items]) => [g, items.filter((n) => !n.admin || isAdmin)]).filter(([, items]) => items.length),
    [isAdmin]);

  useEffect(() => {
    const item = NAV.find((n) => n.id === view);
    if (item?.admin && !isAdmin) setView("inbox");
  }, [view, isAdmin]);

  /* demo mode: pick a seed user first */
  if (!live && !me) {
    return <Login dark={dark} onToggleTheme={() => setDark(!dark)} demo onDemoLogin={(id) => setMe(id)} />;
  }
  if (live && loading) {
    return <Shell dark={dark}><div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--txt2)", fontSize: 13 }}><Loader2 className="spin" size={18} /> Loading your workspace…</div></Shell>;
  }
  if (live && loadError && !people.length) {
    return (
      <Shell dark={dark}>
        <div className="fade card" style={{ width: "100%", maxWidth: 440, padding: 28, textAlign: "center" }}>
          <AlertTriangle size={26} style={{ color: "var(--amber)", marginBottom: 10 }} />
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>The workspace could not be loaded</div>
          <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 14 }}>{loadError}</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Btn icon={RefreshCw} onClick={refresh}>Try again</Btn>
            <Btn kind="ghost" onClick={() => signOut()}>Sign out</Btn>
          </div>
        </div>
      </Shell>
    );
  }

  const [t1, t2] = TITLES[view] || TITLES.inbox;
  const switcherVisible = !live || realMe && ["superadmin", "dept_head"].includes(realMe.role);

  return (
    <div className="eb-root" style={{ ...(dark ? DARK : LIGHT), display: "flex", minHeight: "100vh" }}>
      <style>{CSS}</style>

      <aside className="eb-side" style={{ width: 234, flexShrink: 0, borderRight: "1px solid var(--bdr)", background: "var(--s1)", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "16px 16px 14px", borderBottom: "1px solid var(--bdr)" }}>
          <img src={elecbitsLogo} alt="Elecbits" style={logoChip(dark, 26)} />
          <div style={{ fontSize: 10.5, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".03em", marginTop: 7, fontWeight: 600 }}>ULM · Project Portal</div>
        </div>
        <nav style={{ padding: 10, display: "flex", flexDirection: "column", gap: 3, flex: 1, overflowY: "auto" }}>
          {visGroups.map(([group, items]) => (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--txt3)", textTransform: "uppercase", letterSpacing: ".09em", padding: "0 10px 6px" }}>{group}</div>
              {items.map((n) => (
                <div key={n.id} data-nav={n.id} className={`navItem${view === n.id ? " on" : ""}`} onClick={() => setView(n.id)}>
                  <n.icon size={16} /> {n.label}
                  {n.admin && <Shield size={11} style={{ marginLeft: "auto", opacity: 0.5 }} />}
                </div>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding: 13, borderTop: "1px solid var(--bdr)", display: "flex", alignItems: "center", gap: 9 }}>
          <AvatarDot user={my} size={30} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{my?.name || "—"}</div>
            <div style={{ fontSize: 10.5, color: "var(--txt2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{my?.title || ""}</div>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header style={{ padding: "14px 22px", borderBottom: "1px solid var(--bdr)", background: "var(--s1)", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 50, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-.01em" }}>{t1}</div>
            <div style={{ fontSize: 11.5, color: "var(--txt2)" }}>{t2}</div>
          </div>
          <select className="inp eb-sideM" style={{ width: 170, display: "none" }} value={view} onChange={(e) => setView(e.target.value)}>
            {visGroups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </optgroup>
            ))}
          </select>
          {!live && <Pill color="var(--amber)">Demo</Pill>}
          {switcherVisible && (
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--txt3)", textTransform: "uppercase", letterSpacing: ".07em" }}>{live ? "Viewing as" : "View as"}</span>
              <select className="inp" style={{ width: 168 }} value={me} onChange={(e) => setMe(e.target.value)}>
                {people.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.title}</option>)}
              </select>
            </div>
          )}
          <Btn small kind="ghost" icon={LogOut} onClick={() => { if (live) signOut(); else { localStorage.removeItem("ulm-demo-user"); setMe(""); } }}>Sign out</Btn>
          <button onClick={() => setDark(!dark)} style={{ width: 34, height: 34, borderRadius: 8, border: "1px solid var(--bdr)", background: "var(--s2)", color: "var(--txt2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </header>

        <div style={{ flex: 1, padding: 22, maxWidth: 1120, width: "100%", margin: "0 auto" }}>
          {view === "inbox" && <InboxModule onOpenProject={openProject} />}
          {view === "create" && <WizardModule onOpenProject={openProject} />}
          {view === "projects" && <ProjectsModule focusId={projectFocus} onFocusHandled={() => setProjectFocus("")} />}
          {view === "alloc" && <AllocationModule onOpenProject={openProject} />}
          {view === "clients" && <ClientsModule />}
          {view === "integrations" && <IntegrationsModule />}
          {view === "assistant" && <AssistantModule />}
          {view === "registers" && <RegistersModule />}
          {view === "deals" && <DealsV2Module onOpenProject={openProject} />}
          {view === "setup" && <SetupV2Module focusProjectId={projectFocus} />}
          {view === "registry" && <RegistryV2Module />}
        </div>
      </main>

      {/* toasts */}
      <div style={{ position: "fixed", bottom: 18, right: 18, display: "flex", flexDirection: "column", gap: 8, zIndex: 2000 }}>
        {toasts.map((t) => (
          <div key={t.id} className="fade" style={{ padding: "10px 15px", borderRadius: 10, background: "var(--s1)", border: `1px solid var(--${t.kind === "green" ? "green" : t.kind === "amber" ? "amber" : t.kind === "red" ? "red" : "acc"})`, boxShadow: "0 8px 26px rgba(0,0,0,.25)", fontSize: 12.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, maxWidth: 340 }}>
            {t.kind === "green" ? <CheckCircle2 size={14} style={{ color: "var(--green)" }} /> : t.kind === "amber" || t.kind === "red" ? <AlertTriangle size={14} style={{ color: `var(--${t.kind})` }} /> : <RefreshCw size={14} style={{ color: "var(--acc)" }} />}
            <span><MD t={t.msg} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [dark, setDark] = useState(() => localStorage.getItem("ulm-theme") === "dark");
  useEffect(() => { localStorage.setItem("ulm-theme", dark ? "dark" : "light"); }, [dark]);

  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabaseEnabled) { setAuthChecked(true); return; }
    let sub;
    (async () => {
      setSession(await getSession());
      setAuthChecked(true);
      sub = onAuthChange((s, event) => {
        setSession(s);
        if (event === "PASSWORD_RECOVERY") setRecovery(true);
        if (event === "SIGNED_OUT") setRecovery(false);
      });
    })();
    return () => sub?.unsubscribe();
  }, []);

  if (supabaseConfigured && !supabaseEnabled) return <SupabaseConfigError dark={dark} />;
  if (supabaseEnabled && !authChecked) {
    return <Shell dark={dark}><div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--txt2)", fontSize: 13 }}><Loader2 className="spin" size={18} /> Checking your session…</div></Shell>;
  }
  if (supabaseEnabled && (!session || recovery)) {
    return <Login dark={dark} onToggleTheme={() => setDark(!dark)} recovery={recovery && !!session} />;
  }

  return (
    <UlmProvider session={session}>
      <AppBody dark={dark} setDark={setDark} session={session} />
    </UlmProvider>
  );
}
