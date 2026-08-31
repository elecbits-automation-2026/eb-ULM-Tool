/* ─── Deals — the board, the sanction gate, and the one lawful conversion ────
   SOP v2.0 rule 0.2: a deal precedes a project, and only a WON deal with a PO
   reference converts. This page exists so that rule cannot be walked around —
   the generic allocator refuses family P, so the ONLY door to an EB-P is the
   Convert tab below, and it stays shut until all six gate conditions are
   confirmed, each by the single role that owns it.

   Two sources of truth meet here on purpose. The register (the Google Sheet)
   owns identity; ulm.deal_links records the workflow. A deal that exists in
   only one of them is a seam, not a secret: the board labels it, and offers
   the triage that closes it. Rule 0.4 is enforced by refusal — Lost and
   Dropped are terminal forever, and a revived idea takes the NEXT -Dss under
   the same client rather than reopening a dead row.                          */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Briefcase, ShieldCheck, CheckCircle2, Lock, Link2, Plus, RefreshCw, ExternalLink,
  FileSpreadsheet, AlertTriangle, Search, ArrowRight, Inbox, FolderOpen, Ban, Rocket,
  Info, CircleDot, Cpu,
} from "lucide-react";
import { useUlm } from "../data.jsx";
import {
  Pill, Btn, Field, Seg, KV, Modal, Empty, Section, SectionTitle, CardLabel,
  TypingDots, Done, chipS, uid, todayStr, fmtDate, inr, MD,
} from "../ui.jsx";
import {
  MONO, DEAL_STATUSES, DEAL_TERMINAL, GATE_CONDITIONS, V2_KINDS, kindV2Of,
  SECTORS_15, ORG_SIZES_V2,
} from "../constants.js";
import {
  v2Configured, v2Secure, v2List, v2Allocate, v2Update, v2Convert, v2ProvisionProject,
} from "../lib/ulmV2.js";

/* The forward ladder. Everything else is a refusal with a rule attached. */
const LADDER = ["Open", "Quoted", "Negotiation", "Won"];
const legalMoves = (cur) => {
  if (DEAL_TERMINAL.includes(cur)) return [];
  const i = LADDER.indexOf(cur);
  return [...(i >= 0 ? LADDER.slice(i + 1) : LADDER), "Lost", "Dropped"];
};
const CURRENCIES = ["INR", "USD", "EUR"];
const statusColor = (s) => DEAL_STATUSES.find((x) => x.k === s)?.c || "var(--txt3)";

const norm = (s) => String(s ?? "").trim();
const colOf = (headers, name) => (headers || []).findIndex((h) => norm(h).toLowerCase() === name.toLowerCase());
const money = (v, cur) => (!norm(v) ? "—" : cur && cur !== "INR" ? `${cur} ${v}` : inr(String(v).replace(/[^\d.]/g, "")));

/* ── the visible log — every backend step narrates itself ─────────────────── */
function useLog() {
  const [lines, setLines] = useState([]);
  const push = useCallback((t, k = "blue") => setLines((l) => [...l, { id: uid(), t, k, at: new Date() }]), []);
  const clear = useCallback(() => setLines([]), []);
  return [lines, push, clear];
}

const LogView = ({ lines }) => (
  !lines.length ? null : (
    <div style={{ background: "var(--s2)", border: "1px solid var(--bdr)", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
      {lines.map((l) => (
        <div key={l.id} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12, lineHeight: 1.6, color: l.k === "red" ? "var(--red)" : l.k === "green" ? "var(--green)" : l.k === "amber" ? "var(--amber)" : "var(--txt2)" }}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "var(--txt3)", flexShrink: 0, paddingTop: 1 }}>{l.at.toLocaleTimeString("en-IN", { hour12: false })}</span>
          <span><MD t={l.t} /></span>
        </div>
      ))}
    </div>
  )
);

/* A seam is never a blank screen — it is an amber sentence saying which half
   of the system is missing and what still works without it. Tone goes red only
   for a warning about something irreversible. */
const Seam = ({ children, tone = "amber" }) => (
  <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "10px 12px", borderRadius: 9, background: `color-mix(in srgb, var(--${tone}) 10%, transparent)`, border: `1px solid color-mix(in srgb, var(--${tone}) 35%, transparent)`, fontSize: 12, lineHeight: 1.6, color: "var(--txt)" }}>
    <AlertTriangle size={14} style={{ color: `var(--${tone})`, flexShrink: 0, marginTop: 2 }} />
    <span>{typeof children === "string" ? <MD t={children} /> : children}</span>
  </div>
);

/* v2Roles() returns null when the role table could not be read. Unknown is not
   the same as "holds nothing": we let the press through and let the server
   refuse it, rather than locking someone out of their own job on a read error. */
const rolesUnknown = (roles) => roles === null || roles === undefined;
const hasRole = (roles, r) => rolesUnknown(roles) || (roles || []).includes(r);
const roleTitle = (roles, r, msg) => (rolesUnknown(roles) ? "your roles could not be read" : (roles || []).includes(r) ? "" : msg);

/* ── TRIAGE — a sales request becomes a client + a deal, and nothing else ─── */
function TriageModal({ req, onClose, onDone }) {
  const { orgs, people, me, toast, v2TriageRequest } = useUlm();
  const by = people.find((p) => p.id === me)?.name || "";
  const [lines, push, clearLog] = useLog();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("new");          // new | existing client
  const [clients, setClients] = useState(null);     // register Clients rows
  const [clientId, setClientId] = useState("");
  const [c, setC] = useState({ name: req.orgName || "", sector: "", size: "", poc: "", legacy: "" });
  const [d, setD] = useState({ name: req.title || "", value: req.valueInr ? String(req.valueInr) : "", currency: "INR", owner: by, opened: todayStr() });
  const [made, setMade] = useState(null);           // { clientId, dealId, linked }
  const set = (fn) => (k, v) => fn((x) => ({ ...x, [k]: v }));

  /* The register's Clients tab is the only list that can name an existing
     EB-C — the database mirror may not have caught up yet. */
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!v2Configured) { setClients([]); return; }
      const res = await v2List("Clients");
      if (dead) return;
      if (!res.ok) { setClients([]); push(`Could not read the Clients tab: ${res.error}`, "amber"); return; }
      const idC = colOf(res.headers, "Client ID"), nameC = colOf(res.headers, "Organisation Name");
      setClients((res.rows || []).map((r) => ({ id: norm(r[idC]), name: norm(r[nameC]) })).filter((x) => x.id));
    })();
    return () => { dead = true; };
  }, [push]);

  const org = orgs.find((o) => o.id === req.orgId) || null;
  const ready = mode === "existing"
    ? /^EB-C-\d{2}-\d{4}$/.test(clientId.trim())
    : c.name.trim() && c.sector && c.size;

  const run = async () => {
    setBusy(true); clearLog();
    let cid = made?.clientId || (mode === "existing" ? clientId.trim().toUpperCase() : "");
    try {
      if (!cid) {
        push(`Allocating a **Client ID** for “${c.name.trim()}” — register row first, always.`);
        const rc = await v2Allocate({
          family: "C", by,
          fields: {
            "Organisation Name": c.name.trim(), "Sector": c.sector, "Org Size": c.size,
            "Point of Contact": c.poc.trim(), "Legacy ID": c.legacy.trim(),
            "Notes": req.summary ? `from ULM intake: ${req.summary}` : "",
          },
        });
        if (!rc.ok) throw new Error(rc.error);
        cid = rc.id;
        setMade({ clientId: cid, dealId: "", linked: false });
        push(`Client **${cid}** written to the Clients tab.`, "green");
      } else {
        push(`Using the existing client **${cid}** — no second row for a client we already have.`);
      }

      let did = made?.dealId || "";
      if (!did) {
        push(`Allocating the **Deal ID** under ${cid}…`);
        const rd = await v2Allocate({
          family: "DEAL", parent: cid, by,
          fields: {
            "Client ID": cid, "Deal Name": d.name.trim(), "Deal Value": d.value.trim(),
            "Currency": d.currency, "Deal Owner": d.owner.trim(), "Date Opened": d.opened,
            "Notes": `ULM intake ${req.id}`,
          },
        });
        if (!rd.ok) throw new Error(rd.error);
        did = rd.id;
        setMade({ clientId: cid, dealId: did, linked: false });
        push(`Deal **${did}** opened at status **Open**.`, "green");
      }

      push("Linking the request, the client and the deal in ULM…");
      await v2TriageRequest({ requestId: req.id, clientId: cid, dealId: did, orgId: req.orgId || null, overtake: "pending", note: `triaged from the deal board by ${by}` });
      setMade({ clientId: cid, dealId: did, linked: true });
      push(`Linked. **No project was created** — Law 10: a project appears only when this deal is Won and the gate closes.`, "green");
      toast(`${did} triaged`, "green");
      onDone?.();
    } catch (e) {
      push(`Triage stopped: ${e.message}`, "red");
      if (made?.dealId || mode === "existing") push("The register rows that succeeded are permanent — press **Retry** to finish the link only; nothing is allocated twice.", "amber");
      toast(`Triage failed: ${e.message}`, "red");
    }
    setBusy(false);
  };

  return (
    <Modal
      title={`Triage — ${req.title}`}
      sub="Allocate the client (if new) and the deal, then link the three systems. This creates no project."
      onClose={onClose} width={860}
      footer={<>
        <Btn kind="ghost" onClick={onClose} disabled={busy}>{made?.linked ? "Close" : "Cancel"}</Btn>
        <Btn icon={made?.linked ? CheckCircle2 : Plus} onClick={run} disabled={busy || !ready || made?.linked}>
          {busy ? "Working…" : made?.dealId && !made?.linked ? "Retry the link" : made?.linked ? "Done" : "Allocate & link"}
        </Btn>
      </>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "10px 12px", borderRadius: 9, background: "var(--soft)", border: "1px solid var(--bdr)", fontSize: 12, lineHeight: 1.6 }}>
          <Info size={14} style={{ color: "var(--acc)", flexShrink: 0, marginTop: 2 }} />
          <span><MD t="**Triage creates no project (Law 10).** It puts the client and the deal in the register and hands the sales request to ULM. The project is minted later, by conversion, and only if this deal is Won." /></span>
        </div>

        <Section style={{ background: "var(--s2)" }}>
          <CardLabel>The request</CardLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <KV k="Summary" v={req.summary || "—"} />
            <KV k="Organisation" v={org?.name || req.orgName || "—"} />
            <KV k="Quantity" v={req.qty ?? "—"} />
            <KV k="Indicative value" v={req.valueInr ? inr(req.valueInr) : "—"} />
            <KV k="Target date" v={fmtDate(req.targetDate)} />
          </div>
        </Section>

        <Seg
          options={[{ k: "new", label: "New client — allocate EB-C", icon: Plus }, { k: "existing", label: "Existing client ID", icon: Link2 }]}
          value={mode} onChange={setMode}
        />

        {mode === "new" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Organisation name" req><input className="inp" value={c.name} onChange={(e) => set(setC)("name", e.target.value)} placeholder="as it will read in the register" /></Field>
            <Field label="Sector" req hint="the register's 15">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {SECTORS_15.map((s) => <button key={s} style={chipS(c.sector === s)} onClick={() => set(setC)("sector", s)}>{s}</button>)}
              </div>
            </Field>
            <Field label="Org size" req>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {ORG_SIZES_V2.map((s) => <button key={s} style={chipS(c.size === s)} onClick={() => set(setC)("size", s)}>{s}</button>)}
              </div>
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Point of contact"><input className="inp" value={c.poc} onChange={(e) => set(setC)("poc", e.target.value)} /></Field>
              <Field label="Legacy ID" hint="a returning client keeps its old code here (Law 3)"><input className="inp" style={{ fontFamily: MONO }} value={c.legacy} onChange={(e) => set(setC)("legacy", e.target.value)} placeholder="e.g. PL20-001" /></Field>
            </div>
          </div>
        ) : (
          <Field label="Client ID" req hint="EB-C-YY-nnnn — the deal is derived from it">
            <input className="inp" style={{ fontFamily: MONO }} value={clientId} onChange={(e) => setClientId(e.target.value.toUpperCase())} placeholder="EB-C-26-0004" list="v2-client-ids" />
            <datalist id="v2-client-ids">{(clients || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</datalist>
            {clients === null && <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>reading the Clients tab…</span>}
            {clients?.length ? <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6, maxHeight: 110, overflowY: "auto" }}>
              {clients.slice(0, 60).map((x) => <button key={x.id} style={chipS(clientId === x.id)} onClick={() => setClientId(x.id)}><span style={{ fontFamily: MONO }}>{x.id}</span> {x.name}</button>)}
            </div> : null}
          </Field>
        )}

        <div style={{ height: 1, background: "var(--bdr)" }} />
        <CardLabel>The deal</CardLabel>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
          <Field label="Deal name" req><input className="inp" value={d.name} onChange={(e) => set(setD)("name", e.target.value)} /></Field>
          <Field label="Deal value"><input className="inp" value={d.value} onChange={(e) => set(setD)("value", e.target.value)} placeholder="1850000" /></Field>
          <Field label="Currency">
            <div style={{ display: "flex", gap: 5 }}>{CURRENCIES.map((x) => <button key={x} style={chipS(d.currency === x)} onClick={() => set(setD)("currency", x)}>{x}</button>)}</div>
          </Field>
          <Field label="Deal owner"><input className="inp" value={d.owner} onChange={(e) => set(setD)("owner", e.target.value)} /></Field>
          <Field label="Date opened"><input className="inp" type="date" value={d.opened} onChange={(e) => set(setD)("opened", e.target.value)} /></Field>
        </div>

        {!v2Configured && <Seam>{"The registrar backend is not configured, so nothing can be allocated. Set **VITE_ULM_PROXY_URL** (or VITE_ULM_DRIVE_URL) and reload."}</Seam>}
        {made?.dealId && !made?.linked && <Seam>{`The register now holds **${made.clientId}** and **${made.dealId}** — permanent, whatever happens next. Only the ULM link is outstanding.`}</Seam>}
        <LogView lines={lines} />
      </div>
    </Modal>
  );
}

/* ── DEAL INPUTS (stage 0.4) — what the client handed us, registered ─────── */
function InputsPanel({ deal, roles, by, push }) {
  const { toast } = useUlm();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ type: "PCB", desc: "", received: todayStr(), version: "", linked: "" });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const load = useCallback(async () => {
    if (!v2Configured) { setRows([]); setErr("The registrar backend is not configured — deal inputs cannot be read or registered."); return; }
    const res = await v2List("Deal Inputs");
    if (!res.ok) { setRows([]); setErr(res.error); return; }
    setErr("");
    const c = {
      id: colOf(res.headers, "Input ID"), deal: colOf(res.headers, "Deal ID"), type: colOf(res.headers, "Type"),
      desc: colOf(res.headers, "Description"), rec: colOf(res.headers, "Received On"),
      ver: colOf(res.headers, "Version as Received"), link: colOf(res.headers, "Linked PCB Input ID"),
    };
    setRows((res.rows || [])
      .map((r) => ({ id: norm(r[c.id]), dealId: norm(r[c.deal]), type: norm(r[c.type]), desc: norm(r[c.desc]), received: norm(r[c.rec]), version: norm(r[c.ver]), linked: norm(r[c.link]) }))
      .filter((x) => x.id && x.dealId.toUpperCase() === deal.id.toUpperCase()));
  }, [deal.id]);

  useEffect(() => { load(); }, [load]);

  const pcbInputs = (rows || []).filter((r) => r.type.toUpperCase() === "PCB");
  const ready = f.desc.trim() && (f.type === "PCB" || f.linked);

  const register = async () => {
    setBusy(true);
    try {
      const res = await v2Allocate({
        /* The top-level `type` only picks the id stem (…-PCB-001 / …-BOM-001);
           the allocator writes columns from `fields` alone, so without this the
           row's own Type cell came out blank and the board read it as neither. */
        family: "DEALINPUT", parent: deal.id, type: f.type, by,
        fields: {
          "Deal ID": deal.id, "Client ID": deal.clientId, "Type": f.type,
          "Description": f.desc.trim(), "Received On": f.received,
          "Version as Received": f.version.trim(),
          "Linked PCB Input ID": f.type === "BOM" ? f.linked : "",
        },
      });
      if (!res.ok) throw new Error(res.error);
      push?.(`Deal input **${res.id}** registered (${f.type}).`, "green");
      toast(`${res.id} registered`, "green");
      setF({ type: "PCB", desc: "", received: todayStr(), version: "", linked: "" });
      await load();
    } catch (e) {
      push?.(`Deal input not registered: ${e.message}`, "red");
      toast(`Could not register the input: ${e.message}`, "red");
    }
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.65 }}>
        <MD t="**Path B, stage 0.4.** Boards and BOMs the client supplies are registered against the deal — never as Elecbits designs. A BOM input must name the PCB input it belongs to: that is the only two-level chain the SOP allows." />
      </div>

      {err && <Seam>{err}</Seam>}

      <Section style={{ background: "var(--s2)" }}>
        <CardLabel right={<Pill color="var(--purple)">{(rows || []).length} received</Pill>}>Received from the client</CardLabel>
        {rows === null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> reading the Deal Inputs tab…</div>
        ) : !rows.length ? (
          <div style={{ fontSize: 12.5, color: "var(--txt3)" }}>Nothing registered against this deal yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {rows.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, paddingBottom: 8, borderBottom: "1px solid var(--bdr)" }}>
                <span style={{ fontFamily: MONO, fontWeight: 600, color: "var(--acc)" }}>{r.id}</span>
                <Pill color={r.type.toUpperCase() === "BOM" ? "var(--coral)" : "var(--blue)"}>{r.type}</Pill>
                <span style={{ flex: 1, minWidth: 160 }}>{r.desc || "—"}</span>
                {r.version && <Pill color="var(--txt2)">v{r.version.replace(/^v/i, "")}</Pill>}
                {r.linked && <span style={{ fontFamily: MONO, fontSize: 11, color: "var(--txt2)" }}>→ {r.linked}</span>}
                <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>{fmtDate(r.received)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section>
        <CardLabel>Register another input</CardLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Seg options={[{ k: "PCB", label: "Client board", icon: Cpu }, { k: "BOM", label: "Client BOM", icon: FileSpreadsheet }]} value={f.type} onChange={(k) => set("type", k)} />
          <Field label="Description" req><input className="inp" value={f.desc} onChange={(e) => set("desc", e.target.value)} placeholder="what the client sent, in their words" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Received on"><input className="inp" type="date" value={f.received} onChange={(e) => set("received", e.target.value)} /></Field>
            <Field label="Version as received" hint="their number, not ours"><input className="inp" value={f.version} onChange={(e) => set("version", e.target.value)} placeholder="e.g. 2.3" /></Field>
          </div>
          {f.type === "BOM" && (
            <Field label="Linked PCB input ID" req hint="a BOM belongs to a board">
              {pcbInputs.length ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {pcbInputs.map((p) => <button key={p.id} style={chipS(f.linked === p.id)} onClick={() => set("linked", p.id)}><span style={{ fontFamily: MONO }}>{p.id}</span></button>)}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--amber)" }}>Register the client's board first — a BOM input cannot hang from nothing.</div>
              )}
            </Field>
          )}
          {/* Allocation is the registrar's act — say so before the click,
              rather than letting the proxy answer 403 after it. */}
          <div><Btn small icon={hasRole(roles, "registrar") ? Plus : Lock} onClick={register}
                    disabled={busy || !ready || !v2Configured || !hasRole(roles, "registrar")}
                    title={roleTitle(roles, "registrar", "Only the Registrar may allocate a deal-input ID — role: registrar")}>
            {busy ? "Registering…" : `Register ${f.type} input`}</Btn></div>
        </div>
      </Section>
    </div>
  );
}

/* ── THE SANCTION GATE — six conditions, six roles, no shared ownership ───── */
function GatePanel({ deal, roles, kind, pathB, gate, reloadGate, gateErr, push }) {
  const { toast, v2ConfirmGate } = useUlm();
  const [ev, setEv] = useState({});
  const [busyN, setBusyN] = useState(null);
  const state = (n) => gate.find((g) => Number(g.condition_no) === n) || null;
  const closed = GATE_CONDITIONS.filter((c) => state(c.n)?.confirmed).length;
  const kindInfo = kindV2Of(kind);

  const confirm = async (c) => {
    setBusyN(c.n);
    try {
      /* Path B is a real column on the gate row now, not a sentence in a note —
         so a later reader can reconcile which attestation was actually made. */
      const swapped = pathB && (c.n === 2 || c.n === 3);
      await v2ConfirmGate(deal.id, c.n, ev[c.n] || "", null, swapped);
      push?.(`Condition ${c.n} confirmed as **${c.who}**.`, "green");
      toast(`Condition ${c.n} closed`, "green");
      await reloadGate();
    } catch (e) {
      push?.(`Condition ${c.n} not confirmed: ${e.message}`, "red");
      toast(`Could not confirm: ${e.message}`, "red");
    }
    setBusyN(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Pill color={closed === 6 ? "var(--green)" : "var(--amber)"} style={{ fontSize: 12 }}><ShieldCheck size={12} /> {closed}/6 closed</Pill>
        {/* The path is not a preference — it falls out of the project Kind chosen
            on the Convert tab, so it is shown here, never toggled here. */}
        <Pill color={pathB ? "var(--purple)" : "var(--blue)"}>Path {pathB ? "B" : "A"}{kindInfo ? ` — ${kindInfo.label}` : ""}</Pill>
        <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>
          {kindInfo
            ? `The Kind (${kind}) decides the path. Path B swaps conditions 2 and 3 for the design-pack attestation.`
            : "Pick the Kind on the Convert tab — it decides the path, and Path B swaps conditions 2 and 3 for the design-pack attestation."}
        </span>
      </div>

      {!deal.linked && <Seam>{"This deal is in the register only. The gate lives in the database, so it cannot be confirmed until the deal is linked in ULM — use **Link this deal** at the top of this drawer."}</Seam>}
      {gateErr && <Seam>{gateErr}</Seam>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {GATE_CONDITIONS.map((c) => {
          const st = state(c.n);
          const on = !!st?.confirmed;
          const mine = hasRole(roles, c.role);
          const swapped = pathB && c.pathB;
          return (
            <div key={c.n} className="card" style={{ padding: 13, borderColor: on ? "color-mix(in srgb, var(--green) 40%, transparent)" : "var(--bdr)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontFamily: MONO, fontSize: 12, color: "var(--txt3)" }}>{c.n}</span>
                {on ? <CheckCircle2 size={15} style={{ color: "var(--green)" }} /> : <CircleDot size={15} style={{ color: "var(--txt3)" }} />}
                <span style={{ fontWeight: 700, fontSize: 13 }}>{swapped ? c.pathB : c.label}</span>
                <Pill color={mine ? "var(--acc)" : "var(--txt2)"}>{c.who}</Pill>
                {swapped && <Pill color="var(--purple)">Path B</Pill>}
                {on && <span style={{ marginLeft: "auto" }}><Done s={`confirmed by ${st.confirmed_role || c.role}`} /></span>}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--txt2)", margin: "7px 0 9px 26px", lineHeight: 1.6 }}>Evidence: {c.evidence}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 26, flexWrap: "wrap" }}>
                <input
                  className="inp" style={{ flex: 1, minWidth: 200, padding: "7px 10px" }}
                  placeholder={on ? st.evidence_url || "evidence recorded" : "evidence URL or reference"}
                  value={ev[c.n] ?? (on ? st.evidence_url || "" : "")}
                  onChange={(e) => setEv((x) => ({ ...x, [c.n]: e.target.value }))}
                />
                <Btn
                  small kind={on ? "ghost" : "green"} icon={mine ? CheckCircle2 : Lock}
                  /* The gate row carries a foreign key to the ULM deal link — an
                     unlinked deal makes the insert fail raw, so refuse earlier. */
                  disabled={!mine || !deal.linked || busyN === c.n}
                  title={!deal.linked ? "Link this deal in ULM first" : roleTitle(roles, c.role, `Only the ${c.who} may confirm this — role: ${c.role}`)}
                  onClick={() => confirm(c)}
                >
                  {busyN === c.n ? "Confirming…" : on ? "Re-confirm" : "Confirm"}
                </Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── CONVERT — the one lawful door to an EB-P ─────────────────────────────── */
function ConvertPanel({ deal, roles, gate, kind, setKind, pathB, onOpenProject, push, lines }) {
  const { people, me, toast, projects, v2ConvertDeal, v2RecordProvisioning } = useUlm();
  const by = people.find((p) => p.id === me)?.name || "";
  const closed = GATE_CONDITIONS.filter((c) => gate.find((g) => Number(g.condition_no) === c.n)?.confirmed).length;
  const status = deal.status;
  /* Kind lives in the drawer, not here — the gate tab reads the same choice, so
     picking MFG/SCS swaps gate conditions 2 and 3 the moment it is picked. */
  const [f, setF] = useState({ name: deal.name || "", pm: "", deadline: "", desc: "", llds: "" });
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(deal.converted ? { projectId: deal.converted } : null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const pmPerson = people.find((p) => p.id === f.pm) || null;
  const mayConvert = hasRole(roles, "registrar");
  const blocked = status !== "Won" ? "Rule 0.2 — only a WON deal converts." : closed < 6 ? `The gate is open — ${6 - closed} of 6 conditions unconfirmed.` : "";
  const ready = !blocked && f.name.trim() && kind;

  const projRowId = useMemo(() => {
    const pid = out?.projectId;
    return pid ? (projects.find((p) => p.projectId === pid)?.id || out?.rowId || null) : null;
  }, [out, projects]);

  /* Register row → database sanction → folder → link back. In that order,
     always, and every step is safe to press twice. */
  const run = async () => {
    setBusy(true);
    let projectId = out?.projectId || "";
    try {
      if (!projectId) {
        push(`Minting the Project ID in the register — the generic allocator refuses family **P**, so this is the only door.`);
        const rc = await v2Convert(deal.id, { "Project Name": f.name.trim(), "Kind": kind, "Project Manager": pmPerson?.name || "" }, by);
        if (!rc.ok) throw new Error(rc.error);
        projectId = rc.projectId;
        setOut({ projectId, registerUrl: rc.registerUrl });
        push(`Project **${projectId}** written to the Projects tab, and both link ends closed on ${deal.id}.`, "green");
      } else {
        push(`Resuming with **${projectId}** — the register row already exists.`, "amber");
      }
      try { await v2RecordProvisioning(projectId, "P", "row_written"); } catch (e) { push(`Provisioning state not recorded (row_written): ${e.message}`, "amber"); }
    } catch (e) {
      push(`Conversion stopped in the register: ${e.message}`, "red");
      toast(`Conversion failed: ${e.message}`, "red");
      setBusy(false);
      return;
    }

    let rowId = out?.rowId || null;
    /* A folder is not a sanction. If the database half fails, the run continues
       so the Drive work is not wasted — but the closing toast must not claim a
       success the project record never got. */
    let sanctioned = true;
    try {
      push("Creating and sanctioning the project in the database, and settling the sales request…");
      const row = await v2ConvertDeal({
        dealId: deal.id, projectId, name: f.name.trim(), kindV2: kind,
        pm: f.pm || null, deadline: f.deadline || null, pathB, desc: f.desc || null,
      });
      const r = Array.isArray(row) ? row[0] : row;
      rowId = r?.id || null;
      setOut((o) => ({ ...(o || {}), projectId, rowId }));
      push(`Sanctioned as **${kindV2Of(kind)?.label || kind}** — routed to ${kindV2Of(kind)?.tool || "the delivery tool"}.`, "green");
    } catch (e) {
      sanctioned = false;
      push(`The database half did not settle: ${e.message} — the register row stands; press Retry.`, "red");
      toast(`Sanction failed: ${e.message}`, "red");
    }

    try {
      push("Replicating the project blueprint into Eb-17-Projects — the folder is named with the Project ID alone…");
      const lldUrls = f.llds.split(/\s*\n\s*/).map((s) => s.trim()).filter(Boolean);
      const pv = await v2ProvisionProject({ projectId, lldUrls, by }, (p) => push(`…still copying — ${p.copied || 0} files, ${p.folders || 0} folders so far (round ${p.round}).`));
      if (!pv.ok) throw new Error(pv.error);
      setOut((o) => ({ ...(o || {}), projectId, rowId, folderUrl: pv.folderUrl }));
      try { await v2RecordProvisioning(projectId, "P", "folder_created", { folderUrl: pv.folderUrl }); } catch (e) { push(`Provisioning state not recorded (folder_created): ${e.message}`, "amber"); }
      push(`Folder **${projectId}** ready — ${pv.copied ?? 0} files / ${pv.folders ?? 0} folders${pv.lldCopied ? `, ${pv.lldCopied} LLD${pv.lldCopied === 1 ? "" : "s"} filed` : ""}${pv.governance ? ", governance log seeded" : ""}.`, "green");
      try { await v2RecordProvisioning(projectId, "P", "link_written", { folderUrl: pv.folderUrl }); } catch (e) { push(`Provisioning state not recorded (link_written): ${e.message}`, "amber"); }
      if (sanctioned) toast(`${projectId} converted and provisioned`, "green");
      else toast(`${projectId} — the folder exists, but the database sanction did not settle; press Retry`, "amber");
    } catch (e) {
      try { await v2RecordProvisioning(projectId, "P", "failed", { error: e.message }); } catch { /* the log already says it */ }
      push(`Provisioning failed: ${e.message} — **${projectId}** ${sanctioned ? "exists and is sanctioned" : "exists in the register, but the database sanction did not settle either"}; press Retry when Drive is back.`, "red");
      toast(`Provisioning failed: ${e.message}`, "red");
    }
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "10px 12px", borderRadius: 9, background: "var(--soft)", border: "1px solid var(--bdr)", fontSize: 12, lineHeight: 1.65 }}>
        <Info size={14} style={{ color: "var(--acc)", flexShrink: 0, marginTop: 2 }} />
        <span><MD t="**Rule 0.2 — deal WON, PO confirmed, PM sanctions → a Project ID.** Nothing earlier in the pipeline earns one, and nothing else in this tool can mint one." /></span>
      </div>

      {blocked ? <Seam>{blocked}</Seam> : null}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
        <Field label="Project name" req><input className="inp" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Deadline"><input className="inp" type="date" value={f.deadline} onChange={(e) => set("deadline", e.target.value)} /></Field>
      </div>
      <Field label="Kind" req hint="decides the path and the delivery tool — and the gate's conditions 2 and 3">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {V2_KINDS.map((k) => (
            <button key={k.k} style={chipS(kind === k.k)} onClick={() => setKind(k.k)} title={k.hint}>
              {k.label} <span style={{ fontFamily: MONO, opacity: 0.6 }}>{k.k}</span> <span style={{ opacity: 0.6 }}>· path {k.path}</span>
            </button>
          ))}
        </div>
        {kind && (
          <div style={{ fontSize: 11.5, color: "var(--txt2)", marginTop: 6 }}>
            <MD t={pathB
              ? "**Path B** — the client owns the design, so gate conditions 2 and 3 are the design-pack attestations, and the conversion is recorded as Path B."
              : "**Path A** — Elecbits designs it, so gate conditions 2 and 3 are the locked LLDs."} />
          </div>
        )}
      </Field>
      <Field label="Project manager" hint="one owner, recorded in the register and the database">
        <select className="inp" value={f.pm} onChange={(e) => set("pm", e.target.value)}>
          <option value="">— pick a PM —</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}
        </select>
      </Field>
      <Field label="Description"><textarea className="inp" rows={2} value={f.desc} onChange={(e) => set("desc", e.target.value)} /></Field>
      <Field label="LLD links" hint="one URL per line — filed into the new folder"><textarea className="inp" rows={2} value={f.llds} onChange={(e) => set("llds", e.target.value)} placeholder="https://drive.google.com/…" /></Field>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Btn
          icon={mayConvert ? Rocket : Lock} onClick={run}
          disabled={busy || !ready || !v2Configured || !mayConvert}
          title={roleTitle(roles, "registrar", "Only the Registrar may mint a Project ID — role: registrar")}
        >
          {busy ? "Converting…" : out?.projectId ? "Retry — resume the conversion" : "Convert to a project"}
        </Btn>
        {busy && <TypingDots />}
        {out?.projectId && <Pill color="var(--green)" style={{ fontFamily: MONO }}>{out.projectId}</Pill>}
        {out?.folderUrl && <a href={out.folderUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)"><FolderOpen size={11} /> Drive folder <ExternalLink size={10} /></Pill></a>}
        {projRowId && <Btn small kind="ghost" icon={ArrowRight} onClick={() => onOpenProject?.(projRowId)}>Open the project</Btn>}
      </div>

      <LogView lines={lines} />
    </div>
  );
}

/* ── the drawer ───────────────────────────────────────────────────────────── */
function DealDrawer({ deal, roles, candidates, onClose, onChanged, onOpenProject }) {
  const { people, me, toast, projects, v2GateState, v2SetDealStatus, v2TriageRequest } = useUlm();
  const by = people.find((p) => p.id === me)?.name || "";
  const [tab, setTab] = useState("status");
  const [lines, push] = useLog();
  const [gate, setGate] = useState([]);
  const [gateErr, setGateErr] = useState("");
  /* One Kind, two tabs. The path is derived from it — never chosen separately —
     so the gate a person confirms is the gate the conversion will record. */
  /* An already-converted deal seeds its Kind from the project it minted, so the
     gate tab shows the path that was actually recorded rather than a blank. */
  const [kind, setKind] = useState(() => (deal.converted ? (projects.find((p) => p.projectId === deal.converted)?.kindV2 || "") : ""));
  const pathB = kindV2Of(kind)?.path === "B";
  const [move, setMove] = useState("");          // status being moved to
  const [poRef, setPoRef] = useState(deal.poRef || "");
  const [reason, setReason] = useState("");
  const [ackTerminal, setAckTerminal] = useState(false);  // the second step before a forever
  const [value, setValue] = useState(deal.value || "");
  const [busy, setBusy] = useState(false);
  const [revive, setRevive] = useState("");
  const [revived, setRevived] = useState("");    // the new Deal ID, once minted

  const loadGate = useCallback(async () => {
    try { setGate(await v2GateState(deal.id)); setGateErr(""); }
    catch (e) { setGate([]); setGateErr(`Gate state needs the database: ${e.message}`); }
  }, [v2GateState, deal.id]);
  useEffect(() => { loadGate(); }, [loadGate]);

  const closed = GATE_CONDITIONS.filter((c) => gate.find((g) => Number(g.condition_no) === c.n)?.confirmed).length;
  /* A converted deal has spent itself: the ladder is over, and Lost/Dropped
     after conversion would orphan a live project. */
  const moves = deal.converted ? [] : legalMoves(deal.status);
  const terminal = DEAL_TERMINAL.includes(deal.status);
  const convertedProj = deal.converted ? (projects.find((p) => p.projectId === deal.converted) || null) : null;
  const needsPo = move === "Won";
  const needsReason = DEAL_TERMINAL.includes(move);
  const mayMove = hasRole(roles, "deal_owner");
  const mayAllocate = hasRole(roles, "registrar");
  const canMove = move && (!needsPo || poRef.trim()) && (!needsReason || (reason.trim() && ackTerminal));

  /* One move, two ledgers: ulm.deal_links carries the decision, the register
     carries the same words so the sheet never lies. */
  const applyMove = async () => {
    setBusy(true);
    try {
      await v2SetDealStatus(deal.id, move, poRef.trim(), reason.trim());
      push(`Status → **${move}** recorded in ULM${needsPo ? ` against PO ${poRef.trim()}` : ""}.`, "green");
    } catch (e) {
      push(`ULM refused the move: ${e.message}`, "red");
      toast(`Move refused: ${e.message}`, "red");
      setBusy(false);
      return;
    }
    /* Two ledgers, one move. A green toast may only be said when BOTH of them
       carry it — otherwise the sheet still shows the old status and the person
       walks away believing it does not. */
    let mirrored = true;
    if (v2Configured) {
      try {
        const values = { "Status": move };
        if (DEAL_TERMINAL.includes(move) || move === "Won") values["Date Closed"] = todayStr();
        if (needsReason) values["Loss Reason"] = reason.trim();
        if (norm(value) && norm(value) !== norm(deal.value)) values["Deal Value"] = value.trim();
        const res = await v2Update("Deals", deal.id, values);
        if (!res.ok) throw new Error(res.error);
        push(`Register mirrored — ${(res.changed || []).join(", ") || "no columns changed"}${(res.refused || []).length ? ` · refused: ${res.refused.join(", ")}` : ""}.`, "green");
      } catch (e) {
        mirrored = false;
        push(`The register was not mirrored: ${e.message} — press the move again, it is idempotent.`, "red");
      }
    } else {
      mirrored = false;
      push("The registrar backend is not configured — the Deals tab still says the old status.", "amber");
    }
    if (mirrored) toast(`${deal.id} → ${move}`, "green");
    else toast(`${deal.id} → ${move} in ULM, but the register was not mirrored`, "amber");
    setMove(""); setReason(""); setAckTerminal(false);
    await loadGate();
    onChanged?.();
    setBusy(false);
  };

  const reviveDeal = async () => {
    setBusy(true);
    try {
      const res = await v2Allocate({
        family: "DEAL", parent: deal.clientId, by,
        fields: {
          "Client ID": deal.clientId, "Deal Name": revive.trim() || `${deal.name || deal.id} — revived`,
          "Currency": deal.currency || "INR", "Deal Owner": deal.owner || by, "Date Opened": todayStr(),
          "Notes": `revived from ${deal.id} (${deal.status}) — rule 0.4`,
        },
      });
      if (!res.ok) throw new Error(res.error);
      /* A Deal ID is permanent. Latch the result so a second press cannot mint a
         second one for the same revival — the same latch TriageModal uses. */
      setRevived(res.id);
      push(`New deal **${res.id}** opened under ${deal.clientId}. The dead row stays exactly where it is.`, "green");
      toast(`${res.id} opened`, "green");
      onChanged?.();
    } catch (e) {
      push(`Could not open a new deal: ${e.message}`, "red");
      toast(`Revival failed: ${e.message}`, "red");
    }
    setBusy(false);
  };

  const linkTo = async (req) => {
    setBusy(true);
    try {
      await v2TriageRequest({ requestId: req.id, clientId: deal.clientId, dealId: deal.id, orgId: req.orgId || null, overtake: "pending", note: `linked from the deal board by ${by}` });
      push(`Linked **${deal.id}** to the request “${req.title}”.`, "green");
      toast(`${deal.id} linked`, "green");
      onChanged?.();
    } catch (e) {
      push(`Link failed: ${e.message}`, "red");
      toast(`Link failed: ${e.message}`, "red");
    }
    setBusy(false);
  };

  const tabs = [
    { k: "status", label: "Status", icon: Briefcase },
    { k: "inputs", label: "Deal inputs", icon: FileSpreadsheet },
    { k: "gate", label: `Gate ${closed}/6`, icon: ShieldCheck },
    { k: "convert", label: "Convert", icon: Rocket },
  ];

  return (
    <Modal
      title={deal.id}
      sub={`${deal.name || "—"} · ${deal.clientId}${deal.converted ? ` · converted to ${deal.converted}` : ""}`}
      onClose={onClose} width={940}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Pill color={statusColor(deal.status)} style={{ fontSize: 12 }}>{deal.status}</Pill>
          <Pill color={deal.linked ? "var(--green)" : "var(--amber)"}>{deal.linked ? "linked in ULM" : "in the register only"}</Pill>
          {deal.mismatch && <Pill color="var(--amber)"><AlertTriangle size={11} /> register says “{deal.reg?.status}”</Pill>}
          <div style={{ marginLeft: "auto" }}><Seg options={tabs} value={tab} onChange={setTab} /></div>
        </div>

        {!deal.linked && (
          <Section style={{ background: "var(--s2)" }}>
            <CardLabel right={<Pill color="var(--amber)"><Link2 size={11} /> unlinked</Pill>}>Link this deal</CardLabel>
            <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.65, marginBottom: 10 }}>
              <MD t="This row is in the register but has no ULM link, so the gate, the status ladder and conversion are all inert for it. Linking it to the sales request it came from repairs that." />
            </div>
            {candidates.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {candidates.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5 }}>
                    <span style={{ flex: 1, minWidth: 180, fontWeight: 600 }}>{r.title}</span>
                    <span style={{ color: "var(--txt3)", fontSize: 11.5 }}>{r.orgName || "—"}</span>
                    <Btn small kind="ghost" icon={mayAllocate ? Link2 : Lock} disabled={busy || !mayAllocate}
                         title={roleTitle(roles, "registrar", "Only the Registrar may link a deal to a request — role: registrar")}
                         onClick={() => linkTo(r)}>Link this deal</Btn>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--txt3)" }}>No untriaged sales request left to link it to — the link is made from a request, so this deal stays register-only until one arrives.</div>
            )}
          </Section>
        )}

        {tab === "status" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Section style={{ background: "var(--s2)" }}>
              <CardLabel>The row</CardLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                <KV k="Deal ID" v={deal.id} mono />
                <KV k="Client ID" v={deal.clientId} mono />
                <KV k="Deal name" v={deal.name || "—"} />
                <KV k="Deal value" v={money(deal.value, deal.currency)} />
                <KV k="Deal owner" v={deal.owner || "—"} />
                <KV k="Opened" v={fmtDate(deal.opened)} />
                <KV k="Closed" v={deal.closed ? fmtDate(deal.closed) : "—"} />
                <KV k="PO reference" v={deal.poRef || "—"} />
                <KV k="Converted to" v={deal.converted || "— not yet"} mono />
                <KV k="Loss reason" v={deal.lossReason || "—"} />
              </div>
            </Section>

            {deal.converted ? (
              /* Converted is as final as terminal: the deal has become a project,
                 and the ladder has nowhere left to go. */
              <Section style={{ borderColor: "color-mix(in srgb, var(--green) 35%, transparent)" }}>
                <CardLabel right={<Pill color="var(--green)"><Rocket size={11} /> converted</Pill>}>Rule 0.2 — spent</CardLabel>
                <div style={{ fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 12 }}>
                  <MD t={`This deal was won and converted to **${deal.converted}**. It does not move again — not to Lost, not to Dropped: the project it minted is the record of what happened next. A further piece of work for this client takes a **new Deal ID** (rule 2.0).`} />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill color="var(--green)" style={{ fontFamily: MONO }}>{deal.converted}</Pill>
                  {convertedProj
                    ? <Btn small kind="ghost" icon={ArrowRight} onClick={() => onOpenProject?.(convertedProj.id)}>Open the project</Btn>
                    : <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>The project row is not in this session's data — refresh, or open it from the Projects page.</span>}
                </div>
              </Section>
            ) : terminal ? (
              <Section style={{ borderColor: "color-mix(in srgb, var(--red) 35%, transparent)" }}>
                <CardLabel right={<Pill color="var(--red)"><Ban size={11} /> terminal</Pill>}>Rule 0.4</CardLabel>
                <div style={{ fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.7, marginBottom: 12 }}>
                  <MD t={`**${deal.status} is terminal forever.** The row stays as pipeline history and never moves again — reopening it would rewrite what happened. If the client comes back, the work takes a **new Deal ID** under the same client, and this row is the reason it exists.`} />
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <Field label="New deal name"><input className="inp" value={revive} onChange={(e) => setRevive(e.target.value)} placeholder={`${deal.name || deal.id} — revived`} /></Field>
                  </div>
                  <Btn
                    small icon={revived ? CheckCircle2 : mayAllocate ? Plus : Lock} onClick={reviveDeal}
                    disabled={busy || !v2Configured || !mayAllocate || !!revived}
                    title={roleTitle(roles, "registrar", "Only the Registrar may allocate a Deal ID — role: registrar")}
                  >
                    {revived ? `Opened ${revived}` : busy ? "Opening…" : `Revive as a new deal under ${deal.clientId}`}
                  </Btn>
                </div>
              </Section>
            ) : (
              <Section>
                <CardLabel>Move the deal</CardLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {DEAL_STATUSES.map((s) => {
                    const legal = moves.includes(s.k);
                    const cur = s.k === deal.status;
                    return (
                      <button
                        key={s.k}
                        disabled={!legal}
                        title={cur ? "where it stands now" : legal ? "" : "not a legal move from here"}
                        onClick={() => { setMove(s.k); setReason(""); setAckTerminal(false); }}
                        style={{ ...chipS(move === s.k), opacity: legal ? 1 : 0.4, cursor: legal ? "pointer" : "not-allowed", borderColor: cur ? s.c : undefined, color: move === s.k ? "var(--acc)" : cur ? s.c : "var(--txt)" }}
                      >
                        {cur ? "● " : ""}{s.k}
                      </button>
                    );
                  })}
                </div>
                {move && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {needsPo && (
                      <Field label="PO reference" req hint="gate condition 0's evidence — a Won deal without one is not Won">
                        <input className="inp" value={poRef} onChange={(e) => setPoRef(e.target.value)} placeholder="PO-2026-0142" />
                      </Field>
                    )}
                    {needsReason && (
                      <Field label={`Why ${move.toLowerCase()}?`} req hint="the row stays forever — this is what it will say">
                        <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} />
                      </Field>
                    )}
                    <Field label="Deal value" hint="corrected in the column, never in the identifier">
                      <input className="inp" value={value} onChange={(e) => setValue(e.target.value)} />
                    </Field>
                    {/* A forever needs two presses. The sentence says what cannot be
                        undone, and the checkbox is the second one. */}
                    {needsReason && (
                      <Seam tone="red">
                        <div>
                          <MD t={`**${move} is terminal — this row can never move again.** Not back to Negotiation, not to Won. It stays as pipeline history, and if the client returns, the revived idea takes a **NEW Deal ID** under the same client (rule 0.4).`} />
                          <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, fontSize: 12, cursor: "pointer" }}>
                            <input type="checkbox" checked={ackTerminal} onChange={(e) => setAckTerminal(e.target.checked)} />
                            <span>I understand this is permanent</span>
                          </label>
                        </div>
                      </Seam>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Btn
                        small icon={mayMove ? ArrowRight : Lock} onClick={applyMove}
                        disabled={busy || !canMove || !deal.linked || !mayMove}
                        title={!deal.linked ? "Link this deal in ULM first" : roleTitle(roles, "deal_owner", "Only the Deal Owner may move a deal — role: deal_owner")}
                      >
                        {busy ? "Moving…" : `Move to ${move}`}
                      </Btn>
                      <Btn small kind="ghost" onClick={() => setMove("")} disabled={busy}>Cancel</Btn>
                    </div>
                  </div>
                )}
              </Section>
            )}
            <LogView lines={lines} />
          </div>
        )}

        {tab === "inputs" && <InputsPanel deal={deal} roles={roles} by={by} push={push} />}

        {tab === "gate" && (
          <GatePanel
            deal={deal} roles={roles} kind={kind} pathB={pathB}
            gate={gate} reloadGate={loadGate} gateErr={gateErr} push={push}
          />
        )}

        {tab === "convert" && (
          <ConvertPanel
            deal={deal} roles={roles} gate={gate} kind={kind} setKind={setKind} pathB={pathB}
            onOpenProject={onOpenProject} push={push} lines={lines}
          />
        )}

        {tab !== "convert" && tab !== "status" && <LogView lines={lines} />}
      </div>
    </Modal>
  );
}

/* ── the board ────────────────────────────────────────────────────────────── */
export default function DealsV2Module({ onOpenProject }) {
  const { live, requests, orgs, v2Deals, v2Roles } = useUlm();
  const [links, setLinks] = useState([]);
  const [dbErr, setDbErr] = useState("");
  const [reg, setReg] = useState({ headers: [], rows: [], url: "" });
  const [regErr, setRegErr] = useState("");
  const [roles, setRoles] = useState(null);   // null = not read yet / unreadable
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState("");
  const [triage, setTriage] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    try { setLinks(await v2Deals()); setDbErr(""); }
    catch (e) { setLinks([]); setDbErr(e.message); }
    if (v2Configured) {
      const res = await v2List("Deals");
      if (res.ok) { setReg({ headers: res.headers || [], rows: res.rows || [], url: res.registerUrl || "" }); setRegErr(""); }
      else { setReg({ headers: [], rows: [], url: "" }); setRegErr(res.error); }
    }
    /* v2Roles() itself returns null when the table cannot be read; a throw means
       the same thing. Never fall back to [] — that would assert "holds nothing". */
    try { setRoles(await v2Roles()); } catch { setRoles(null); }
    setLoading(false); setBusy(false);
  }, [v2Deals, v2Roles]);

  useEffect(() => { load(); }, [load]);

  const regDeals = useMemo(() => {
    const h = reg.headers;
    const c = {
      id: colOf(h, "Deal ID"), client: colOf(h, "Client ID"), name: colOf(h, "Deal Name"),
      status: colOf(h, "Status"), value: colOf(h, "Deal Value"), currency: colOf(h, "Currency"),
      owner: colOf(h, "Deal Owner"), opened: colOf(h, "Date Opened"), closed: colOf(h, "Date Closed"),
      conv: colOf(h, "Converted to Project ID"), loss: colOf(h, "Loss Reason"),
    };
    return reg.rows.map((r) => {
      const g = (k) => (c[k] >= 0 ? norm(r[c[k]]) : "");
      return { id: g("id"), clientId: g("client"), name: g("name"), status: g("status") || "Open", value: g("value"), currency: g("currency"), owner: g("owner"), opened: g("opened"), closed: g("closed"), converted: g("conv"), lossReason: g("loss") };
    }).filter((x) => x.id);
  }, [reg]);

  /* The board is the union, never one half pretending to be the whole. */
  const deals = useMemo(() => {
    const byId = new Map();
    regDeals.forEach((r) => byId.set(r.id.toUpperCase(), { ...r, reg: r, linked: false, link: null, poRef: "" }));
    links.forEach((l) => {
      const k = norm(l.deal_id).toUpperCase();
      const prev = byId.get(k);
      byId.set(k, {
        ...(prev || { id: l.deal_id, clientId: l.client_id, name: "", value: "", currency: "", owner: "", opened: l.created_at, closed: "", converted: "", lossReason: "" }),
        id: l.deal_id, clientId: l.client_id || prev?.clientId || "",
        status: l.status || prev?.status || "Open",
        converted: l.converted_project || prev?.converted || "",
        poRef: l.po_reference || "",
        reg: prev?.reg || null, linked: true, link: l,
        mismatch: !!(prev?.reg?.status && l.status && prev.reg.status !== l.status),
      });
    });
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }, [regDeals, links]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? deals.filter((d) => [d.id, d.name, d.clientId, d.owner].some((s) => String(s || "").toLowerCase().includes(needle))) : deals;

  const columns = useMemo(() => {
    const known = DEAL_STATUSES.map((s) => ({ ...s, items: shown.filter((d) => d.status === s.k) }));
    const other = shown.filter((d) => !DEAL_STATUSES.some((s) => s.k === d.status));
    return other.length ? [...known, { k: "Unrecognised", c: "var(--amber)", items: other }] : known;
  }, [shown]);

  /* The inbox side: requests ULM has not yet turned into a client + deal. */
  const untriaged = useMemo(() => {
    const taken = new Set(links.map((l) => l.intake_request).filter(Boolean));
    return requests.filter((r) => ["submitted", "draft"].includes(r.status) && !taken.has(r.id));
  }, [requests, links]);

  const open = deals.find((d) => d.id === openId) || null;
  const linkedCount = deals.filter((d) => d.linked).length;

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Section style={{ background: "var(--soft)", borderColor: "var(--bdr)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Briefcase size={17} style={{ color: "var(--acc)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12.5, lineHeight: 1.7 }}>
            <MD t="**What this does.** Every project starts as a deal. Rule 0.2: *deal WON, PO confirmed, PM sanctions* → a Project ID — and nothing before that earns one. Triage puts a client and a deal in the register; the six-condition gate is confirmed one role at a time; conversion mints the EB-P, sanctions it and builds its folder, in that order. Lost and Dropped are terminal: a revived idea takes the next Deal ID under the same client (rule 0.4)." />
          </div>
        </div>
      </Section>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 380 }}>
          <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--txt3)" }} />
          <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals, clients, owners…" />
        </div>
        <Pill color="var(--green)">{linkedCount} linked in ULM</Pill>
        <Pill color="var(--amber)">{deals.length - linkedCount} in the register only</Pill>
        <Pill color={v2Secure ? "var(--green)" : "var(--amber)"}><ShieldCheck size={11} /> {v2Secure ? "role-checked proxy" : v2Configured ? "direct transport" : "no registrar backend"}</Pill>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {reg.url && <a href={reg.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)"><FileSpreadsheet size={11} /> the register <ExternalLink size={10} /></Pill></a>}
          <Btn small kind="ghost" icon={RefreshCw} onClick={load} disabled={busy}>{busy ? "Reading…" : "Refresh"}</Btn>
        </div>
      </div>

      {!v2Configured && <Seam>{"The registrar backend is not configured, so the register half of this board is blank and nothing can be allocated. Set **VITE_ULM_PROXY_URL** (preferred) or VITE_ULM_DRIVE_URL."}</Seam>}
      {regErr && <Seam>{`The Deals tab could not be read: ${regErr} — the board below shows only what ULM has linked.`}</Seam>}
      {/* Demo mode does not error — v2Deals() just returns nothing — so the
          explanation has to hang off !live, not off a failure that never comes. */}
      {!live
        ? <Seam>{"**Demo mode.** This board needs the shared database: no deal is linked, the gate cannot be confirmed and conversion is unavailable, and every write is refused rather than silently dropped. Only the register reads still work, and only if the registrar backend is configured."}</Seam>
        : dbErr
          ? <Seam>{`ULM deal links could not be read: ${dbErr} — run supabase/20-ulm-v2.sql and 21-ulm-v2-flows.sql.`}</Seam>
          : null}

      {/* TRIAGE — the sales inbox that has not become a deal yet */}
      <Section>
        <SectionTitle icon={Inbox} right={<Pill color={untriaged.length ? "var(--amber)" : "var(--green)"}>{untriaged.length} waiting</Pill>}>
          Triage — requests with no deal yet
        </SectionTitle>
        <div style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.65, marginBottom: 10 }}>
          <MD t="Triaging allocates the client (if the organisation has none) and the deal, then links the request, the deal and the client. **It creates no project** — Law 10." />
        </div>
        {!untriaged.length ? (
          <div style={{ fontSize: 12.5, color: "var(--txt3)" }}>Nothing waiting. Every submitted request is on the board.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {untriaged.map((r) => {
              const org = orgs.find((o) => o.id === r.orgId);
              return (
                <div key={r.id} className="rowHover" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "9px 10px", borderRadius: 9, border: "1px solid var(--bdr)" }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.title}</div>
                    <div style={{ fontSize: 11, color: "var(--txt3)" }}>{org?.name || r.orgName || "new organisation"}{r.valueInr ? ` · ${inr(r.valueInr)}` : ""}{r.qty ? ` · ${r.qty} units` : ""}</div>
                  </div>
                  {r.urgency === "high" && <Pill color="var(--red)">urgent</Pill>}
                  {/* Triage allocates register IDs — that is the Registrar's press. */}
                  <Btn
                    small icon={hasRole(roles, "registrar") ? ArrowRight : Lock} onClick={() => setTriage(r)}
                    disabled={!v2Configured || !hasRole(roles, "registrar")}
                    title={!v2Configured ? "The registrar backend is not configured" : roleTitle(roles, "registrar", "Only the Registrar may allocate a Client or Deal ID — role: registrar")}
                  >Triage</Btn>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* THE BOARD */}
      {loading ? (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 8, padding: 24, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> reading the register and the ULM links…</div>
      ) : !deals.length ? (
        <Empty icon={Briefcase} title="No deals yet" sub="Triage a sales request above to open the first one — the register gets the client and the deal, and this board fills in." />
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6, alignItems: "flex-start" }}>
          {columns.map((col) => (
            <div key={col.k} style={{ minWidth: 250, width: 250, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 4px", borderBottom: `2px solid ${col.c}` }}>
                <span style={{ fontWeight: 700, fontSize: 12.5, color: col.c }}>{col.k}</span>
                <Pill color={col.c}>{col.items.length}</Pill>
              </div>
              {!col.items.length && <div style={{ fontSize: 11.5, color: "var(--txt3)", padding: "8px 4px" }}>—</div>}
              {col.items.map((d) => (
                <div key={d.id} className="card rowHover" onClick={() => setOpenId(d.id)} style={{ padding: 11, cursor: "pointer", display: "flex", flexDirection: "column", gap: 7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                    <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: "var(--acc)" }}>{d.id}</span>
                    {d.converted && <Pill color="var(--green)"><Rocket size={10} /> converted</Pill>}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.45 }}>{d.name || "— unnamed —"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
                    <span style={{ color: "var(--txt3)" }}>{money(d.value, d.currency)}</span>
                    {d.owner && <span style={{ color: "var(--txt3)" }}>· {d.owner}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Pill color={d.linked ? "var(--green)" : "var(--amber)"}>{d.linked ? "linked in ULM" : "register only"}</Pill>
                    {d.mismatch && <Pill color="var(--amber)"><AlertTriangle size={10} /> status differs</Pill>}
                  </div>
                  {!d.linked && (
                    <Btn small kind="ghost" icon={Link2} style={{ alignSelf: "flex-start" }} onClick={(e) => { e.stopPropagation(); setOpenId(d.id); }}>Link this deal</Btn>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {triage && <TriageModal req={triage} onClose={() => setTriage(null)} onDone={load} />}
      {open && (
        <DealDrawer
          deal={open} roles={roles} candidates={untriaged}
          onClose={() => setOpenId("")} onChanged={load} onOpenProject={onOpenProject}
        />
      )}
      {!loading && !live && deals.length === 0 && (
        <div style={{ fontSize: 11.5, color: "var(--txt3)", textAlign: "center" }}>
          Demo mode — sign the tool into Supabase to see real deal links, or configure the registrar backend to read the register.
        </div>
      )}
    </div>
  );
}
