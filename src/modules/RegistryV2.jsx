/* ─── Registry v2 — the register console ─────────────────────────────────────
   Eb-Master_Register_v2.0 is the company's book of record: SOP v2.0 says the
   register row comes FIRST, the folder second, the link back third. If the
   book is wrong, everything downstream is wrong — so this page is where the
   book is pinned, proved and audited, and it is deliberately read-only apart
   from two things a registrar genuinely does from a portal: pinning/validating
   the register at cutover, and issuing a Vendor ID (SOP step 29 — a
   manufacturing run cannot be placed with a vendor that has no identifier).

   Why the cutover panel is a copy-and-paste flow: the Apps Script property
   V2_REGISTER_ID cannot be written from the browser, and that is correct —
   pinning the wrong workbook would silently fork the register. The portal
   finds the candidates and states the one manual step in full.

   Why the validate step is loud about the blue rows: the allocator REFUSES to
   mint an identifier while the shipped worked examples are still in a tab
   (SOP §5.4), because a serial counted off an example row is a serial that
   collides the moment someone deletes it.                                   */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Database, Search, ExternalLink, ShieldCheck, ShieldAlert, Copy, MapPin, CheckCircle2,
  AlertTriangle, Stethoscope, Truck, Plus, BookOpen, ChevronDown, ChevronRight, Link2,
  Scale, Trash2, RefreshCw,
} from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, Field, Modal, Empty, Section, SectionTitle, CardLabel, KV, TypingDots, chipS } from "../ui.jsx";
import { MONO, V2_FAMILIES, V2_DERIVED, NDA_STATUSES } from "../constants.js";
import { v2Configured, v2Secure, v2Locate, v2Validate, v2List, v2Health, v2Allocate } from "../lib/ulmV2.js";

/* The eleven tabs of the workbook, in the order the SOP walks them. */
const TABS = ["Clients", "Deals", "Deal Inputs", "Projects", "PCB", "BOM", "FW", "Enclosure", "MFG", "Vendors", "Master"];

/* Which law governs the identifier column of each tab. Master is a join tab —
   its first column is a Client ID. */
const LAW_BY_TAB = (() => {
  const m = {};
  V2_FAMILIES.forEach((f) => { m[f.tab] = f; });
  V2_DERIVED.forEach((d) => {
    const tab = { DEAL: "Deals", BOM: "BOM", DEALINPUT: "Deal Inputs", MFG: "MFG" }[d.k];
    if (tab) m[tab] = d;
  });
  m.Master = V2_FAMILIES.find((f) => f.k === "C");
  return m;
})();

/* The grammar, derived from the examples in constants.js so this card can
   never drift from the regexes it describes. */
const grammarOf = (eg) => String(eg)
  .replace(/-(\d{2})-(\d{4})/, "-YY-nnnn")
  .replace(/MFG-\d{3}-\d+/, "MFG-nnn-{ordered qty}")
  .replace(/D\d{2}/, "Dnn")
  .replace(/(BOM|PCB)-\d{3}/, "$1-nnn");

/* Legacy "Eb-…" ids predate the SOP and are exempt from the format law — the
   backend exempts them too. Anything that claims to be v2 ("EB-…") and is not
   is a breach worth naming. */
function idVerdict(tab, value) {
  const id = String(value ?? "").trim();
  if (!id) return { kind: "blank" };
  const law = LAW_BY_TAB[tab];
  if (!law) return { kind: "ok" };
  if (/^EB-/.test(id)) return law.re.test(id) ? { kind: "ok" } : { kind: "breach", law };
  if (/^Eb/i.test(id)) return { kind: "legacy" };
  return { kind: "breach", law };
}

const copy = async (text, toast) => {
  try {
    await navigator.clipboard.writeText(String(text));
    toast("Copied to the clipboard", "green");
  } catch {
    toast("Could not reach the clipboard — select the id and copy it by hand", "amber");
  }
};

/* ── the seam, stated once and reused ─────────────────────────────────────── */
const Seam = ({ children }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 10, background: "color-mix(in srgb, var(--amber) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--amber) 35%, transparent)", fontSize: 12.5, lineHeight: 1.7, color: "var(--txt)" }}>
    <AlertTriangle size={15} style={{ color: "var(--amber)", marginTop: 2, flexShrink: 0 }} />
    <div>{children}</div>
  </div>
);

/* ═══ 1. Cutover ═══════════════════════════════════════════════════════════ */
function CutoverPanel({ val, setVal, canIssue, whyNot }) {
  const { toast } = useUlm();
  const [open, setOpen] = useState(true);
  const [loc, setLoc] = useState(null);
  const [locating, setLocating] = useState(false);
  const [validating, setValidating] = useState(false);

  const ready = val?.allocationReady;

  /* Once the book is proved clean the cutover is finished business — it folds
     itself away and leaves only the green line, but stays one click away. */
  useEffect(() => { if (ready) setOpen(false); }, [ready]);

  const locate = async () => {
    setLocating(true);
    try {
      const res = await v2Locate();
      setLoc(res);
      if (res.ok) toast(`${(res.candidates || []).length} candidate register${(res.candidates || []).length === 1 ? "" : "s"} found`, "green");
      else toast(`Locate failed: ${res.error || "unknown error"}`, "red");
    } catch (e) {
      setLoc({ ok: false, error: e.message });
      toast(`Locate failed: ${e.message}`, "red");
    }
    setLocating(false);
  };

  const validate = async () => {
    setValidating(true);
    try {
      const res = await v2Validate();
      setVal(res);
      if (res.ok && res.allocationReady) toast("The register is clean — allocation is open", "green");
      else if (res.ok) toast("Validated — the register is not allocation-ready yet", "amber");
      else toast(`Validate failed: ${res.error || (res.problems || [])[0] || "unknown error"}`, "red");
    } catch (e) {
      setVal({ ok: false, problems: [e.message] });
      toast(`Validate failed: ${e.message}`, "red");
    }
    setValidating(false);
  };

  const tabs = val?.tabs ? Object.entries(val.tabs) : [];

  return (
    <Section>
      <SectionTitle
        icon={MapPin}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Pill color={v2Secure ? "var(--green)" : "var(--amber)"}>
              {v2Secure ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />} {v2Secure ? "secure proxy" : "direct transport"}
            </Pill>
            {ready && <Pill color="var(--green)"><CheckCircle2 size={11} /> allocation ready</Pill>}
            <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--txt2)", display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600 }}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{open ? "Hide" : "Cutover"}
            </button>
          </div>
        }
      >
        Cutover — pin the live register
      </SectionTitle>

      <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.7, marginBottom: open ? 14 : 0 }}>
        {v2Secure
          ? "Calls go through the role-checked edge proxy: the proxy verifies your sign-in, asks the database whether YOU hold the registrar role, and keeps the Drive token in its own secrets — the token is not in this browser bundle."
          : "Calls go direct to the Drive web app: the shared token travels from this browser, and the backend cannot tell one caller from another. It works, but nothing here is role-checked until VITE_ULM_PROXY_URL is set."}
      </div>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!v2Configured ? (
            <Seam>
              The v2 registrar backend is <b>not configured</b>. Set <code style={{ fontFamily: MONO }}>VITE_ULM_PROXY_URL</code> (preferred) or <code style={{ fontFamily: MONO }}>VITE_ULM_DRIVE_URL</code> and reload — until then this console can show the law but cannot read the book.
            </Seam>
          ) : (
            <>
              {/* ── locate ─────────────────────────────────────────────── */}
              <div>
                <CardLabel right={<Btn small kind="ghost" icon={MapPin} onClick={locate} disabled={locating}>{locating ? "Searching Drive…" : "Locate candidates"}</Btn>}>
                  Step 1 — find the workbook
                </CardLabel>
                {locating && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> asking Drive which spreadsheets look like the master register…</div>}
                {loc && !loc.ok && <Seam>Drive could not be searched: {loc.error || "unknown error"}</Seam>}
                {loc?.ok && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <KV k="Currently pinned" v={loc.pinned || "nothing pinned yet"} mono />
                    {loc.note && <Seam>{loc.note}</Seam>}
                    {(loc.candidates || []).map((c) => {
                      const good = c.hasApparatus && c.hasCoreTabs;
                      const isPinned = loc.pinned && loc.pinned === c.fileId;
                      return (
                        <div key={c.fileId} style={{ border: `1px solid ${isPinned ? "var(--green)" : "var(--bdr)"}`, borderRadius: 10, padding: 12, background: isPinned ? "color-mix(in srgb, var(--green) 8%, transparent)" : "var(--s2)", display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
                            {isPinned && <Pill color="var(--green)"><CheckCircle2 size={11} /> pinned</Pill>}
                            <Pill color={c.hasCoreTabs ? "var(--green)" : "var(--red)"}>{c.hasCoreTabs ? "core tabs present" : "no Clients/Deals tabs"}</Pill>
                            <Pill color={c.hasApparatus ? "var(--green)" : "var(--amber)"}>{c.hasApparatus ? "Counters + Rules present" : "no Counters/Rules apparatus"}</Pill>
                            {c.error && <Pill color="var(--red)">{c.error}</Pill>}
                            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--txt3)" }}>updated {c.updated ? new Date(c.updated).toLocaleString() : "—"}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <code style={{ fontFamily: MONO, fontSize: 12, padding: "6px 10px", background: "var(--s1)", border: "1px solid var(--bdr)", borderRadius: 8, overflowWrap: "anywhere" }}>{c.fileId}</code>
                            <Btn small kind="ghost" icon={Copy} onClick={() => copy(c.fileId, toast)}>Copy fileId</Btn>
                            {c.url && <a href={c.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)">open <ExternalLink size={10} /></Pill></a>}
                          </div>
                          {!good && <div style={{ fontSize: 11.5, color: "var(--amber)", lineHeight: 1.6 }}>This one is missing part of the v2 apparatus — open it before pinning and be sure it is the file XOR writes to.</div>}
                        </div>
                      );
                    })}
                    <div style={{ fontSize: 12.5, lineHeight: 1.8, padding: 12, borderRadius: 10, background: "var(--soft)", border: "1px solid var(--bdr)" }}>
                      <b>The one step the portal cannot do for you.</b> A web page cannot write an Apps Script property — and it should not, because pinning the wrong workbook forks the register silently. So:
                      <div style={{ marginTop: 6, paddingLeft: 14, color: "var(--txt2)" }}>
                        1. Copy the <code style={{ fontFamily: MONO }}>fileId</code> of the register you just confirmed is the live one.<br />
                        2. Open the Apps Script project → <b>Project Settings</b> → <b>Script Properties</b>.<br />
                        3. Add (or edit) the property <code style={{ fontFamily: MONO, fontWeight: 700, color: "var(--txt)" }}>V2_REGISTER_ID</code> and paste the fileId as its value. Save.<br />
                        4. Come back here and press <b>Validate</b>.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── validate ─────────────────────────────────────────────
                 Locate is a read and stays open to everyone, but v2.validate
                 is in the proxy's REGISTRAR_ACTIONS — so a non-registrar who
                 presses this gets a 403 dressed up as a red toast. Say it in
                 the button instead of letting the server say it in a shout. */}
              <div>
                <CardLabel right={<Btn small icon={CheckCircle2} onClick={validate} disabled={validating || !canIssue} title={canIssue ? "" : whyNot}>{validating ? "Validating…" : "Validate the register"}</Btn>}>
                  Step 2 — prove it is ready
                </CardLabel>
                {/* Printed whether or not the button is disabled: when the roles
                    could not be read this is a caveat on a live button, not a
                    refusal — so it must not be hidden behind !canIssue. */}
                {whyNot && <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 600, lineHeight: 1.7, marginBottom: 6 }}>{whyNot}</div>}
                {validating && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> counting rows and looking for the blue example rows…</div>}
                {!val && !validating && <div style={{ fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.7 }}>Nothing validated yet in this session. Validation counts the real rows per tab, flags format breaches, and lists the shipped worked-example rows that still have to go.</div>}
                {val && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <KV k="Pinned register" v={val.registerId || "not pinned"} mono />
                    {!!tabs.length && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 8 }}>
                        {tabs.map(([tab, t]) => (
                          <div key={tab} style={{ border: "1px solid var(--bdr)", borderRadius: 9, padding: "9px 11px", background: "var(--s2)" }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700 }}>{tab}</div>
                            <div style={{ fontSize: 11.5, color: "var(--txt2)", marginTop: 3 }}>
                              <b style={{ color: "var(--txt)", fontFamily: MONO }}>{t.real}</b> real
                              {t.examples ? <> · <b style={{ color: "var(--blue)", fontFamily: MONO }}>{t.examples}</b> example{t.examples === 1 ? "" : "s"}</> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {!!(val.exampleRows || []).length && (
                      <div style={{ border: "1px solid color-mix(in srgb, var(--blue) 40%, transparent)", background: "color-mix(in srgb, var(--blue) 9%, transparent)", borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 12.5, marginBottom: 6, color: "var(--blue)" }}>
                          <Trash2 size={14} /> {val.exampleRows.length} blue worked-example row{val.exampleRows.length === 1 ? "" : "s"} still in the workbook
                        </div>
                        <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 8 }}>
                          <b>The allocator refuses to mint anything while these exist (SOP §5.4).</b> They are teaching rows, not data: a serial counted off one of them collides the day somebody deletes it. Open each row below and delete the whole row — not just the cells.
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 160, overflowY: "auto" }}>
                          {val.exampleRows.map((r) => <code key={r} style={{ fontFamily: MONO, fontSize: 11, padding: "3px 8px", background: "var(--s1)", border: "1px solid var(--bdr)", borderRadius: 6 }}>{r}</code>)}
                        </div>
                      </div>
                    )}

                    {!!(val.problems || []).length && (
                      <Seam>
                        <b>Problems found</b>
                        <ul style={{ margin: "6px 0 0 16px" }}>{val.problems.map((p, i) => <li key={i} style={{ marginBottom: 3 }}>{p}</li>)}</ul>
                      </Seam>
                    )}

                    {val.allocationReady && (
                      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: 12, borderRadius: 10, background: "color-mix(in srgb, var(--green) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--green) 38%, transparent)", fontSize: 12.5, lineHeight: 1.6 }}>
                        <CheckCircle2 size={16} style={{ color: "var(--green)", flexShrink: 0 }} />
                        <span><b>Allocation ready.</b> The register is pinned, every tab has its apparatus, and no example rows remain. Identifiers can be issued.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

/* ═══ 2. Tab browser ═══════════════════════════════════════════════════════ */
function TabBrowser() {
  const { toast } = useUlm();
  const [tab, setTab] = useState("Clients");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  /* Tabs can be switched while a read is still in the air. Without a token the
     slower answer lands last and paints one tab's rows under another tab's
     headers — which on a register console reads as data corruption. Only the
     newest request is allowed to touch state; a stale one returns silently
     (and leaves `loading` alone, because the newer read owns it now). */
  const reqRef = useRef(0);

  const load = useCallback(async (t) => {
    if (!v2Configured) return;
    const my = ++reqRef.current;
    setLoading(true); setErr("");
    try {
      const res = await v2List(t);
      if (!res.ok) throw new Error(res.error || "the register refused the read");
      if (my !== reqRef.current) return;
      setData({ headers: res.headers || [], rows: res.rows || [], url: res.registerUrl || "" });
    } catch (e) {
      if (my !== reqRef.current) return;
      setData(null); setErr(e.message);
      toast(`Could not read ${t}: ${e.message}`, "red");
    }
    if (my !== reqRef.current) return;
    setLoading(false);
  }, [toast]);

  useEffect(() => { setQ(""); load(tab); }, [tab, load]);

  const needle = q.trim().toLowerCase();
  const all = data?.rows || [];
  const rows = needle ? all.filter((r) => r.some((c) => String(c ?? "").toLowerCase().includes(needle))) : all;
  const shown = rows.slice(0, 300);
  const headers = data?.headers || [];
  const breaches = useMemo(() => shown.filter((r) => idVerdict(tab, r[0]).kind === "breach").length, [shown, tab]);

  return (
    <Section>
      <SectionTitle
        icon={Database}
        right={data?.url && <a href={data.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)">open the sheet <ExternalLink size={10} /></Pill></a>}
      >
        The register, tab by tab
      </SectionTitle>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <select className="inp" style={{ width: "auto", minWidth: 160, fontWeight: 600 }} value={tab} onChange={(e) => setTab(e.target.value)}>
          {TABS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 340, marginLeft: "auto" }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--txt3)" }} />
          <input className="inp" style={{ paddingLeft: 30 }} placeholder="Search every column…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Btn small kind="ghost" icon={RefreshCw} onClick={() => load(tab)} disabled={loading || !v2Configured}>{loading ? "Reading…" : "Reload"}</Btn>
      </div>

      {!v2Configured ? (
        <Seam>The register cannot be read: the v2 backend is not configured in this deployment.</Seam>
      ) : loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 20, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> reading <b>{tab}</b>…</div>
      ) : err ? (
        <Seam><b>{tab}</b> could not be read: {err}<br />If the message mentions pinning, finish the cutover panel above first.</Seam>
      ) : !headers.length ? (
        <Empty icon={Database} title={`No rows on ${tab}`} sub="The tab exists but has nothing below its header — which is the correct state for a tab nobody has used yet." />
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: "var(--txt2)", marginBottom: 8 }}>
            <b>{all.length}</b> row{all.length === 1 ? "" : "s"}
            {needle && <> · <b>{rows.length}</b> match{rows.length === 1 ? "" : "es"}</>}
            {rows.length > shown.length && <> · showing the first {shown.length} — refine the search</>}
            {!!breaches && <> · <span style={{ color: "var(--amber)", fontWeight: 700 }}>{breaches} identifier{breaches === 1 ? "" : "s"} breach the format law</span></>}
          </div>
          <div style={{ border: "1px solid var(--bdr)", borderRadius: 10, overflow: "auto", maxHeight: 460 }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid var(--bdr)", background: "var(--s2)", fontSize: 11, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, ri) => {
                  const v = idVerdict(tab, r[0]);
                  return (
                    <tr key={ri} className="rowHover" style={{ borderBottom: "1px solid var(--bdr)" }}>
                      {headers.map((h, ci) => {
                        const isId = ci === 0;
                        const cell = String(r[ci] ?? "");
                        return (
                          <td
                            key={ci}
                            title={isId && v.kind === "breach" ? `Breaks the format law for ${v.law.label}: ${v.law.eg} — identifiers are permanent and meaning-free, so this row must be corrected in the sheet, never re-numbered here.` : cell}
                            style={{
                              padding: "7px 12px", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                              fontFamily: isId || /\bID\b/i.test(String(h)) ? MONO : undefined,
                              background: isId && v.kind === "breach" ? "color-mix(in srgb, var(--amber) 16%, transparent)" : undefined,
                              color: isId && v.kind === "breach" ? "var(--amber)" : undefined,
                              fontWeight: isId ? 600 : undefined,
                            }}
                          >
                            {cell}
                            {isId && v.kind === "legacy" && <Pill color="var(--txt3)" style={{ marginLeft: 7, fontSize: 10 }}>legacy</Pill>}
                            {isId && v.kind === "breach" && <AlertTriangle size={11} style={{ marginLeft: 6, verticalAlign: "-1px" }} />}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {!shown.length && <tr><td colSpan={headers.length} style={{ padding: 18, color: "var(--txt3)", fontSize: 12 }}>No rows{needle ? " match the search" : ""}.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

/* ═══ 3. Health sweep ══════════════════════════════════════════════════════ */
const HEALTH_GROUPS = [
  { k: "duplicates", label: "Duplicate identifiers", color: "var(--red)", icon: AlertTriangle, say: "Stop. Do not overwrite either row — both are somebody's evidence. Record the collision, take the NEXT free id for the newer thing, and re-point its folder." },
  { k: "formatBreaches", label: "Format-law breaches", color: "var(--amber)", icon: Scale, say: "These ids claim to be v2 and are not. Identifiers are permanent, so correct the descriptive columns and re-issue only if the row is genuinely unallocated." },
  { k: "linkDebt", label: "Link debt", color: "var(--blue)", icon: Link2, say: "The link column is the only route from an identifier to the thing it names. A row with no link is an id that points at nothing — provision the folder and write the link back." },
  { k: "qtyMismatch", label: "Delivered ≠ ordered", color: "var(--amber)", icon: Truck, say: "The ordered quantity is frozen inside the MFG id. Confirm this is a genuine short-ship and note it in the run's column — never edit the identifier to match reality." },
];

function HealthSweep() {
  const { toast } = useUlm();
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await v2Health();
      setRes(r);
      if (!r.ok) toast(`Health sweep failed: ${r.error || "unknown error"}`, "red");
      else {
        const n = HEALTH_GROUPS.reduce((s, g) => s + (r[g.k] || []).length, 0);
        toast(n ? `${n} finding${n === 1 ? "" : "s"} across the register` : "The register is clean", n ? "amber" : "green");
      }
    } catch (e) {
      setRes({ ok: false, error: e.message });
      toast(`Health sweep failed: ${e.message}`, "red");
    }
    setBusy(false);
  };

  const total = res?.ok ? HEALTH_GROUPS.reduce((s, g) => s + (res[g.k] || []).length, 0) : 0;

  return (
    <Section>
      <SectionTitle icon={Stethoscope} right={<Btn small icon={Stethoscope} onClick={run} disabled={busy || !v2Configured}>{busy ? "Sweeping…" : "Run the health sweep"}</Btn>}>
        Health sweep
      </SectionTitle>

      {!v2Configured ? (
        <Seam>The sweep reads the workbook directly and the v2 backend is not configured, so it cannot run here.</Seam>
      ) : busy ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> walking every tab — duplicates, format, links, quantities…</div>
      ) : !res ? (
        <div style={{ fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.7 }}>
          Four questions, asked of the whole book: is any identifier issued twice, does any v2 id break its grammar, does any row name a thing it cannot link to, and has any run delivered a quantity other than the one frozen in its id.
        </div>
      ) : !res.ok ? (
        <Seam>The sweep could not complete: {res.error || "unknown error"}</Seam>
      ) : !total ? (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: 14, borderRadius: 10, background: "color-mix(in srgb, var(--green) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--green) 38%, transparent)", fontSize: 12.5 }}>
          <CheckCircle2 size={16} style={{ color: "var(--green)", flexShrink: 0 }} />
          <span><b>Clean.</b> No duplicates, no format breaches, no link debt, no quantity mismatches.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {HEALTH_GROUPS.map((g) => {
            const items = res[g.k] || [];
            if (!items.length) return null;
            return (
              <div key={g.k} style={{ border: `1px solid color-mix(in srgb, ${g.color} 38%, transparent)`, background: `color-mix(in srgb, ${g.color} 8%, transparent)`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 12.5, color: g.color, marginBottom: 5 }}>
                  <g.icon size={14} /> {g.label} <Pill color={g.color}>{items.length}</Pill>
                </div>
                <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 8 }}>{g.say}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 180, overflowY: "auto" }}>
                  {items.map((s, i) => <code key={i} style={{ fontFamily: MONO, fontSize: 11, padding: "3px 8px", background: "var(--s1)", border: "1px solid var(--bdr)", borderRadius: 6 }}>{s}</code>)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ═══ 4. Vendors ═══════════════════════════════════════════════════════════ */
function NewVendorModal({ onClose, onDone, by }) {
  const { toast } = useUlm();
  const [f, setF] = useState({ "Vendor Name": "", Country: "India", "Primary Service": "", "Additional Services": "", "NDA Status": "Not Signed", "Legacy ID": "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const issue = async () => {
    setBusy(true);
    try {
      const res = await v2Allocate({ family: "V", fields: f, by });
      if (!res.ok) throw new Error(res.error || "the registrar refused");
      toast(`${res.id} issued and written to the Vendors tab`, "green");
      onDone?.();
      onClose();
    } catch (e) {
      toast(`Vendor ID not issued: ${e.message}`, "red");
    }
    setBusy(false);
  };

  return (
    <Modal
      title="Issue a Vendor ID"
      sub="The row is written in the same locked call that mints the id — register first, always"
      onClose={busy ? undefined : onClose}
      width={620}
      footer={<><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn icon={Plus} onClick={issue} disabled={busy || !f["Vendor Name"].trim()}>{busy ? "Issuing…" : "Issue the ID"}</Btn></>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.7 }}>
          The identifier is meaning-free and permanent — nothing you type here is encoded into it. Everything below is a column, and every column can be corrected later.
        </div>
        <Field label="Vendor name" req><input className="inp" autoFocus value={f["Vendor Name"]} onChange={(e) => set("Vendor Name", e.target.value)} placeholder="e.g. Shenzhen Kingford" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Country"><input className="inp" value={f.Country} onChange={(e) => set("Country", e.target.value)} /></Field>
          <Field label="Legacy ID" hint="if they existed before the SOP"><input className="inp" value={f["Legacy ID"]} onChange={(e) => set("Legacy ID", e.target.value)} /></Field>
        </div>
        <Field label="Primary service" hint="the one thing they are called for"><input className="inp" value={f["Primary Service"]} onChange={(e) => set("Primary Service", e.target.value)} placeholder="e.g. PCB fabrication" /></Field>
        <Field label="Additional services"><input className="inp" value={f["Additional Services"]} onChange={(e) => set("Additional Services", e.target.value)} placeholder="e.g. assembly, stencils" /></Field>
        <Field label="NDA status" req>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {NDA_STATUSES.map((s) => <button key={s} style={chipS(f["NDA Status"] === s)} onClick={() => set("NDA Status", s)}>{s}</button>)}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function Vendors({ canIssue, whyNot, roleNote, by }) {
  const { toast } = useUlm();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [add, setAdd] = useState(false);

  /* Same race as the tab browser: issuing an id fires a reload while the first
     one may still be running, and the stale answer would hide the row that was
     just written. Newest request wins. */
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    if (!v2Configured) return;
    const my = ++reqRef.current;
    setLoading(true); setErr("");
    try {
      const res = await v2List("Vendors");
      if (!res.ok) throw new Error(res.error || "the register refused the read");
      if (my !== reqRef.current) return;
      setData({ headers: res.headers || [], rows: res.rows || [], url: res.registerUrl || "" });
    } catch (e) {
      if (my !== reqRef.current) return;
      setData(null); setErr(e.message);
      toast(`Could not read the Vendors tab: ${e.message}`, "red");
    }
    if (my !== reqRef.current) return;
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const rows = data?.rows || [];
  const headers = data?.headers || [];
  const col = (name) => headers.indexOf(name);

  return (
    <Section>
      <SectionTitle
        icon={Truck}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {data?.url && <a href={data.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)">sheet <ExternalLink size={10} /></Pill></a>}
            <Btn small icon={Plus} onClick={() => setAdd(true)} disabled={!canIssue} title={canIssue ? roleNote : whyNot}>Issue a vendor ID</Btn>
          </div>
        }
      >
        Vendors
      </SectionTitle>

      <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 12 }}>
        A manufacturing run is placed with a vendor, and SOP step 29 wants that vendor named by identifier — so this is the one issuance that lives on the register page rather than deep in a workflow.
        {!canIssue && whyNot && <> <span style={{ color: "var(--amber)", fontWeight: 600 }}>{whyNot}</span></>}
        {canIssue && roleNote && <> <span style={{ color: "var(--amber)", fontWeight: 600 }}>{roleNote}</span></>}
      </div>

      {!v2Configured ? (
        <Seam>The Vendors tab cannot be read or written: the v2 backend is not configured.</Seam>
      ) : loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 16, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> reading the Vendors tab…</div>
      ) : err ? (
        <Seam>Vendors could not be read: {err}</Seam>
      ) : !rows.length ? (
        <Empty icon={Truck} title="No vendors on the register" sub="Issue the first Vendor ID before a manufacturing run needs to name one — the run cannot cite a vendor that does not exist in the book." />
      ) : (
        <div style={{ border: "1px solid var(--bdr)", borderRadius: 10, overflow: "auto", maxHeight: 340 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                {["Vendor ID", "Vendor Name", "Country", "Primary Service", "NDA Status", "Status"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "9px 12px", borderBottom: "1px solid var(--bdr)", background: "var(--s2)", fontSize: 11, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 300).map((r, i) => {
                const v = idVerdict("Vendors", r[0]);
                return (
                  <tr key={i} className="rowHover" style={{ borderBottom: "1px solid var(--bdr)" }}>
                    <td style={{ padding: "7px 12px", fontFamily: MONO, fontWeight: 600, background: v.kind === "breach" ? "color-mix(in srgb, var(--amber) 16%, transparent)" : undefined, color: v.kind === "breach" ? "var(--amber)" : undefined }} title={v.kind === "breach" ? `Breaks the format law for Vendor: ${v.law.eg}` : ""}>
                      {String(r[0] ?? "")}
                      {v.kind === "legacy" && <Pill color="var(--txt3)" style={{ marginLeft: 7, fontSize: 10 }}>legacy</Pill>}
                    </td>
                    {["Vendor Name", "Country", "Primary Service", "NDA Status", "Status"].map((h) => (
                      <td key={h} style={{ padding: "7px 12px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={String(r[col(h)] ?? "")}>{col(h) >= 0 ? String(r[col(h)] ?? "") : "—"}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {add && <NewVendorModal by={by} onClose={() => setAdd(false)} onDone={load} />}
    </Section>
  );
}

/* ═══ 5. Quick reference ═══════════════════════════════════════════════════ */
/* Declared at module scope, not inside QuickReference: a component defined in
   a render body is a brand-new type every render, so React would unmount and
   remount the whole grammar table on any state change above it. It closes over
   nothing, so there is no reason for it to live in there. */
const GrammarRow = ({ label, note, grammar, eg, muted }) => (
  <div style={{ display: "grid", gridTemplateColumns: "minmax(90px,1fr) minmax(180px,1.5fr) minmax(160px,1.4fr)", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--bdr)", alignItems: "center", opacity: muted ? 0.6 : 1 }}>
    <div>
      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{label}</div>
      {note && <div style={{ fontSize: 10.5, color: "var(--txt3)" }}>{note}</div>}
    </div>
    <code style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--acc)" }}>{grammar}</code>
    <code style={{ fontFamily: MONO, fontSize: 11.5, color: "var(--txt2)" }}>{eg}</code>
  </div>
);

function QuickReference() {
  return (
    <Section>
      <SectionTitle icon={BookOpen}>The ID grammar</SectionTitle>
      <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 10 }}>
        Identifiers are permanent and meaning-free: <b>YY</b> is the year of issue, <b>nnnn</b> a global serial. A derived id carries its parent in full plus exactly one block. Nothing descriptive ever goes into a name — it goes into a column. Files are named <code style={{ fontFamily: MONO }}>[Identifier]_[FileName]_v[X.Y]</code>.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(90px,1fr) minmax(180px,1.5fr) minmax(160px,1.4fr)", gap: 10, padding: "0 0 6px", fontSize: 10.5, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>
        <span>Family</span><span>Grammar</span><span>Example</span>
      </div>
      {V2_FAMILIES.map((f) => (
        <GrammarRow key={f.k} label={f.label} grammar={grammarOf(f.eg)} eg={f.eg} muted={f.readOnly}
          note={f.gated ? "only from a won deal" : f.readOnly ? "governed elsewhere" : `${f.tab} tab`} />
      ))}
      {V2_DERIVED.map((d) => (
        <GrammarRow key={d.k} label={d.label} grammar={grammarOf(d.eg)} eg={d.eg} note={`under a ${d.parent}`} />
      ))}
      <div style={{ fontSize: 11.5, color: "var(--txt3)", lineHeight: 1.7, marginTop: 10 }}>
        Project folders are named with the Project ID alone. A run freezes its ordered quantity in the id; what actually arrived lives in the <b>Delivered Qty</b> column. Ids beginning <code style={{ fontFamily: MONO }}>Eb-</code> predate the SOP, are exempt from the grammar, and are never re-numbered.
      </div>
    </Section>
  );
}

/* ═══ the page ═════════════════════════════════════════════════════════════ */
export default function RegistryV2Module() {
  const { live, people, me, v2Roles } = useUlm();
  const [val, setVal] = useState(null);
  /* Three states, and they are genuinely different things:
       undefined → the lookup is still in flight
       null      → v2Roles() could not read the roles at all
       array     → the roles we know you hold (admins get the full list, because
                   ulm.has_role() ORs is_admin server-side)
     Collapsing "unknown" into "holds nothing" is the bug this replaces: it told
     admins they were not registrars and disabled buttons with a false reason. */
  const [roles, setRoles] = useState(undefined);

  useEffect(() => {
    let dead = false;
    (async () => {
      try { const r = await v2Roles(); if (!dead) setRoles(Array.isArray(r) ? r : null); }
      catch { if (!dead) setRoles(null); }
    })();
    return () => { dead = true; };
  }, [v2Roles]);

  const by = useMemo(() => people.find((p) => p.id === me)?.name || "", [people, me]);

  const rolesLoading = roles === undefined;
  const rolesUnknown = roles === null;
  const isRegistrar = Array.isArray(roles) && roles.includes("registrar");

  /* The proxy is the real gate — it re-checks the role for every REGISTRAR
     action — so "we could not read your roles" is a caveat, not a refusal:
     leave the button live and let the server be the one to say no. Only a
     definite "you do not hold it" disables, and only that names the role. */
  const canIssue = v2Configured && !rolesLoading && (isRegistrar || rolesUnknown);
  const whyNot = !v2Configured
    ? "The v2 backend is not configured in this deployment."
    : rolesLoading
      ? "Checking your roles…"
      : rolesUnknown
        ? ""
        : !isRegistrar
          ? "You do not hold the registrar role, so the proxy would refuse this write."
          : "";
  /* Shown even when the action stays enabled — the user deserves to know the
     portal is asking blind rather than vouching for them. */
  const roleNote = !v2Configured || !rolesUnknown ? "" : "Your roles could not be read, so nothing here is pre-checked — the proxy will accept or refuse this on its own.";

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!live && (
        <Seam>
          <b>Demo mode.</b> No database is connected, so roles and workflow history are simulated — but the register itself is a Google Sheet, so everything on this page that reads or writes the book {v2Configured ? "is live and real. Treat the vendor issuance as a real write." : "is unavailable until the v2 backend is configured."}
        </Seam>
      )}

      <CutoverPanel val={val} setVal={setVal} canIssue={canIssue} whyNot={whyNot || roleNote} />
      <TabBrowser />
      <HealthSweep />
      <Vendors canIssue={canIssue} whyNot={whyNot} roleNote={roleNote} by={by} />
      <QuickReference />
    </div>
  );
}
