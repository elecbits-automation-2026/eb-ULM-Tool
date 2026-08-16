/* ─── Allocation — hand sanctioned projects to their delivery owner ──────────
   Requirement #5: after creation, ULM allocates the project to people — the
   senior PM who takes delivery. Left: sanctioned projects and their owner
   slot (ulm.allocations.owner_id). Right: the roster from core.people (the
   common profile table) with live load.                                       */

import { useMemo, useState } from "react";
import { Users, UserCheck, Shield, Briefcase } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, AvatarDot, Empty, SectionTitle, Section, fmtDate } from "../ui.jsx";
import { MONO, kindOf, SANCTION_STATES } from "../constants.js";

export default function AllocationModule({ onOpenProject }) {
  const { projects, people, allocations, allocateOwner, isAdmin, toast } = useUlm();
  const [busyId, setBusyId] = useState("");
  const [pick, setPick] = useState({});

  const live = useMemo(() => projects.filter((p) => ["sanctioned", "on_hold"].includes(p.sanctionState)), [projects]);
  const allocOf = (p) => allocations.find((a) => a.projectId === p.id && !a.releasedAt);

  /* PM-ish people first in the owner dropdown, everyone allowed */
  const pmish = useMemo(() => {
    const score = (u) => (/sr_pm/.test(u.resourceRole || "") || /senior pm|technical manager/i.test(u.title || "") ? 0 : u.role === "pm" ? 1 : ["superadmin", "dept_head"].includes(u.role) ? 2 : 3);
    return [...people].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  }, [people]);

  const load = useMemo(() => {
    const m = {};
    for (const p of live) {
      for (const t of p.team || []) { m[t.userId] = (m[t.userId] || 0) + 1; }
      const a = allocOf(p);
      if (a?.ownerId && !(p.team || []).some((t) => t.userId === a.ownerId)) m[a.ownerId] = (m[a.ownerId] || 0) + 1;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, allocations]);

  const assign = async (p, ownerId) => {
    setBusyId(p.id);
    try {
      await allocateOwner(p, ownerId, null);
      toast(`${p.projectId} → ${people.find((u) => u.id === ownerId)?.name}`, "green");
    } catch (e) { toast(e.message, "red"); }
    setBusyId("");
  };

  return (
    <div className="fade" style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, alignItems: "start" }}>
      <Section>
        <SectionTitle icon={UserCheck}>Delivery ownership · {live.length} live</SectionTitle>
        {!live.length ? (
          <Empty icon={Briefcase} title="Nothing sanctioned yet" sub="A project gets an owner the moment ULM sanctions it — accept a request or run the wizard." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {live.map((p) => {
              const a = allocOf(p);
              const owner = people.find((u) => u.id === a?.ownerId);
              return (
                <div key={p.id} className="card" style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 180, cursor: "pointer" }} onClick={() => onOpenProject(p.id)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 12.5, color: "var(--acc)" }}>{p.projectId}</span>
                      {p.kind && <Pill color={kindOf(p.kind)?.c} style={{ fontSize: 10 }}>{kindOf(p.kind)?.label}</Pill>}
                      {p.sanctionState === "on_hold" && <Pill color={SANCTION_STATES.on_hold.c} style={{ fontSize: 10 }}>on hold</Pill>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--txt2)", marginTop: 2 }}>{p.name}{p.deadline ? ` · due ${fmtDate(p.deadline)}` : ""}</div>
                  </div>
                  {owner ? (
                    <Pill color="var(--green)"><AvatarDot user={owner} size={16} /> {owner.name}</Pill>
                  ) : (
                    <Pill color="var(--amber)">unallocated</Pill>
                  )}
                  {isAdmin && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <select className="inp" style={{ width: 180 }} value={pick[p.id] || a?.ownerId || ""} onChange={(e) => setPick((x) => ({ ...x, [p.id]: e.target.value }))}>
                        <option value="">— pick owner —</option>
                        {pmish.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.title}</option>)}
                      </select>
                      <Btn small disabled={busyId === p.id || !(pick[p.id] || "") || (pick[p.id] === a?.ownerId)} onClick={() => assign(p, pick[p.id])}>{busyId === p.id ? "…" : "Allocate"}</Btn>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!isAdmin && <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--txt3)", display: "flex", alignItems: "center", gap: 6 }}><Shield size={12} /> Allocation needs a superadmin or dept-head profile.</div>}
      </Section>

      <Section>
        <SectionTitle icon={Users}>Roster &amp; load</SectionTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {people.map((u) => (
            <div key={u.id} className="rowHover" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 9 }}>
              <AvatarDot user={u} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</div>
                <div style={{ fontSize: 10.5, color: "var(--txt2)" }}>{u.title}</div>
              </div>
              <Pill color={(load[u.id] || 0) >= 3 ? "var(--red)" : (load[u.id] || 0) === 2 ? "var(--amber)" : "var(--txt2)"}>{load[u.id] || 0} live</Pill>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 11, color: "var(--txt3)", lineHeight: 1.6 }}>
          Load counts sanctioned / on-hold projects where the person holds a team slot or the delivery-owner seat. The roster is core.people — the same profile table every Elecbits tool reads.
        </div>
      </Section>
    </div>
  );
}
