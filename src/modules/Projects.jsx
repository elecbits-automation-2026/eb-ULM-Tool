/* ─── Projects — the spine, as ULM sees it ───────────────────────────────────
   Every project in every state (ULM's core.tools row sees all six), the
   sanction ledger behind each one, the one-door decide actions, team editing,
   owner allocation, and Drive provisioning with retry.                        */

import { useEffect, useMemo, useState } from "react";
import { Layers, Search, FolderOpen, Link2, ExternalLink, GitBranch, Users, Shield, CheckCircle2, AlertTriangle, RefreshCw, FileText } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, AvatarDot, Field, Seg, Modal, Empty, SectionTitle, Section, KV, chipS, fmtDate, fmtDateTime, daysLeft } from "../ui.jsx";
import { MONO, KINDS, kindOf, SANCTION_STATES, DECIDE_ACTIONS, TEAM_SLOTS, STATUSES } from "../constants.js";
import { driveConfigured, driveRegisterProject, driveProvisionProject } from "../lib/ulmDrive.js";

function DecidePanel({ p, onDone }) {
  const { decide, toast, isAdmin } = useUlm();
  const [action, setAction] = useState(null);
  const [kind, setKind] = useState(p.kind || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const avail = DECIDE_ACTIONS.filter((a) => a.from.includes(p.sanctionState));
  if (!isAdmin) return <Pill color="var(--amber)"><Shield size={11} /> Deciding needs a superadmin or dept-head profile</Pill>;
  if (!avail.length) return null;

  const run = async () => {
    if (action.needsKind && !kind) { setErr("Pick a delivery route."); return; }
    setBusy(true); setErr("");
    try {
      await decide(p, action.k, action.needsKind ? kind : null, reason || null);
      toast(`${action.label} — done`, "green");
      onDone?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>ULM decision — the one door</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {avail.map((a) => (
          <button key={a.k} onClick={() => { setAction(action?.k === a.k ? null : a); setErr(""); }} style={chipS(action?.k === a.k)}>{a.label}</button>
        ))}
      </div>
      {action && (
        <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {action.needsKind && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {KINDS.map((k) => <button key={k.k} onClick={() => setKind(k.k)} style={chipS(kind === k.k)}>{k.full}</button>)}
            </div>
          )}
          <Field label="Reason" hint="lands in the append-only ledger"><input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Why ${action.label.toLowerCase()}?`} /></Field>
          <div><Btn small kind={action.kind === "danger" ? "danger" : action.kind === "green" ? "green" : "primary"} onClick={run} disabled={busy}>{busy ? "Recording…" : `Confirm ${action.label.toLowerCase()}`}</Btn></div>
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{err}</div>}
    </div>
  );
}

function TeamEditor({ p, onClose }) {
  const { people, setTeam, toast } = useUlm();
  const [rows, setRows] = useState(TEAM_SLOTS.map((slot) => ({ slot, userId: p.team?.find((t) => t.slot === slot)?.userId || "" })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await setTeam(p, rows.filter((r) => r.userId));
      toast("Team updated", "green");
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`Team — ${p.projectId}`} sub="Slots mirror the ODM tool; assignments land in core.assignments" onClose={onClose} width={560}
      footer={<><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn onClick={save} disabled={busy}>{busy ? "Saving…" : "Save team"}</Btn></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.slot} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 200 }}>{r.slot}</span>
            <select className="inp" style={{ flex: 1 }} value={r.userId} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, userId: e.target.value } : y)))}>
              <option value="">— unassigned —</option>
              {people.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.title}</option>)}
            </select>
          </div>
        ))}
        {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{err}</div>}
      </div>
    </Modal>
  );
}

export function ProvisioningCard({ p }) {
  const { provisioning, saveProvisioning, isAdmin, toast, people, me } = useUlm();
  const prov = provisioning.find((x) => x.projectId === p.id);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const next = { status: "provisioned" };
    try {
      const rp = await driveRegisterProject({ projectId: p.projectId, name: p.name, clientId: p.clientId, clientName: p.clientName, kind: p.kind, deadline: p.deadline, by: people.find((x) => x.id === me)?.name || "" });
      if (rp.ok) next.projectRegisterUrl = rp.registerUrl; else throw new Error(rp.error);
      const pv = await driveProvisionProject({ projectId: p.projectId });
      if (!pv.ok) throw new Error(pv.error);
      next.folderId = pv.folderId; next.folderUrl = pv.folderUrl;
      next.filesCopied = pv.copied; next.foldersCopied = pv.folders;
      next.processMapUrl = pv.processMap?.sheetUrl || "";
      next.templatesLinked = pv.processMap?.updated ?? null;
      await saveProvisioning(p, next);
      toast(`Drive folder for ${p.projectId} ready`, "green");
    } catch (e) {
      await saveProvisioning(p, { status: "failed", error: e.message }).catch(() => { });
      toast(`Provisioning failed: ${e.message}`, "red");
    }
    setBusy(false);
  };

  const c = prov?.status === "provisioned" ? "var(--green)" : prov?.status === "failed" ? "var(--red)" : "var(--amber)";
  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>Drive provisioning</span>
        <Pill color={c}>{prov?.status || "pending"}</Pill>
      </div>
      {prov?.status === "provisioned" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {prov.folderUrl ? <a href={prov.folderUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--green)"><FolderOpen size={11} /> Project folder <ExternalLink size={10} /></Pill></a> : <Pill color="var(--txt2)"><FolderOpen size={11} /> folder (demo)</Pill>}
            {prov.processMapUrl && <a href={prov.processMapUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--blue)"><Link2 size={11} /> Process map <ExternalLink size={10} /></Pill></a>}
            {prov.projectRegisterUrl && <a href={prov.projectRegisterUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--purple)"><FileText size={11} /> Register <ExternalLink size={10} /></Pill></a>}
          </div>
          <span style={{ fontSize: 11.5, color: "var(--txt2)" }}>
            {prov.filesCopied ?? "—"} files · {prov.foldersCopied ?? "—"} folders copied{prov.templatesLinked != null ? ` · ${prov.templatesLinked} template links in the process map` : ""}{prov.provisionedAt ? ` · ${fmtDateTime(prov.provisionedAt)}` : ""}
          </span>
        </div>
      ) : (
        <span style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.6 }}>
          {prov?.status === "failed"
            ? <><AlertTriangle size={12} style={{ color: "var(--red)", verticalAlign: -2 }} /> {prov.error}</>
            : "Template folder not replicated yet. Provisioning copies the template tree, renames it to the Project ID, and writes template-library links into the process-map sheet."}
        </span>
      )}
      {isAdmin && prov?.status !== "provisioned" && (
        driveConfigured
          ? <div><Btn small icon={busy ? RefreshCw : FolderOpen} onClick={run} disabled={busy}>{busy ? "Provisioning…" : "Provision now"}</Btn></div>
          : <Pill color="var(--amber)"><AlertTriangle size={11} /> Set VITE_ULM_DRIVE_URL to enable</Pill>
      )}
    </div>
  );
}

function Ledger({ p }) {
  const { events, people } = useUlm();
  const rows = events.filter((e) => e.projectId === p.id || (p.projectId && e.projectCode === p.projectId));
  if (!rows.length) return <Empty icon={GitBranch} title="No decisions yet" sub="Every sanction, hold and close lands here, append-only." />;
  return (
    <div className="branchRail" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((e) => {
        const by = people.find((x) => x.id === e.decidedBy);
        const st = SANCTION_STATES[e.toState];
        return (
          <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Pill color={st?.c || "var(--txt2)"}>{e.action}</Pill>
              <span style={{ fontSize: 12, color: "var(--txt2)" }}>{e.fromState} → <b style={{ color: "var(--txt)" }}>{e.toState}</b>{e.kind ? ` · ${kindOf(e.kind)?.label || e.kind}` : ""}</span>
            </div>
            <span style={{ fontSize: 11, color: "var(--txt3)" }}>{fmtDateTime(e.decidedAt)}{by ? ` · ${by.name}` : ""}{e.reason ? ` — ${e.reason}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectDetail({ p, onClose }) {
  const { people, allocations, isAdmin } = useUlm();
  const [teamEdit, setTeamEdit] = useState(false);
  const st = SANCTION_STATES[p.sanctionState] || SANCTION_STATES.draft;
  const alloc = allocations.find((a) => a.projectId === p.id && !a.releasedAt);
  const owner = people.find((x) => x.id === alloc?.ownerId);
  const dl = p.deadline ? daysLeft(p.deadline) : null;

  return (
    <Modal title={<span style={{ fontFamily: MONO }}>{p.projectId}</span>} sub={p.name} onClose={onClose} width={780}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Pill color={st.c}>{st.label}</Pill>
          {p.kind && <Pill color={kindOf(p.kind)?.c}>{kindOf(p.kind)?.label} → {kindOf(p.kind)?.tool}</Pill>}
          {p.deadline && <Pill color={dl < 0 ? "var(--red)" : dl <= 7 ? "var(--amber)" : "var(--txt2)"}>{fmtDate(p.deadline)} · {dl < 0 ? `${-dl}d over` : `${dl}d left`}</Pill>}
          <Pill color={STATUSES.find((s) => s.k === p.status)?.c || "var(--txt2)"}>{p.status}</Pill>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <KV k="Client" v={p.clientName ? `${p.clientName}${p.clientId ? ` · ${p.clientId}` : ""}` : "—"} />
          <KV k="Contact" v={p.contact?.name || "—"} />
          <KV k="Industry" v={p.industry || "—"} />
          <KV k="Org size" v={p.orgSize || "—"} />
          <KV k="Sanctioned" v={p.sanctionedAt ? `${fmtDateTime(p.sanctionedAt)}${people.find((x) => x.id === p.sanctionedBy) ? ` by ${people.find((x) => x.id === p.sanctionedBy).name}` : ""}` : "—"} />
          <KV k="Delivery owner" v={owner ? `${owner.name} — ${owner.title}` : "not allocated"} />
        </div>
        {p.desc && <KV k="Description" v={p.desc} />}

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>Team</span>
          {(p.team || []).length
            ? (p.team || []).map((t) => {
              const u = people.find((x) => x.id === t.userId);
              return <Pill key={t.slot} color="var(--txt2)"><AvatarDot user={u} size={16} /> {u?.name || "?"} · {t.slot.split(" (")[0]}</Pill>;
            })
            : <span style={{ fontSize: 12, color: "var(--txt3)" }}>nobody allocated yet</span>}
          {isAdmin && <Btn small kind="ghost" icon={Users} onClick={() => setTeamEdit(true)}>Edit team</Btn>}
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {p.lldCustomer ? <Pill color="var(--green)"><CheckCircle2 size={11} /> C-LLD · {p.lldCustomer.mode}</Pill> : <Pill color="var(--amber)"><AlertTriangle size={11} /> C-LLD missing</Pill>}
          {p.lldDesigner ? <Pill color="var(--green)"><CheckCircle2 size={11} /> D-LLD · {p.lldDesigner.mode}</Pill> : <Pill color="var(--amber)"><AlertTriangle size={11} /> D-LLD missing</Pill>}
        </div>

        <ProvisioningCard p={p} />
        <DecidePanel p={p} />

        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 10 }}>Sanction ledger</span>
          <Ledger p={p} />
        </div>
      </div>
      {teamEdit && <TeamEditor p={p} onClose={() => setTeamEdit(false)} />}
    </Modal>
  );
}

export default function ProjectsModule({ focusId, onFocusHandled }) {
  const { projects, people, allocations } = useUlm();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [state, setState] = useState("all");
  const [open, setOpen] = useState(null);

  /* deep-link from Inbox / Wizard */
  useEffect(() => {
    if (focusId) {
      const p = projects.find((x) => x.id === focusId);
      if (p) { setOpen(p); onFocusHandled?.(); }
    }
  }, [focusId, projects, onFocusHandled]);

  const list = useMemo(() => projects.filter((p) => {
    if (kind !== "all" && p.kind !== kind) return false;
    if (state !== "all" && p.sanctionState !== state) return false;
    const needle = q.trim().toLowerCase();
    if (needle && ![p.projectId, p.name, p.clientName, p.clientId].some((s) => String(s || "").toLowerCase().includes(needle))) return false;
    return true;
  }), [projects, q, kind, state]);

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--txt3)" }} />
          <input className="inp" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, name, client…" />
        </div>
        <Seg options={[{ k: "all", label: "All" }, ...KINDS.map((k) => ({ k: k.k, label: k.label }))]} value={kind} onChange={setKind} />
        <select className="inp" style={{ width: 190 }} value={state} onChange={(e) => setState(e.target.value)}>
          <option value="all">Every state</option>
          {Object.entries(SANCTION_STATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {!list.length ? (
        <Empty icon={Layers} title="No projects match" sub="Create one through the wizard, or accept a request from the sanction inbox." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((p) => {
            const st = SANCTION_STATES[p.sanctionState] || SANCTION_STATES.draft;
            const dl = p.deadline ? daysLeft(p.deadline) : null;
            const alloc = allocations.find((a) => a.projectId === p.id && !a.releasedAt);
            const owner = people.find((x) => x.id === alloc?.ownerId);
            const isNew = Date.now() - new Date(p.createdAt).getTime() < 7 * 86400000;
            return (
              <div key={p.id} className="card rowHover" onClick={() => setOpen(p)} style={{ padding: "13px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 13, color: "var(--acc)" }}>{p.projectId}</span>
                    {p.idMode === "manual" && <Pill color="var(--txt2)" style={{ fontSize: 10 }}>manual ID</Pill>}
                    {isNew && <Pill color="var(--green)" style={{ fontSize: 10 }}>NEW</Pill>}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--txt2)", marginTop: 2 }}>
                    {p.clientName || "—"}{p.clientId ? ` · ${p.clientId}` : ""}{owner ? ` · Owner: ${owner.name}` : " · unallocated"}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {p.kind && <Pill color={kindOf(p.kind)?.c}>{kindOf(p.kind)?.label}</Pill>}
                  <Pill color={st.c}>{st.label}</Pill>
                  {p.deadline && <Pill color={dl < 0 ? "var(--red)" : dl <= 7 ? "var(--amber)" : "var(--txt2)"}>{dl < 0 ? `${-dl}d over` : `${dl}d left`}</Pill>}
                  <span style={{ display: "inline-flex" }}>
                    {(p.team || []).slice(0, 4).map((t, i) => {
                      const u = people.find((x) => x.id === t.userId);
                      return <span key={t.slot} style={{ marginLeft: i ? -7 : 0 }}><AvatarDot user={u} size={22} /></span>;
                    })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && <ProjectDetail p={projects.find((x) => x.id === open.id) || open} onClose={() => setOpen(null)} />}
    </div>
  );
}
