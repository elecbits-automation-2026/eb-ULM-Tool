/* ─── Sanction Inbox ──────────────────────────────────────────────────────────
   Requirement #1: requests for project creation and sanction. Two feeds land
   here — sales/portal requests (core.intake) and projects sitting in
   sanction_state='requested' (raised inside a delivery tool, e.g. the ODM
   app's mirror). ULM reviews, scores, and answers through the one door.       */

import { useMemo, useState } from "react";
import { Inbox as InboxIcon, Send, Shield, CheckCircle2, XCircle, HelpCircle, AlertTriangle, Layers } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, AvatarDot, Field, Seg, Modal, Empty, SectionTitle, Section, KV, chipS, fmtDate, fmtDateTime, inr } from "../ui.jsx";
import { MONO, KINDS, kindOf, REVIEW_AXES, SANCTION_STATES } from "../constants.js";

const URGENCY = { low: "var(--txt2)", normal: "var(--blue)", high: "var(--red)" };

function ScoreRow({ axis, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 110 }}>{axis.label}</span>
      <span style={{ fontSize: 10.5, color: "var(--txt3)", minWidth: 130 }}>{axis.hint}</span>
      <div style={{ display: "flex", gap: 5 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => onChange(value === n ? null : n)} style={{ ...chipS(value === n), padding: "4px 10px" }}>{n}</button>
        ))}
      </div>
    </div>
  );
}

function ReviewModal({ req, onClose }) {
  const { isAdmin, people, orgs, saveReview, acceptRequest, rejectRequest, toast } = useUlm();
  const [scores, setScores] = useState({ feasibility: null, capacity: null, commercial: null, strategic: null });
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState("");            // "" | accept | reject
  const [kind, setKind] = useState(req.kind || "");
  const [code, setCode] = useState("");
  const [name, setName] = useState(req.title || "");
  const [deadline, setDeadline] = useState(req.targetDate || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submitter = people.find((p) => p.id === req.submittedBy);

  const doAccept = async () => {
    if (!kind) { setErr("Pick a delivery route first — sanction requires a kind."); return; }
    setBusy(true); setErr("");
    try {
      await saveReview({ requestId: req.id, kind, ...scores, notes, verdict: "accept" });
      await acceptRequest(req, { kind, code: code.trim() || null, name: name.trim() || null, deadline: deadline || null, note: notes || null });
      toast(`Request accepted — project sanctioned as ${kindOf(kind)?.label}`, "green");
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const doReject = async () => {
    setBusy(true); setErr("");
    try {
      await saveReview({ requestId: req.id, kind: kind || req.kind, ...scores, notes, verdict: "reject" });
      await rejectRequest(req, notes || null);
      toast("Request rejected", "amber");
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const doMoreInfo = async () => {
    setBusy(true); setErr("");
    try {
      await saveReview({ requestId: req.id, kind: kind || req.kind, ...scores, notes, verdict: "more_info" });
      toast("Marked as needs more info — the request stays in the inbox", "blue");
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal title={req.title} sub={`Raised ${fmtDateTime(req.submittedAt)}${submitter ? ` by ${submitter.name}` : ""}`} onClose={onClose} width={760}
      footer={isAdmin && req.status === "submitted" ? (
        mode === "accept" ? (
          <>
            <Btn kind="ghost" onClick={() => setMode("")} disabled={busy}>Back</Btn>
            <Btn kind="green" icon={CheckCircle2} onClick={doAccept} disabled={busy || !kind}>{busy ? "Sanctioning…" : "Accept & sanction"}</Btn>
          </>
        ) : mode === "reject" ? (
          <>
            <Btn kind="ghost" onClick={() => setMode("")} disabled={busy}>Back</Btn>
            <Btn kind="danger" icon={XCircle} onClick={doReject} disabled={busy}>{busy ? "Rejecting…" : "Confirm reject"}</Btn>
          </>
        ) : (
          <>
            <Btn kind="ghost" icon={HelpCircle} onClick={doMoreInfo} disabled={busy}>Needs more info</Btn>
            <Btn kind="danger" icon={XCircle} onClick={() => setMode("reject")} disabled={busy}>Reject</Btn>
            <Btn kind="green" icon={CheckCircle2} onClick={() => setMode("accept")} disabled={busy}>Accept…</Btn>
          </>
        )
      ) : null}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <KV k="Client / org" v={req.orgName || "—"} />
          <KV k="Proposed route" v={req.kind ? kindOf(req.kind)?.full : "not proposed — ULM decides"} />
          <KV k="Quantity" v={req.qty ?? "—"} />
          <KV k="Target date" v={fmtDate(req.targetDate)} />
          <KV k="Value" v={inr(req.valueInr)} />
          <KV k="Urgency" v={<Pill color={URGENCY[req.urgency] || "var(--txt2)"}>{req.urgency}</Pill>} />
          {req.summary && <KV k="Summary" v={req.summary} />}
          {req.status !== "submitted" && <KV k="Decision" v={<Pill color={req.status === "accepted" ? "var(--green)" : "var(--red)"}>{req.status}</Pill>} />}
          {req.decisionNote && <KV k="Decision note" v={req.decisionNote} />}
        </div>

        {isAdmin && req.status === "submitted" && (
          <>
            <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>The four questions ULM asks</span>
              {REVIEW_AXES.map((a) => <ScoreRow key={a.k} axis={a} value={scores[a.k]} onChange={(v) => setScores((s) => ({ ...s, [a.k]: v }))} />)}
              <Field label="Review notes"><textarea className="inp" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why is the answer yes, no, or not yet…" /></Field>
            </div>

            {mode === "accept" && (
              <div className="card fade" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--green)" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>Accept — route to a delivery tool</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {KINDS.map((k) => (
                    <button key={k.k} onClick={() => setKind(k.k)} style={chipS(kind === k.k)}>{k.full}</button>
                  ))}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Project name"><input className="inp" value={name} onChange={(e) => setName(e.target.value)} /></Field>
                  <Field label="Deadline"><input className="inp" type="date" value={deadline || ""} onChange={(e) => setDeadline(e.target.value)} /></Field>
                </div>
                <Field label="Project ID" hint="leave blank to auto-generate (Eb- series)"><input className="inp" style={{ fontFamily: MONO }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" /></Field>
                <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.55 }}>
                  Accepting creates the project, sanctions it as <b>{kind ? kindOf(kind)?.label : "…"}</b>, routes it to {kind ? kindOf(kind)?.tool : "its delivery tool"}, and closes this request — one transaction. Team &amp; Drive folder are set up afterwards from the Projects page, or use <b>Create a Project</b> for the full guided flow.
                </div>
              </div>
            )}
          </>
        )}
        {!isAdmin && req.status === "submitted" && (
          <Pill color="var(--amber)"><Shield size={11} /> Deciding needs a superadmin or dept-head profile</Pill>
        )}
        {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{err}</div>}
      </div>
    </Modal>
  );
}

function RaiseRequestModal({ onClose }) {
  const { orgs, submitRequest, toast } = useUlm();
  const [f, setF] = useState({ title: "", summary: "", kind: "", orgId: "", orgName: "", qty: "", targetDate: "", valueInr: "", urgency: "normal" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    if (!f.title.trim()) { setErr("A request needs a title."); return; }
    setBusy(true); setErr("");
    try {
      await submitRequest(f);
      toast("Request raised — it is now in the sanction inbox", "green");
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal title="Raise a request" sub="Ask ULM to create and sanction a project" onClose={onClose} width={640}
      footer={<><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn icon={Send} onClick={submit} disabled={busy || !f.title.trim()}>{busy ? "Raising…" : "Raise request"}</Btn></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Title" req><input className="inp" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Wearable fall-detection pendant — pilot 50 units" /></Field>
        <Field label="Summary"><textarea className="inp" rows={3} value={f.summary} onChange={(e) => set("summary", e.target.value)} placeholder="What is being asked for, and why now" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Client" hint="if already registered">
            <select className="inp" value={f.orgId} onChange={(e) => set("orgId", e.target.value)}>
              <option value="">— new / unknown —</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.clientId})</option>)}
            </select>
          </Field>
          <Field label="New client name" hint="when not registered"><input className="inp" value={f.orgName} onChange={(e) => set("orgName", e.target.value)} disabled={!!f.orgId} placeholder="e.g. CarePulse Health" /></Field>
        </div>
        <Field label="Proposed route" hint="ULM decides finally">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => set("kind", "")} style={chipS(f.kind === "")}>Let ULM decide</button>
            {KINDS.map((k) => <button key={k.k} onClick={() => set("kind", k.k)} style={chipS(f.kind === k.k)}>{k.label}</button>)}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Quantity"><input className="inp" type="number" min="0" value={f.qty} onChange={(e) => set("qty", e.target.value)} /></Field>
          <Field label="Target date"><input className="inp" type="date" value={f.targetDate} onChange={(e) => set("targetDate", e.target.value)} /></Field>
          <Field label="Value (₹)"><input className="inp" type="number" min="0" value={f.valueInr} onChange={(e) => set("valueInr", e.target.value)} /></Field>
        </div>
        <Field label="Urgency">
          <div style={{ display: "flex", gap: 8 }}>
            {["low", "normal", "high"].map((u) => <button key={u} onClick={() => set("urgency", u)} style={chipS(f.urgency === u)}>{u}</button>)}
          </div>
        </Field>
        {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{err}</div>}
      </div>
    </Modal>
  );
}

export default function InboxModule({ onOpenProject }) {
  const { requests, projects, people, isAdmin } = useUlm();
  const [tab, setTab] = useState("pending");
  const [open, setOpen] = useState(null);
  const [raise, setRaise] = useState(false);

  const pending = useMemo(() => requests.filter((r) => r.status === "submitted"), [requests]);
  const decided = useMemo(() => requests.filter((r) => r.status !== "submitted" && r.status !== "draft"), [requests]);
  const awaiting = useMemo(() => projects.filter((p) => p.sanctionState === "requested"), [projects]);
  const list = tab === "pending" ? pending : decided;

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Section>
        <SectionTitle icon={InboxIcon} right={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Seg options={[{ k: "pending", label: `Pending · ${pending.length}` }, { k: "decided", label: `Decided · ${decided.length}` }]} value={tab} onChange={setTab} />
            <Btn small icon={Send} onClick={() => setRaise(true)}>Raise a request</Btn>
          </div>
        }>Requests for project creation &amp; sanction</SectionTitle>

        {!list.length ? (
          <Empty icon={InboxIcon} title={tab === "pending" ? "The inbox is clear" : "Nothing decided yet"}
            sub={tab === "pending" ? "Requests raised here, by Sales, or by any signed-in teammate land in this inbox for ULM to review and sanction." : "Accepted and rejected requests will appear here with their decision trail."} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map((r) => {
              const by = people.find((p) => p.id === r.submittedBy);
              return (
                <div key={r.id} className="card rowHover" onClick={() => setOpen(r)} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 3 }}>{r.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--txt2)", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <span>{r.orgName || "unassigned client"}</span>·<span>{fmtDateTime(r.submittedAt)}</span>
                      {r.qty ? <><span>·</span><span>{r.qty} units</span></> : null}
                      {r.valueInr ? <><span>·</span><span>{inr(r.valueInr)}</span></> : null}
                    </div>
                  </div>
                  {r.kind && <Pill color={kindOf(r.kind)?.c}>{kindOf(r.kind)?.label}</Pill>}
                  {r.urgency === "high" && <Pill color="var(--red)"><AlertTriangle size={11} /> urgent</Pill>}
                  {tab === "decided" && <Pill color={r.status === "accepted" ? "var(--green)" : "var(--red)"}>{r.status}</Pill>}
                  {by && <AvatarDot user={by} size={24} />}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section>
        <SectionTitle icon={Layers}>Projects awaiting sanction · {awaiting.length}</SectionTitle>
        {!awaiting.length ? (
          <Empty icon={CheckCircle2} title="Nothing waiting" sub="A project raised inside a delivery tool (e.g. the ODM app) arrives here as 'requested' until ULM sanctions it." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {awaiting.map((p) => (
              <div key={p.id} className="card rowHover" onClick={() => onOpenProject(p.id)} style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 12.5, color: "var(--acc)" }}>{p.projectId}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--txt2)" }}>{p.clientName || "—"}{p.requestedAt ? ` · raised ${fmtDateTime(p.requestedAt)}` : ""}</div>
                </div>
                {p.kind && <Pill color={kindOf(p.kind)?.c}>{kindOf(p.kind)?.label}</Pill>}
                <Pill color={SANCTION_STATES.requested.c}>{SANCTION_STATES.requested.label}</Pill>
                <Btn small kind="ghost">Review →</Btn>
              </div>
            ))}
          </div>
        )}
      </Section>

      {open && <ReviewModal req={open} onClose={() => setOpen(null)} />}
      {raise && <RaiseRequestModal onClose={() => setRaise(false)} />}
      {!isAdmin && (
        <div style={{ fontSize: 11.5, color: "var(--txt3)", display: "flex", alignItems: "center", gap: 6 }}>
          <Shield size={12} /> You can raise and read requests; sanction decisions need a superadmin or dept-head profile.
        </div>
      )}
    </div>
  );
}
