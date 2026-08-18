/* ─── Clients — the shared client table, and the Drive-side register ─────────
   Requirement #2/#3: create new clients with the historical Client-ID scheme
   (<org-size><industry>-<seq>), stored in core.orgs (the common table) and
   appended to the Client-ID register sheet in Drive.                          */

import { useMemo, useState } from "react";
import { Building2, Plus, Shield, ExternalLink, FileText, Search, Pencil, Check, X } from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, Field, Modal, Empty, SectionTitle, Section, chipS } from "../ui.jsx";
import { MONO, INDUSTRY_CODES, ORG_SIZES } from "../constants.js";
import { driveConfigured, driveRegisterClient, driveUpdateRegister } from "../lib/ulmDrive.js";

function NewClientModal({ onClose }) {
  const { orgs, createClient, toast, people, me } = useUlm();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState(null);
  const [orgSize, setOrgSize] = useState(null);
  const [contact, setContact] = useState({ name: "", designation: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const setC = (k, v) => setContact((x) => ({ ...x, [k]: v }));

  const clientId = industry && orgSize ? `${orgSize.code}${industry.code}-${String(orgs.length + 1).padStart(3, "0")}` : "";
  const dupe = name.trim() && orgs.some((o) => o.name.toLowerCase() === name.trim().toLowerCase());

  const create = async () => {
    setBusy(true); setErr("");
    try {
      await createClient({ clientId, name: name.trim(), industry: industry.label, orgSize: orgSize.label, contact });
      if (driveConfigured) {
        const rc = await driveRegisterClient({ clientId, name: name.trim(), industry: industry.label, industryCode: industry.code, orgSize: orgSize.label, sizeCode: orgSize.code, contact: contact.name, designation: contact.designation, email: contact.email, phone: contact.phone, by: people.find((p) => p.id === me)?.name || "" });
        if (rc.ok) toast(`${clientId} registered in Drive`, "green");
        else toast(`Drive register failed: ${rc.error}`, "amber");
      }
      toast(`Client ${clientId} created`, "green");
      onClose();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <Modal title="New client" sub="Client ID = org-size code + industry code + sequence — same scheme as the ODM tool" onClose={onClose} width={640}
      footer={<><Btn kind="ghost" onClick={onClose} disabled={busy}>Cancel</Btn><Btn icon={Plus} onClick={create} disabled={busy || !name.trim() || !industry || !orgSize || dupe}>{busy ? "Creating…" : `Create ${clientId || "client"}`}</Btn></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Field label="Company name" req>
          <input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Devices" />
        </Field>
        {dupe && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>A client with this name already exists.</div>}
        <Field label="Industry" req>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 150, overflowY: "auto" }}>
            {INDUSTRY_CODES.map((i) => (
              <button key={i.code} style={chipS(industry?.code === i.code)} onClick={() => setIndustry(i)}>{i.label} <span style={{ fontFamily: MONO, opacity: 0.6 }}>{i.code}</span></button>
            ))}
          </div>
        </Field>
        <Field label="Organisation size" req>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {ORG_SIZES.map((o) => (
              <button key={o.code} style={chipS(orgSize?.code === o.code)} onClick={() => setOrgSize(o)}>{o.label} <span style={{ fontFamily: MONO, opacity: 0.6 }}>{o.code}</span></button>
            ))}
          </div>
        </Field>
        {clientId && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>Client ID</span>
            <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 600 }}>{clientId}</span>
            <Pill color={driveConfigured ? "var(--green)" : "var(--amber)"}><FileText size={11} /> {driveConfigured ? "appends to the Drive register" : "Drive register pending"}</Pill>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Contact name"><input className="inp" value={contact.name} onChange={(e) => setC("name", e.target.value)} /></Field>
          <Field label="Designation"><input className="inp" value={contact.designation} onChange={(e) => setC("designation", e.target.value)} /></Field>
          <Field label="Email"><input className="inp" type="email" value={contact.email} onChange={(e) => setC("email", e.target.value)} /></Field>
          <Field label="Phone"><input className="inp" value={contact.phone} onChange={(e) => setC("phone", e.target.value)} /></Field>
        </div>
        {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 600 }}>{err}</div>}
      </div>
    </Modal>
  );
}

export default function ClientsModule() {
  const { orgs, projects, provisioning, isAdmin, renameClient, toast } = useUlm();
  const [q, setQ] = useState("");
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState(null); // clientId being renamed
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  /* One rename, three targets: the database (orgs + every project row), the
     Client-ID sheet, and this client's rows in the CPTS. */
  const saveRename = async (o) => {
    const name = newName.trim();
    if (!name || name === o.name) { setEditing(null); return; }
    setSaving(true);
    try {
      await renameClient(o.clientId, name);
      if (driveConfigured && o.clientId) {
        const rc = await driveUpdateRegister("clients", o.clientId, { "Client Name": name });
        if (!rc.ok) toast(`Client sheet not updated: ${rc.error}`, "amber");
        const mine = projects.filter((p) => p.clientId === o.clientId && p.projectId);
        for (const p of mine) {
          const rp = await driveUpdateRegister("projects", p.projectId, { "Client Name": name });
          if (!rp.ok) toast(`CPTS row ${p.projectId} not updated: ${rp.error}`, "amber");
        }
        toast(`Renamed to “${name}” — database, client sheet and ${mine.length} CPTS row${mine.length === 1 ? "" : "s"}`, "green");
      } else {
        toast(`Renamed to “${name}”`, "green");
      }
      setEditing(null);
    } catch (e) {
      toast(`Rename failed: ${e.message}`, "red");
    }
    setSaving(false);
  };

  const registerUrl = useMemo(() => provisioning.map((p) => p.clientRegisterUrl).find(Boolean) || "", [provisioning]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orgs.filter((o) => !needle || [o.name, o.clientId, o.industry].some((s) => String(s || "").toLowerCase().includes(needle)));
  }, [orgs, q]);

  const projectCount = (o) => projects.filter((p) => p.clientId === o.clientId).length;

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--txt3)" }} />
          <input className="inp" style={{ paddingLeft: 32 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients…" />
        </div>
        {registerUrl && <a href={registerUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--purple)"><FileText size={11} /> Client-ID register <ExternalLink size={10} /></Pill></a>}
        {isAdmin ? <Btn small icon={Plus} onClick={() => setAdd(true)}>New client</Btn> : <Pill color="var(--amber)"><Shield size={11} /> admin-only</Pill>}
      </div>

      {!list.length ? (
        <Empty icon={Building2} title="No clients yet" sub="Create the first client here or through the project wizard — the ID lands in core.orgs and the Drive register." />
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 2fr 1.6fr 1fr 90px", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--bdr)", fontSize: 10.5, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>
            <span>Client ID</span><span>Name</span><span>Industry</span><span>Contact</span><span>Projects</span>
          </div>
          {list.map((o) => {
            const primary = o.contacts?.find((c) => c.isPrimary) || o.contacts?.[0];
            return (
              <div key={o.id} className="rowHover" style={{ display: "grid", gridTemplateColumns: "120px 2fr 1.6fr 1fr 90px", gap: 10, padding: "11px 16px", borderBottom: "1px solid var(--bdr)", alignItems: "center", fontSize: 12.5 }}>
                <span style={{ fontFamily: MONO, fontWeight: 600, color: "var(--acc)" }}>{o.clientId || "—"}</span>
                <div>
                  {editing === o.clientId ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input className="inp" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveRename(o); if (e.key === "Escape") setEditing(null); }} style={{ padding: "5px 9px", fontSize: 12.5 }} />
                      <button title="Save everywhere — DB, client sheet, CPTS" disabled={saving} onClick={() => saveRename(o)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--green)" }}><Check size={15} /></button>
                      <button disabled={saving} onClick={() => setEditing(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--txt3)" }}><X size={15} /></button>
                    </div>
                  ) : (
                    <div style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                      {o.name}
                      {isAdmin && (
                        <button title="Rename — updates the database, the client sheet and this client's CPTS rows" onClick={() => { setEditing(o.clientId); setNewName(o.name); }} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--txt3)", padding: 2 }}><Pencil size={12} /></button>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: 10.5, color: "var(--txt3)" }}>{o.orgSize || ""}</div>
                </div>
                <span style={{ color: "var(--txt2)" }}>{o.industry || "—"}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primary?.name || "—"}</div>
                  {primary?.email && <div style={{ fontSize: 10.5, color: "var(--txt3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primary.email}</div>}
                </div>
                <Pill color={projectCount(o) ? "var(--blue)" : "var(--txt2)"} style={{ justifySelf: "start" }}>{projectCount(o)}</Pill>
              </div>
            );
          })}
        </div>
      )}

      {add && <NewClientModal onClose={() => setAdd(false)} />}
    </div>
  );
}
