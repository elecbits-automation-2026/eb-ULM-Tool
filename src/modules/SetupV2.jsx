/* ─── Project Setup — the runbook after the gate ─────────────────────────────
   Eb-SOP_Project-Setup_v2.0, steps 11–31 on Path A and 8–11 on Path B. Once
   a WON deal has been converted, the project exists as one row and one folder
   and nothing else; everything it will ever contain — boards, BOM revisions,
   firmware, enclosures, manufacturing runs — is minted here so that the
   register is written BEFORE the Drive tree, and the folder link is written
   back into the row afterwards. That order is the whole point: a folder with
   no row is an orphan nobody can find, and the SOP treats it as one.

   Path is not a preference, it is a consequence: Path B kinds (MFG, SCS) mean
   Elecbits designed neither the board nor the firmware, so §6.3 forbids
   issuing PCB/FW/ED identifiers for them at all — the client's design lives on
   as deal inputs, and only runs are ours to number. The panels below refuse
   rather than explain after the fact.                                        */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes, ChevronRight, CircuitBoard, Cpu, Box, Layers, Factory, Scale, Link2,
  AlertTriangle, ExternalLink, Plus, RefreshCw, Copy, ClipboardList, Gauge,
  FolderTree, ShieldAlert, Sparkles, Info, GitBranch,
} from "lucide-react";
import { useUlm } from "../data.jsx";
import { Pill, Btn, Field, KV, Empty, Section, SectionTitle, TypingDots, Done, chipS } from "../ui.jsx";
import { MONO, V2_KINDS, kindV2Of, PCB_CLASSES, BUILD_STAGES, MFG_TYPES, ISSUANCE_RULES, MAJOR_MINOR } from "../constants.js";
import {
  v2Configured, v2Secure, v2Allocate, v2List, v2Update,
  v2ProvisionEng, v2ProvisionRun, v2Master, v2Governance,
} from "../lib/ulmV2.js";

/* Only a converted project has this shape; anything else on the picker is a
   pre-v2 code we can still read but never allocate under. */
const P_RE = /^EB-P-\d{2}-\d{4}$/;

/* Every tab this page reads. One round trip each, once, then cached — the
   register is a spreadsheet, not a database, and it is happier that way. */
const TABS = ["Projects", "PCB", "BOM", "FW", "Enclosure", "MFG", "Deal Inputs", "Master"];

/* The repo name is derived, never invented: recording-order step 11. */
const repoFor = (fwId) => "fw-product-" + String(fwId || "").toLowerCase();

/* ulm.id_provisioning.state is CHECK-constrained to exactly these four values;
   anything else is a constraint violation, not a label. Kept as a map so no
   call site can invent a fifth word and have the write silently rejected. */
const PROV = { row: "row_written", folder: "folder_created", linked: "link_written", failed: "failed" };

const orderedQtyOf = (mfgId) => {
  const m = String(mfgId || "").match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : NaN;
};

/* ── small local primitives (same visual language as ui.jsx) ─────────────── */

const Id = ({ v, color = "var(--acc)", size = 12.5 }) => (
  <span style={{ fontFamily: MONO, fontWeight: 600, color, fontSize: size, overflowWrap: "anywhere" }}>{v || "—"}</span>
);

const Note = ({ tone = "amber", icon: Ic = AlertTriangle, children }) => (
  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "9px 11px", borderRadius: 9, border: "1px solid var(--bdr)", background: "var(--s2)", fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.65 }}>
    <Ic size={14} style={{ color: `var(--${tone})`, flexShrink: 0, marginTop: 1 }} />
    <span>{children}</span>
  </div>
);

/* The recording order, drawn so it cannot be misremembered. The second line is
   not decoration: the allocator only ever appends, so every button under this
   strip is one-way — people click faster when they think a mistake is editable. */
const LawStrip = ({ step = 0, note }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 10.5, fontWeight: 700, color: "var(--txt3)", textTransform: "uppercase", letterSpacing: ".05em" }}>
      {["Register row", "Folder", "Link back"].map((s, i) => (
        <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: i < step ? "var(--green)" : i === step ? "var(--acc)" : "var(--txt3)" }}>{i + 1}. {s}</span>
          {i < 2 && <ChevronRight size={11} style={{ opacity: 0.5 }} />}
        </span>
      ))}
      {note && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--txt3)" }}>· {note}</span>}
    </div>
    <div style={{ fontSize: 10.5, color: "var(--txt3)", lineHeight: 1.55 }}>
      An allocated identifier is permanent and is never reused — a mistake is corrected with a new row, never by editing or re-issuing the id.
    </div>
  </div>
);

const Panel = ({ icon: Ic, title, sub, open, onToggle, right, disabled, children }) => (
  <div className="card" style={{ overflow: "hidden", opacity: disabled ? 0.62 : 1 }}>
    <div onClick={() => !disabled && onToggle()} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", cursor: disabled ? "not-allowed" : "pointer", userSelect: "none" }}>
      <ChevronRight size={15} style={{ color: "var(--txt3)", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", flexShrink: 0 }} />
      {Ic && <Ic size={15} style={{ color: "var(--acc)", flexShrink: 0 }} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--txt2)", marginTop: 2, lineHeight: 1.5 }}>{sub}</div>}
      </div>
      {right}
    </div>
    {open && !disabled && <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>}
  </div>
);

const Rows = ({ cols, items, empty }) => (
  <div style={{ border: "1px solid var(--bdr)", borderRadius: 10, overflow: "hidden" }}>
    <div style={{ display: "grid", gridTemplateColumns: cols.map((c) => c.w).join(" "), gap: 10, padding: "8px 12px", background: "var(--s2)", fontSize: 10, fontWeight: 700, color: "var(--txt2)", textTransform: "uppercase", letterSpacing: ".06em" }}>
      {cols.map((c) => <span key={c.k}>{c.k}</span>)}
    </div>
    {items.length ? items.map((it, i) => (
      <div key={i} className="rowHover" style={{ display: "grid", gridTemplateColumns: cols.map((c) => c.w).join(" "), gap: 10, padding: "9px 12px", borderTop: "1px solid var(--bdr)", alignItems: "center", fontSize: 12 }}>
        {it}
      </div>
    )) : <div style={{ padding: "14px 12px", borderTop: "1px solid var(--bdr)", fontSize: 12, color: "var(--txt3)" }}>{empty}</div>}
  </div>
);

const FolderLink = ({ url }) => (url
  ? <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--green)"><FolderTree size={11} /> folder <ExternalLink size={10} /></Pill></a>
  : <Pill color="var(--amber)"><Link2 size={11} /> link debt</Pill>);

/* ── the module ───────────────────────────────────────────────────────────── */

export default function SetupV2Module({ focusProjectId }) {
  const { projects, people, me, toast, live, v2RecordProvisioning, v2Roles } = useUlm();
  const by = useMemo(() => people.find((p) => p.id === me)?.name || "portal", [people, me]);

  /* Every write on this page is role-checked server-side, so ask once what the
     signed-in person actually holds. undefined = still reading, null = the role
     table could not be read (unknown, not "holds nothing" — v2Roles returns the
     full list for admins and null on failure), array = the answer. */
  const [roles, setRoles] = useState(undefined);
  useEffect(() => {
    let dead = false;
    (async () => {
      try { const r = await v2Roles(); if (!dead) setRoles(r ?? null); }
      catch { if (!dead) setRoles(null); }
    })();
    return () => { dead = true; };
  }, [v2Roles]);
  const rolesUnknown = roles === null;
  /* Unknown is permissive on purpose: refusing on a read failure would lock a
     real registrar out of their own runbook. The proxy still checks. */
  const isRegistrar = roles == null ? true : roles.includes("registrar");

  const [reg, setReg] = useState(null);          // { tab: {headers, rows} }
  const [regUrl, setRegUrl] = useState("");
  const [regErr, setRegErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [pid, setPid] = useState("");
  const [kindOverride, setKindOverride] = useState("");
  const [open, setOpen] = useState({ debt: true, board: false, attach: false, fw: false, ed: false, bom: false, mfg: false, rules: false, master: false });
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  /* progress + busy, one key per action so two panels never fight */
  const [busy, setBusy] = useState("");
  const [prog, setProg] = useState("");

  const load = useCallback(async () => {
    if (!v2Configured) return;
    setLoading(true); setRegErr("");
    try {
      const res = await Promise.all(TABS.map((t) => v2List(t)));
      const out = {}; let firstErr = "";
      TABS.forEach((t, i) => {
        const r = res[i];
        if (r?.ok) out[t] = { headers: r.headers || [], rows: r.rows || [] };
        else if (!firstErr) firstErr = `${t}: ${r?.error || "unreadable"}`;
      });
      setReg(out);
      setRegUrl(res.find((r) => r?.registerUrl)?.registerUrl || "");
      setRegErr(firstErr);
    } catch (e) {
      setRegErr(e?.message || String(e));
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* header-keyed rows, so column order in the sheet can drift without us */
  const rowsOf = useCallback((tab) => {
    const t = reg?.[tab];
    if (!t) return [];
    return t.rows.map((r) => {
      const o = {};
      t.headers.forEach((h, i) => { o[String(h).trim()] = String(r[i] ?? "").trim(); });
      return o;
    }).filter((o) => Object.values(o).some(Boolean));
  }, [reg]);

  /* ── the picker ────────────────────────────────────────────────────────── */
  const options = useMemo(() => {
    const seen = new Set();
    const list = [];
    (projects || []).forEach((p) => {
      if (!p.projectId || seen.has(p.projectId.toUpperCase())) return;
      seen.add(p.projectId.toUpperCase());
      list.push({ id: p.projectId, name: p.name || p.projectId, kind: p.kindV2 || "", client: p.clientName || p.clientId || "", src: "db" });
    });
    rowsOf("Projects").forEach((r) => {
      const id = r["Project ID"];
      if (!id || seen.has(id.toUpperCase())) return;
      seen.add(id.toUpperCase());
      list.push({ id, name: r["Project Name"] || id, kind: r.Kind || "", client: r["Client ID"] || "", src: "register" });
    });
    return list.sort((a, b) => (P_RE.test(b.id) ? 1 : 0) - (P_RE.test(a.id) ? 1 : 0) || b.id.localeCompare(a.id));
  }, [projects, rowsOf]);

  useEffect(() => {
    if (pid) return;
    const wanted = focusProjectId && (projects || []).find((p) => p.id === focusProjectId || p.projectId === focusProjectId);
    const first = wanted?.projectId || (focusProjectId && options.some((o) => o.id === focusProjectId) ? focusProjectId : "") || options.find((o) => P_RE.test(o.id))?.id || "";
    if (first) setPid(first);
  }, [focusProjectId, options, projects, pid]);

  /* ── this project's world ──────────────────────────────────────────────── */
  const projRow = useMemo(() => rowsOf("Projects").find((r) => r["Project ID"]?.toUpperCase() === pid.toUpperCase()) || null, [rowsOf, pid]);
  const opt = options.find((o) => o.id === pid) || null;
  /* The register is the only thing that can settle the path. The chips below
     shape what this page *explains* while the Kind column is being fixed; they
     deliberately do not unlock issuing, because guessing Path A for what may be
     an MFG/SCS project is exactly the mistake §6.3 exists to prevent. */
  const registerKindKey = projRow?.Kind || opt?.kind || "";
  const pathKnown = !!kindV2Of(registerKindKey);
  const kindKey = kindOverride || registerKindKey;
  const kind = kindV2Of(kindKey);
  const pathB = kind?.path === "B";
  const clientId = projRow?.["Client ID"] || "";
  const dealId = projRow?.["Source Deal ID"] || "";
  /* allocatable = this project can parent identifiers at all. canIssue adds the
     person: both must hold before any button that writes is offered. */
  const allocatable = v2Configured && P_RE.test(pid) && pathKnown;
  const canIssue = allocatable && isRegistrar;
  const whyNot = !v2Configured
    ? "The v2 registrar is not configured in this deployment."
    : !P_RE.test(pid)
      ? "Only EB-P-YY-nnnn projects can parent v2 identifiers (Law 6)."
      : !pathKnown
        ? "The Kind column is empty in the register, so the path is unknown — fill it in the register before any identifier is issued (§6.3)."
        : !isRegistrar
          ? "You do not hold the registrar role, so the proxy would refuse this write."
          : "";
  /* Provisioning a folder and recording a delivered quantity are writes too,
     but they issue nothing — they are gated on the role alone, never on the
     path, so a missing Kind column cannot strand an existing row's folder. */
  const roleWhyNot = isRegistrar ? "" : "You do not hold the registrar role, so the proxy would refuse this write.";

  const boards = useMemo(() => rowsOf("PCB").filter((r) => r["Project ID"]?.toUpperCase() === pid.toUpperCase()), [rowsOf, pid]);
  const masterRows = useMemo(() => rowsOf("Master").filter((r) => r["Project ID"]?.toUpperCase() === pid.toUpperCase()), [rowsOf, pid]);
  /* Rule 7.0 boards live only in the Master row — they were never re-minted. */
  const attached = useMemo(() => {
    /* A register is a spreadsheet: a column can be absent and a cell can be
       blank, and an unguarded .toUpperCase() here white-screens the page. */
    const own = new Set(boards.map((b) => String(b["PCB ID"] || "").toUpperCase()));
    const all = rowsOf("PCB");
    return [...new Set(masterRows.map((m) => m["PCB ID"]).filter((x) => x && !own.has(x.toUpperCase())))]
      .map((id) => all.find((b) => String(b["PCB ID"] || "").toUpperCase() === id.toUpperCase()) || { "PCB ID": id, "Name / Alias": "(not on the PCB tab)" });
  }, [boards, masterRows, rowsOf]);
  const allBoardIds = useMemo(() => [...boards, ...attached].map((b) => b["PCB ID"]).filter(Boolean), [boards, attached]);
  const boms = useMemo(() => {
    const mine = new Set(allBoardIds.map((x) => x.toUpperCase()));
    return rowsOf("BOM").filter((r) => mine.has(r["PCB ID"]?.toUpperCase()));
  }, [rowsOf, allBoardIds]);
  const fws = useMemo(() => rowsOf("FW").filter((r) => r["Project ID"]?.toUpperCase() === pid.toUpperCase()), [rowsOf, pid]);
  const eds = useMemo(() => rowsOf("Enclosure").filter((r) => r["Project ID"]?.toUpperCase() === pid.toUpperCase()), [rowsOf, pid]);
  const mfgs = useMemo(() => rowsOf("MFG").filter((r) => (r["Project ID"]?.toUpperCase() === pid.toUpperCase()) || r["MFG ID"]?.toUpperCase().startsWith(pid.toUpperCase() + "-MFG-")), [rowsOf, pid]);
  const dealInputs = useMemo(() => (dealId ? rowsOf("Deal Inputs").filter((r) => r["Deal ID"]?.toUpperCase() === dealId.toUpperCase()) : []), [rowsOf, dealId]);
  const inputBoards = useMemo(() => dealInputs.filter((r) => (r.Type || "").toUpperCase() === "PCB").map((r) => r["Input ID"]).filter(Boolean), [dealInputs]);

  /* Link debt: a row whose family owns a folder but has no link back. */
  const debt = useMemo(() => {
    const out = [];
    if (projRow && !projRow["Drive Folder Link"]) out.push({ fam: "Project", id: pid, why: "the project tree was never provisioned" });
    boards.forEach((b) => { if (!b["Drive Folder Link"]) out.push({ fam: "PCB", id: b["PCB ID"], why: "board folder missing" }); });
    fws.forEach((f) => { if (!f["Drive Folder Link"]) out.push({ fam: "FW", id: f["FW ID"], why: "firmware folder missing" }); });
    eds.forEach((e) => { if (!e["Drive Folder Link"]) out.push({ fam: "ED", id: e["Enclosure ID"], why: "enclosure folder missing" }); });
    mfgs.forEach((m) => { if (!m["Run Folder Link"]) out.push({ fam: "MFG", id: m["MFG ID"], why: "run folder missing" }); });
    return out;
  }, [projRow, pid, boards, fws, eds, mfgs]);

  /* ── shared plumbing for every write ───────────────────────────────────── */
  const record = useCallback(async (identifier, family, state, extra) => {
    try { await v2RecordProvisioning(identifier, family, state, extra || {}); }
    catch (e) {
      /* The workflow DB is a mirror; a failure here never invalidates the
         register row. But swallowing the reason is how a CHECK violation
         stayed invisible — so always log it, and toast anything that is not
         the expected demo-mode refusal. */
      const msg = e?.message || String(e);
      console.warn(`record_id_provisioning(${identifier}, ${family}, ${state}) failed: ${msg}`);
      if (live && !/demo mode/i.test(msg)) {
        toast(`${identifier} is in the register; the workflow database refused the “${state}” record: ${msg}`, "amber");
      }
    }
  }, [v2RecordProvisioning, toast, live]);

  const provision = useCallback(async (family, id) => {
    setProg(`copying the ${family} blueprint…`);
    const p = await v2ProvisionEng({ family, id }, (r) => setProg(`copying… ${r.copied} files, ${r.folders} folders`));
    setProg("");
    if (p.ok) {
      toast(`${id} folder ready — ${p.copied} files, ${p.folders} folders`, "green");
      await record(id, family, PROV.linked, { folderUrl: p.folderUrl });
    } else {
      toast(`${id} has its register row; the folder failed: ${p.error}`, "amber");
      await record(id, family, PROV.failed, { error: p.error });
    }
    return p;
  }, [toast, record]);

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`, "green"); }
    catch { toast("Clipboard refused — select the text and copy it by hand", "amber"); }
  };

  /* ── panel 2: add a board ──────────────────────────────────────────────── */
  const [bF, setBF] = useState({ name: "", platform: "", cls: PCB_CLASSES[0], silk: "", legacy: "" });
  const [lastBoard, setLastBoard] = useState(null);

  const addBoard = async () => {
    setBusy("board");
    try {
      const a = await v2Allocate({ family: "PCB", by, fields: {
        "Project ID": pid, "Name / Alias": bF.name.trim(), "Platform": bF.platform.trim(),
        "Class": bF.cls, "Silkscreen Marking": bF.silk.trim(), "Legacy SKU Code": bF.legacy.trim(),
      } });
      if (!a.ok) throw new Error(a.error);
      toast(`${a.id} allocated on the PCB tab`, "green");
      await record(a.id, "PCB", PROV.row, {});

      /* BOM-001 is not a choice — the as-designed revision exists the moment
         the board does, or the board's cost has nowhere to live. `parent` only
         supplies the id stem; the backend fills cells from `fields`, so the
         PCB ID has to be named there too or the row lands with an empty
         board column and the per-board revision list silently breaks. */
      const b = await v2Allocate({ family: "BOM", parent: a.id, by, fields: { "PCB ID": a.id, "Revision Reason": "As designed" } });
      if (b.ok) toast(`${b.id} — the as-designed revision`, "green");
      else toast(`${a.id} exists but BOM-001 failed: ${b.error} — allocate it from BOM revisions`, "amber");

      const p = await provision("PCB", a.id);
      setLastBoard({ id: a.id, bom: b.ok ? b.id : "", folderUrl: p.ok ? p.folderUrl : "", ...bF });
      setBF({ name: "", platform: "", cls: PCB_CLASSES[0], silk: "", legacy: "" });
      await load();
    } catch (e) {
      toast(`Board not added: ${e.message}`, "red");
    }
    setBusy(""); setProg("");
  };

  const skuRow = lastBoard ? [lastBoard.id, pid, lastBoard.name, lastBoard.platform, lastBoard.cls, lastBoard.silk, lastBoard.legacy, lastBoard.folderUrl].join("\t") : "";

  /* ── panel 3: attach an existing board (rule 7.0) ──────────────────────── */
  const [attachId, setAttachId] = useState("");
  const attachBoard = async () => {
    setBusy("attach");
    try {
      const src = rowsOf("PCB").find((r) => r["PCB ID"] === attachId);
      const m = await v2Master({
        "Client ID": clientId, "Deal ID": dealId, "Project ID": pid, "PCB ID": attachId,
        "BOM ID": "", "FW ID": "", "Enclosure ID": "", "MFG ID": "",
        "Client Name (auto)": opt?.client || "", "Project Name (auto)": projRow?.["Project Name"] || opt?.name || "",
        "Rule": "7.0", "Notes": `Board reused unchanged from ${src?.["Project ID"] || "another project"} — no new PCB ID (rule 7.0). Firmware identity pending.`,
      });
      if (!m.ok) throw new Error(m.error);
      toast(`${attachId} recorded against ${pid} — no new board id minted`, "green");
      setFwF((f) => ({ ...f, pcb: attachId }));
      setOpen((o) => ({ ...o, fw: true }));
      setAttachId("");
      await load();
    } catch (e) {
      toast(`Could not attach the board: ${e.message}`, "red");
    }
    setBusy("");
  };

  /* ── panel 4: firmware ─────────────────────────────────────────────────── */
  const [fwF, setFwF] = useState({ pcb: "", platform: "" });
  const [lastFw, setLastFw] = useState(null);
  const [fwTicks, setFwTicks] = useState({});

  const addFirmware = async () => {
    setBusy("fw");
    try {
      const a = await v2Allocate({ family: "FW", by, fields: { "PCB ID": fwF.pcb, "Project ID": pid, "Platform": fwF.platform.trim() } });
      if (!a.ok) throw new Error(a.error);
      toast(`${a.id} allocated on the FW tab`, "green");
      await record(a.id, "FW", PROV.row, {});

      /* The repo name is derived from the id we have just been given, so it
         can only be written back a beat later. */
      const repo = repoFor(a.id);
      const u = await v2Update("FW", a.id, { "Repo": repo });
      if (!u.ok) toast(`Repo column not written: ${u.error}`, "amber");
      else if (u.refused?.length) toast(`Register refused: ${u.refused.join(", ")}`, "amber");

      const p = await provision("FW", a.id);
      setLastFw({ id: a.id, repo, pcb: fwF.pcb, folderUrl: p.ok ? p.folderUrl : "" });
      setFwTicks({});
      setFwF({ pcb: "", platform: "" });
      await load();
    } catch (e) {
      toast(`Firmware not added: ${e.message}`, "red");
    }
    setBusy(""); setProg("");
  };

  /* ── panel 5: enclosure ────────────────────────────────────────────────── */
  const [edF, setEdF] = useState({ name: "", material: "" });
  const addEnclosure = async () => {
    setBusy("ed");
    try {
      const a = await v2Allocate({ family: "ED", by, fields: { "Project ID": pid, "Name": edF.name.trim(), "Material": edF.material.trim() } });
      if (!a.ok) throw new Error(a.error);
      toast(`${a.id} allocated on the Enclosure tab`, "green");
      await record(a.id, "ED", PROV.row, {});
      await provision("ED", a.id);
      setEdF({ name: "", material: "" });
      await load();
    } catch (e) {
      toast(`Enclosure not added: ${e.message}`, "red");
    }
    setBusy(""); setProg("");
  };

  /* ── panel 6: BOM revisions ────────────────────────────────────────────── */
  const [bomF, setBomF] = useState({ pcb: "", reason: "" });
  const addBom = async () => {
    setBusy("bom");
    try {
      /* `parent` is the id stem only — the backend writes cells from `fields`,
         so the board has to be named there or the revision is orphaned. */
      const a = await v2Allocate({ family: "BOM", parent: bomF.pcb, by, fields: { "PCB ID": bomF.pcb, "Revision Reason": bomF.reason.trim() } });
      if (!a.ok) throw new Error(a.error);
      toast(`${a.id} — ${bomF.reason.trim()}`, "green");
      setBomF({ pcb: "", reason: "" });
      await load();
    } catch (e) {
      toast(`BOM revision not created: ${e.message}`, "red");
    }
    setBusy("");
  };

  /* ── panel 7: manufacturing runs ───────────────────────────────────────── */
  const runBoardPool = pathB ? inputBoards : allBoardIds;
  const [mF, setMF] = useState({ stage: BUILD_STAGES[0], type: MFG_TYPES[0], qty: "", boards: [], parent: "" });
  const toggleRunBoard = (id) => setMF((f) => {
    const on = f.boards.includes(id);
    const boards = on ? f.boards.filter((x) => x !== id) : [...f.boards, id];
    return { ...f, boards, parent: on && f.parent === id ? "" : f.parent };
  });
  const qtyN = parseInt(mF.qty, 10);
  const runProblem = !(qtyN > 0) ? "The ordered quantity must be a positive whole number — it is frozen into the identifier (Law 8)."
    : !mF.boards.length ? "A run needs at least one board."
    : !mF.parent ? "Law 9: exactly one PARENT board per run — say which board this run is for; the rest ride along."
    : "";

  /* One click mints an identifier that carries the ordered quantity forever —
     Law 8 forbids correcting it, so a typo here is uncorrectable. The button
     arms first and allocates second, echoing the number back. The armed value
     is the exact run being confirmed, so changing anything disarms it. */
  const [armedRun, setArmedRun] = useState("");
  const runSig = `${qtyN}|${mF.parent}|${mF.boards.join(",")}|${mF.stage}|${mF.type}`;
  const runArmed = !runProblem && armedRun === runSig;

  const addRun = async () => {
    setBusy("mfg");
    try {
      const a = await v2Allocate({ family: "MFG", parent: pid, qty: qtyN, by, fields: { "Project ID": pid, "Ordered Qty": qtyN } });
      if (!a.ok) throw new Error(a.error);
      toast(`${a.id} — ${qtyN} units, frozen in the id`, "green");
      await record(a.id, "MFG", PROV.row, {});

      const u = await v2Update("MFG", a.id, {
        "Boards in this run": mF.boards.join(", "), "PARENT board": mF.parent,
        "Build Stage": mF.stage, "Type": mF.type,
      });
      if (!u.ok) toast(`Run columns not written: ${u.error}`, "amber");
      else if (u.refused?.length) toast(`Register refused: ${u.refused.join(", ")}`, "amber");

      setProg("building the run folder…");
      const p = await v2ProvisionRun({ mfgId: a.id });
      setProg("");
      if (p.ok) { toast(`Run folder ready — ${p.boards} board sub-folder${p.boards === 1 ? "" : "s"}`, "green"); await record(a.id, "MFG", PROV.linked, { folderUrl: p.folderUrl }); }
      else { toast(`${a.id} is in the register; the run folder failed: ${p.error}`, "amber"); await record(a.id, "MFG", PROV.failed, { error: p.error }); }

      setArmedRun("");
      setMF({ stage: BUILD_STAGES[0], type: MFG_TYPES[0], qty: "", boards: [], parent: "" });
      await load();
    } catch (e) {
      toast(`Run not created: ${e.message}`, "red");
    }
    setBusy(""); setProg("");
  };

  /* Delivered is a column, never a correction to the id — a short ship is
     confirmed on screen so nobody "fixes" the identifier instead. */
  const [deliver, setDeliver] = useState({});
  const setDel = (id, v) => setDeliver((d) => ({ ...d, [id]: { ...(d[id] || {}), ...v } }));
  const saveDelivered = async (m, confirmed) => {
    const id = m["MFG ID"];
    const n = parseInt(deliver[id]?.qty, 10);
    const ordered = orderedQtyOf(id);
    if (!(n >= 0)) { toast("Delivered quantity must be a whole number", "amber"); return; }
    if (n !== ordered && !confirmed) { setDel(id, { asked: true }); return; }
    setBusy("del-" + id);
    try {
      const u = await v2Update("MFG", id, { "Delivered Qty": n, ...(n !== ordered ? { "Notes": `Short/over ship confirmed by ${by}: ${n} of ${ordered} ordered. The identifier keeps the ORDERED quantity (Law 8).` } : {}) });
      if (!u.ok) throw new Error(u.error);
      toast(n === ordered ? `${id} delivered in full` : `${id} recorded at ${n} of ${ordered} — the id is unchanged`, n === ordered ? "green" : "amber");
      setDeliver((d) => ({ ...d, [id]: undefined }));
      await load();
    } catch (e) {
      toast(`Delivered quantity not written: ${e.message}`, "red");
    }
    setBusy("");
  };

  /* ── panel 8: the rules helper ─────────────────────────────────────────── */
  const [rule, setRule] = useState(null);
  const [majors, setMajors] = useState([]);
  const [minors, setMinors] = useState([]);
  const isPcbChange = rule && ["5.0", "6.0"].includes(rule.rule);
  const verdict = !isPcbChange ? null
    : majors.length >= 2 ? { call: "MAJOR", gives: "a NEW Project (rule 6.0)", c: "var(--red)", why: `${majors.length} MAJOR indicators — two or more means a new project` }
      : majors.length === 1 ? { call: "MAJOR (borderline)", gives: "a NEW Project (rule 6.0)", c: "var(--amber)", why: "one MAJOR indicator is genuinely borderline, and the SOP counts borderline as MAJOR" }
        : { call: "MINOR", gives: "PCB + BOM + FW inside this project (rule 5.0)", c: "var(--green)", why: "no MAJOR indicator — the product does what it always did" };
  const govLine = !rule ? "" : isPcbChange
    ? `Rule ${verdict.call === "MINOR" ? "5.0" : "6.0"} — PCB change judged ${verdict.call}. Indicators: ${majors.length ? majors.join("; ") : "none major"}${minors.length ? ` / minor: ${minors.join("; ")}` : ""}. Decision: ${verdict.gives}.`
    : `Rule ${rule.rule} — ${rule.what}. Decision: issue ${rule.gives}.`;

  const writeGovernance = async () => {
    setBusy("gov");
    try {
      const g = await v2Governance(pid, govLine, by);
      if (!g.ok) throw new Error(g.error);
      toast("Decision written to 00-Governance", "green");
    } catch (e) {
      toast(`Governance line not written: ${e.message}`, "red");
    }
    setBusy("");
  };

  /* ── panel 9: Master mapping ───────────────────────────────────────────── */
  const [mm, setMm] = useState({ pcb: "", bom: "", fw: "", ed: "", mfg: "", rule: "", notes: "" });
  const writeMaster = async () => {
    setBusy("master");
    try {
      const r = await v2Master({
        "Client ID": clientId, "Deal ID": dealId, "Project ID": pid,
        "PCB ID": mm.pcb, "BOM ID": mm.bom, "FW ID": mm.fw, "Enclosure ID": mm.ed, "MFG ID": mm.mfg,
        "Client Name (auto)": opt?.client || "", "Project Name (auto)": projRow?.["Project Name"] || opt?.name || "",
        "Rule": mm.rule, "Notes": mm.notes.trim(),
      });
      if (!r.ok) throw new Error(r.error);
      toast(`Master row ${r.row} written — this combination is now joinable`, "green");
      setMm({ pcb: "", bom: "", fw: "", ed: "", mfg: "", rule: "", notes: "" });
      await load();
    } catch (e) {
      toast(`Master row not written: ${e.message}`, "red");
    }
    setBusy("");
  };

  /* ── render ────────────────────────────────────────────────────────────── */
  /* Path A panels are closed in two cases now: Path B (the client's design) and
     an unknown path (the register never said). The second used to fall through
     to Path A, which is how an MFG project could be handed PCB identifiers. */
  const pathALocked = pathB || !pathKnown;
  const unknownSub = "The register's Kind column is empty, so the path is unknown — this panel refuses rather than guess Path A (§6.3).";

  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <select className="inp" style={{ maxWidth: 460, flex: 1, minWidth: 240 }} value={pid} onChange={(e) => { setPid(e.target.value); setKindOverride(""); }}>
        <option value="">Pick a project…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.id} · {o.name}{o.kind ? ` · ${o.kind}` : ""}{P_RE.test(o.id) ? "" : "  (pre-v2 id)"}</option>
        ))}
      </select>
      {regUrl && <a href={regUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}><Pill color="var(--purple)"><Boxes size={11} /> the register <ExternalLink size={10} /></Pill></a>}
      <Pill color={v2Secure ? "var(--green)" : v2Configured ? "var(--amber)" : "var(--red)"}>
        {v2Secure ? "role-checked proxy" : v2Configured ? "direct Drive transport" : "registrar offline"}
      </Pill>
      <Btn small kind="ghost" icon={RefreshCw} onClick={load} disabled={loading || !v2Configured}>{loading ? "Reading…" : "Re-read"}</Btn>
    </div>
  );

  if (!v2Configured) {
    return (
      <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {head}
        <Section>
          <SectionTitle icon={ShieldAlert}>The v2 registrar is not configured</SectionTitle>
          <Note>
            Neither <b>VITE_ULM_PROXY_URL</b> nor <b>VITE_ULM_DRIVE_URL</b> is set, so nothing on this page can allocate an
            identifier or copy a blueprint. The runbook still reads correctly — this page is deliberately inert rather than
            pretending: an identifier that exists only in a browser is exactly the failure the SOP was written against.
          </Note>
        </Section>
      </div>
    );
  }

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {head}

      {regErr && <Note tone="amber">The register did not answer for every tab — <b>{regErr}</b>. What loaded is shown below; allocation may still work, but check the register before trusting a count.</Note>}
      {loading && !reg && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 20, fontSize: 12.5, color: "var(--txt2)" }}><TypingDots /> reading the register…</div>}

      {!pid ? (
        <Empty icon={Boxes} title="Pick a project to set up" sub="This is the runbook after the sanction gate: boards, BOM revisions, firmware, enclosures and manufacturing runs, each written to the register before its folder exists." />
      ) : !P_RE.test(pid) ? (
        <Section>
          <SectionTitle icon={AlertTriangle}>{pid} is a pre-v2 identifier</SectionTitle>
          <Note>
            Only <b>EB-P-YY-nnnn</b> projects can parent v2 identifiers — the allocator checks the parent has a row on the
            Projects tab (Law 6). Convert the deal in the conversion page to mint a v2 Project ID; this project's legacy tree
            stays where it is.
          </Note>
        </Section>
      ) : (
        <>
          {/* 1 — the path banner */}
          <Section style={{ borderColor: pathB ? "var(--coral)" : "var(--bdr)" }}>
            <SectionTitle icon={pathKnown ? (pathB ? Factory : CircuitBoard) : AlertTriangle} right={
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                {kind && <Pill color={!pathKnown ? "var(--amber)" : pathB ? "var(--coral)" : "var(--blue)"}>Path {kind.path}{pathKnown ? "" : " — preview only"}</Pill>}
                <FolderLink url={projRow?.["Drive Folder Link"]} />
              </div>
            }>
              {pid} · {projRow?.["Project Name"] || opt?.name || "—"}
            </SectionTitle>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 8, marginBottom: 10 }}>
              <KV k="Client" v={clientId || opt?.client || "—"} mono />
              <KV k="Source deal" v={dealId || "—"} mono />
              <KV k="Kind" v={kind ? `${kindKey} — ${kind.label} (${kind.hint})` : kindKey || "not recorded"} />
              <KV k="Project manager" v={projRow?.["Project Manager"] || "—"} />
            </div>

            {!pathKnown ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Note tone="red" icon={ShieldAlert}>
                  <b>The register's Kind column is empty for this project, so nothing can be issued here.</b> Without a kind the
                  path cannot be derived, and defaulting to Path A would let this page mint PCB / BOM / FW / ED identifiers for
                  what may be an <b>MFG or SCS</b> project — precisely what SOP §6.3 forbids. <b>Fill the Kind column in the
                  register</b> (then re-read) and every panel below unlocks itself. The chips are a reading aid only: they shape
                  what this page explains, they are written nowhere, and they do <b>not</b> unlock allocation.
                </Note>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {V2_KINDS.map((k) => <button key={k.k} style={chipS(kindOverride === k.k)} onClick={() => setKindOverride(k.k)}>{k.k} · Path {k.path}</button>)}
                </div>
              </div>
            ) : pathB ? (
              <Note tone="coral" icon={Info}>
                <b>Path B — no PCB/FW/ED identifiers: Elecbits designed neither</b> (SOP §6.3). The client owns this design;
                it entered as <b>deal inputs</b> under {dealId || "the source deal"} and keeps their version numbers. What is
                ours to number here is the <b>manufacturing run</b>, and the <b>Master row</b> that joins it back to the deal.
              </Note>
            ) : (
              <Note tone="blue" icon={Info}>
                <b>Path A — Elecbits designs it.</b> Families in play: <b>PCB</b> (each board), <b>BOM</b> (one per revision,
                BOM-001 as designed), <b>FW</b> (one firmware identity per board per project), <b>ED</b> (enclosure) and
                <b> MFG</b> (each run). Every one of them is a register row first and a folder second.
              </Note>
            )}

            {/* Said once, here, rather than as a surprise after every click:
                allocation is role-checked in the proxy, so a PM without the
                registrar role would only ever collect refusals. */}
            {!isRegistrar ? (
              <div style={{ marginTop: 8 }}>
                <Note tone="amber" icon={ShieldAlert}>
                  <b>You do not hold the registrar role.</b> Every allocate, Master and governance button on this page is a
                  server-checked write, so the proxy would refuse them — they are disabled here rather than left to fail after
                  the click. Ask a registrar to issue these identifiers, or have the role granted to you.
                </Note>
              </div>
            ) : rolesUnknown ? (
              <div style={{ marginTop: 8 }}>
                <Note tone="amber" icon={ShieldAlert}>
                  <b>Your roles could not be read</b>, so nothing is disabled on that account — unknown is not the same as
                  "holds nothing". Issuing is still checked against the <b>registrar</b> role server-side, so a button that
                  looks available here may still be refused by the proxy.
                </Note>
              </div>
            ) : null}
          </Section>

          {/* link debt, held above everything else */}
          <Panel icon={Link2} title={`Link debt — ${debt.length} row${debt.length === 1 ? "" : "s"} without a Drive link`}
            sub="A row with no folder link is a promise the register cannot keep. Provision it, or say why it is missing."
            open={open.debt} onToggle={() => toggle("debt")}
            right={<Pill color={debt.length ? "var(--amber)" : "var(--green)"}>{debt.length ? `${debt.length} open` : "clean"}</Pill>}>
            {!debt.length ? <Done s="Every row on this project links to its folder." /> : (
              <Rows cols={[{ k: "Identifier", w: "1.6fr" }, { k: "Family", w: "0.7fr" }, { k: "Why", w: "1.6fr" }, { k: "", w: "auto" }]}
                empty="—"
                items={debt.map((d) => [
                  <Id key="i" v={d.id} />,
                  <span key="f" style={{ color: "var(--txt2)" }}>{d.fam}</span>,
                  <span key="w" style={{ color: "var(--txt2)" }}>{d.why}</span>,
                  d.fam === "Project"
                    ? <Pill key="b" color="var(--amber)">provision from the conversion page</Pill>
                    : <Btn key="b" small kind="ghost" icon={FolderTree} title={roleWhyNot} disabled={!!busy || !isRegistrar}
                      onClick={async () => {
                        setBusy("debt-" + d.id);
                        try {
                          if (d.fam === "MFG") {
                            const p = await v2ProvisionRun({ mfgId: d.id });
                            if (!p.ok) throw new Error(p.error);
                            toast(`${d.id} run folder ready`, "green");
                            await record(d.id, "MFG", PROV.linked, { folderUrl: p.folderUrl });
                          } else {
                            const p = await provision(d.fam, d.id);
                            if (!p.ok) throw new Error(p.error);
                          }
                          await load();
                        } catch (e) { toast(`${d.id}: ${e.message}`, "red"); }
                        setBusy("");
                      }}>{busy === "debt-" + d.id ? "Working…" : "Provision"}</Btn>,
                ])} />
            )}
          </Panel>

          {/* 2 — add a board */}
          <Panel icon={CircuitBoard} title="Add a board — PCB, then BOM-001, then the folder"
            sub={!pathKnown ? unknownSub : pathB ? "Path B: the board is the client's; nothing to mint (§6.3)." : "Steps 11–14: allocate the PCB ID, mint its as-designed BOM, copy the engineering blueprint."}
            open={open.board} onToggle={() => toggle("board")} disabled={pathALocked}
            right={<Pill color="var(--blue)">{boards.length} board{boards.length === 1 ? "" : "s"}</Pill>}>
            <LawStrip step={0} note="the allocator's append IS the row" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
              <Field label="Name / alias" req><input className="inp" value={bF.name} onChange={(e) => setBF({ ...bF, name: e.target.value })} placeholder="e.g. Gateway main board" /></Field>
              <Field label="Platform" hint="MCU / radio"><input className="inp" value={bF.platform} onChange={(e) => setBF({ ...bF, platform: e.target.value })} placeholder="e.g. ESP32-S3" /></Field>
              <Field label="Class">
                <select className="inp" value={bF.cls} onChange={(e) => setBF({ ...bF, cls: e.target.value })}>{PCB_CLASSES.map((c) => <option key={c}>{c}</option>)}</select>
              </Field>
              <Field label="Silkscreen marking" hint="what is printed on the board"><input className="inp" value={bF.silk} onChange={(e) => setBF({ ...bF, silk: e.target.value })} /></Field>
              <Field label="Legacy SKU code" hint="if it had one"><input className="inp" value={bF.legacy} onChange={(e) => setBF({ ...bF, legacy: e.target.value })} /></Field>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Btn icon={Plus} onClick={addBoard} title={whyNot} disabled={!canIssue || !!busy || !bF.name.trim()}>{busy === "board" ? "Allocating…" : "Allocate PCB + BOM-001 + folder"}</Btn>
              {busy === "board" && <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--txt2)" }}><TypingDots /> {prog || "writing the register row…"}</span>}
            </div>

            {lastBoard && (
              <div className="card" style={{ padding: 12, background: "var(--s2)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Done s={`${lastBoard.id}${lastBoard.bom ? ` · ${lastBoard.bom}` : ""}`} />
                  <FolderLink url={lastBoard.folderUrl} />
                </div>
                <Note tone="amber" icon={ClipboardList}>
                  <b>Recording-order step 10 is not done yet:</b> register this board in the <b>Eb_Hardware SKU Sheet</b> by hand —
                  the portal does not own that sheet. Copy-ready row (tab separated):
                </Note>
                <div style={{ fontFamily: MONO, fontSize: 11, background: "var(--s1)", border: "1px solid var(--bdr)", borderRadius: 8, padding: 10, overflowX: "auto", whiteSpace: "pre" }}>{skuRow}</div>
                <div><Btn small kind="ghost" icon={Copy} onClick={() => copy(skuRow, "SKU row")}>Copy the SKU row</Btn></div>
              </div>
            )}

            <Rows cols={[{ k: "PCB ID", w: "1.5fr" }, { k: "Name", w: "1.4fr" }, { k: "Platform", w: "1fr" }, { k: "Class", w: "0.9fr" }, { k: "", w: "auto" }]}
              empty="No boards on this project yet."
              items={boards.map((b) => [
                <Id key="i" v={b["PCB ID"]} />,
                <span key="n">{b["Name / Alias"] || "—"}</span>,
                <span key="p" style={{ color: "var(--txt2)" }}>{b.Platform || "—"}</span>,
                <span key="c" style={{ color: "var(--txt2)" }}>{b.Class || "—"}</span>,
                <FolderLink key="f" url={b["Drive Folder Link"]} />,
              ])} />
          </Panel>

          {/* 3 — attach an existing board */}
          <Panel icon={Layers} title="Attach an existing board — rule 7.0, no new PCB ID"
            sub={!pathKnown ? unknownSub : pathB ? "Path B: boards arrive as deal inputs, not as attachments." : "The board is unchanged, so its identifier is unchanged. What this project needs is its own firmware identity."}
            open={open.attach} onToggle={() => toggle("attach")} disabled={pathALocked}
            right={attached.length ? <Pill color="var(--purple)">{attached.length} attached</Pill> : null}>
            <Note tone="purple" icon={Info}>
              Rule 7.0: <b>a board reused on another project gives Project + FW — never a second PCB ID.</b> Re-minting it would
              create two identifiers for one physical board and break every join downstream. The attachment is recorded as a
              <b> Master row</b>, which is where reuse is legible.
            </Note>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
              <Field label="Board already in the register" req>
                <select className="inp" value={attachId} onChange={(e) => setAttachId(e.target.value)}>
                  <option value="">Pick a board…</option>
                  {rowsOf("PCB").filter((b) => b["Project ID"]?.toUpperCase() !== pid.toUpperCase()).map((b) => (
                    <option key={b["PCB ID"]} value={b["PCB ID"]}>{b["PCB ID"]} · {b["Name / Alias"] || "—"} · from {b["Project ID"] || "—"}</option>
                  ))}
                </select>
              </Field>
              <Btn icon={Link2} onClick={attachBoard} title={whyNot} disabled={!canIssue || !!busy || !attachId}>{busy === "attach" ? "Recording…" : "Record against this project"}</Btn>
            </div>
            {attached.length > 0 && (
              <Rows cols={[{ k: "Attached board", w: "1.5fr" }, { k: "Name", w: "1.4fr" }, { k: "Firmware for this project", w: "1.4fr" }]}
                empty="—"
                items={attached.map((b) => [
                  <Id key="i" v={b["PCB ID"]} color="var(--purple)" />,
                  <span key="n">{b["Name / Alias"] || "—"}</span>,
                  fws.some((f) => f["PCB ID"]?.toUpperCase() === String(b["PCB ID"] || "").toUpperCase())
                    ? <Done key="d" s={fws.find((f) => f["PCB ID"]?.toUpperCase() === String(b["PCB ID"] || "").toUpperCase())["FW ID"]} />
                    : <Pill key="d" color="var(--amber)">firmware identity pending</Pill>,
                ])} />
            )}
          </Panel>

          {/* 4 — firmware */}
          <Panel icon={Cpu} title="Add firmware — one identity per board, per project"
            sub={!pathKnown ? unknownSub : pathB ? "Path B: the client's firmware; Elecbits issues no FW identifier (§6.3)." : "The FW ID names the repo; the Logic Sheet is signed off before a line of it is written."}
            open={open.fw} onToggle={() => toggle("fw")} disabled={pathALocked}
            right={<Pill color="var(--blue)">{fws.length} firmware</Pill>}>
            <LawStrip step={0} note="repo name is derived from the id, so it is written back after allocation" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
              <Field label="Board" req>
                <select className="inp" value={fwF.pcb} onChange={(e) => setFwF({ ...fwF, pcb: e.target.value })}>
                  <option value="">Pick a board…</option>
                  {allBoardIds.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </Field>
              <Field label="Platform" hint="must match the board"><input className="inp" value={fwF.platform} onChange={(e) => setFwF({ ...fwF, platform: e.target.value })} placeholder="e.g. ESP-IDF 5.2" /></Field>
            </div>
            <Note tone="red" icon={ShieldAlert}>
              <b>The Logic Sheet is a gate, not a deliverable.</b> It is signed off <b>before</b> implementation starts — a Logic
              Sheet written to describe firmware that already exists documents nothing and approves nothing. Allocate the
              identifier now; do not start the build until the sheet is signed.
            </Note>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Btn icon={Plus} onClick={addFirmware} title={whyNot} disabled={!canIssue || !!busy || !fwF.pcb}>{busy === "fw" ? "Allocating…" : "Allocate FW + folder"}</Btn>
              {busy === "fw" && <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--txt2)" }}><TypingDots /> {prog || "writing the register row…"}</span>}
            </div>

            {lastFw && (
              <div className="card" style={{ padding: 12, background: "var(--s2)", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Done s={`${lastFw.id} for ${lastFw.pcb}`} /><FolderLink url={lastFw.folderUrl} />
                </div>
                <div style={{ fontSize: 11.5, color: "var(--txt2)" }}>Recording-order step 11 — done by hand in GitHub:</div>
                {[
                  `Create the repo ${repoFor(lastFw.id)} from the fw-templates template`,
                  "Pin fw-core by TAG, never by branch — a moving dependency is not a version",
                  "First commit carries the Logic Sheet link and the FW ID in the README",
                ].map((line, i) => (
                  <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--txt)", cursor: "pointer" }}>
                    <input type="checkbox" checked={!!fwTicks[i]} onChange={(e) => setFwTicks((t) => ({ ...t, [i]: e.target.checked }))} style={{ marginTop: 1 }} />
                    <span style={{ opacity: fwTicks[i] ? 0.55 : 1 }}>{i === 0 ? <><GitBranch size={12} style={{ verticalAlign: -2, marginRight: 4, color: "var(--txt3)" }} />Create the repo <b style={{ fontFamily: MONO }}>{repoFor(lastFw.id)}</b> from the <b>fw-templates</b> template</> : line}</span>
                  </label>
                ))}
                <div><Btn small kind="ghost" icon={Copy} onClick={() => copy(repoFor(lastFw.id), "Repo name")}>Copy the repo name</Btn></div>
              </div>
            )}

            <Rows cols={[{ k: "FW ID", w: "1.4fr" }, { k: "Board", w: "1.3fr" }, { k: "Repo", w: "1.6fr" }, { k: "", w: "auto" }]}
              empty="No firmware identity on this project yet."
              items={fws.map((f) => [
                <Id key="i" v={f["FW ID"]} />,
                <Id key="p" v={f["PCB ID"]} color="var(--txt2)" />,
                <span key="r" style={{ fontFamily: MONO, fontSize: 11, color: f.Repo ? "var(--txt)" : "var(--amber)" }}>{f.Repo || "repo not recorded"}</span>,
                <FolderLink key="f" url={f["Drive Folder Link"]} />,
              ])} />
          </Panel>

          {/* 5 — enclosure */}
          <Panel icon={Box} title="Add an enclosure"
            sub={!pathKnown ? unknownSub : pathB ? "Path B: the enclosure is the client's design too (§6.3)." : "One ED identifier per enclosure design, with its own blueprint folder."}
            open={open.ed} onToggle={() => toggle("ed")} disabled={pathALocked}
            right={<Pill color="var(--blue)">{eds.length}</Pill>}>
            <LawStrip step={0} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
              <Field label="Name" req><input className="inp" value={edF.name} onChange={(e) => setEdF({ ...edF, name: e.target.value })} placeholder="e.g. Wall-mount housing" /></Field>
              <Field label="Material"><input className="inp" value={edF.material} onChange={(e) => setEdF({ ...edF, material: e.target.value })} placeholder="e.g. ABS, 3D printed" /></Field>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Btn icon={Plus} onClick={addEnclosure} title={whyNot} disabled={!canIssue || !!busy || !edF.name.trim()}>{busy === "ed" ? "Allocating…" : "Allocate ED + folder"}</Btn>
              {busy === "ed" && <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--txt2)" }}><TypingDots /> {prog || "writing the register row…"}</span>}
            </div>
            <Rows cols={[{ k: "Enclosure ID", w: "1.5fr" }, { k: "Name", w: "1.5fr" }, { k: "Material", w: "1fr" }, { k: "", w: "auto" }]}
              empty="No enclosure on this project."
              items={eds.map((e) => [
                <Id key="i" v={e["Enclosure ID"]} />,
                <span key="n">{e.Name || "—"}</span>,
                <span key="m" style={{ color: "var(--txt2)" }}>{e.Material || "—"}</span>,
                <FolderLink key="f" url={e["Drive Folder Link"]} />,
              ])} />
          </Panel>

          {/* 6 — BOM revisions */}
          <Panel icon={ClipboardList} title="BOM revisions — every substitution is a revision"
            sub={!pathKnown ? unknownSub : pathB ? "Path B: a client re-issued BOM is a new deal input (rule 15.0), not a BOM revision here." : "Rule 9.0: parts substituted gives a BOM. The board keeps its identifier; the bill does not."}
            open={open.bom} onToggle={() => toggle("bom")} disabled={pathALocked}
            right={<Pill color="var(--blue)">{boms.length}</Pill>}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr auto", gap: 10, alignItems: "end" }}>
              <Field label="Board" req>
                <select className="inp" value={bomF.pcb} onChange={(e) => setBomF({ ...bomF, pcb: e.target.value })}>
                  <option value="">Pick a board…</option>
                  {allBoardIds.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </Field>
              <Field label="Revision reason" req hint="why this bill differs">
                <input className="inp" value={bomF.reason} onChange={(e) => setBomF({ ...bomF, reason: e.target.value })} placeholder="e.g. LDO substituted — original EOL" />
              </Field>
              <Btn icon={Plus} onClick={addBom} title={whyNot} disabled={!canIssue || !!busy || !bomF.pcb || !bomF.reason.trim()}>{busy === "bom" ? "Allocating…" : "New BOM revision"}</Btn>
            </div>
            <Rows cols={[{ k: "BOM ID", w: "1.8fr" }, { k: "Board", w: "1.3fr" }, { k: "Revision reason", w: "2fr" }, { k: "Costed", w: "0.7fr" }]}
              empty="No BOM revisions — a board without BOM-001 is a board nobody can cost."
              items={boms.map((b) => [
                <Id key="i" v={b["BOM ID"]} />,
                <Id key="p" v={b["PCB ID"]} color="var(--txt2)" />,
                <span key="r">{b["Revision Reason"] || "—"}</span>,
                <span key="c" style={{ color: "var(--txt2)" }}>{b["Costed?"] || "—"}</span>,
              ])} />
          </Panel>

          {/* 7 — manufacturing runs */}
          <Panel icon={Factory} title="Manufacturing runs — the quantity is frozen in the identifier"
            sub="Law 8: the ORDERED quantity is part of the id and never changes. Law 9: exactly one PARENT board per run."
            open={open.mfg} onToggle={() => toggle("mfg")}
            right={<Pill color="var(--coral)">{mfgs.length} run{mfgs.length === 1 ? "" : "s"}</Pill>}>
            <LawStrip step={0} note="then the four descriptive columns, then the run folder" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
              <Field label="Build stage">
                <select className="inp" value={mF.stage} onChange={(e) => setMF({ ...mF, stage: e.target.value })}>{BUILD_STAGES.map((s) => <option key={s}>{s}</option>)}</select>
              </Field>
              <Field label="Type">
                <select className="inp" value={mF.type} onChange={(e) => setMF({ ...mF, type: e.target.value })}>{MFG_TYPES.map((s) => <option key={s}>{s}</option>)}</select>
              </Field>
              <Field label="Ordered quantity" req hint="frozen into the id">
                <input className="inp" inputMode="numeric" value={mF.qty} onChange={(e) => setMF({ ...mF, qty: e.target.value.replace(/[^\d]/g, "") })} placeholder="e.g. 250" />
              </Field>
            </div>

            <Field label={pathB ? "Boards in this run — from the deal inputs" : "Boards in this run"} req>
              {!runBoardPool.length ? (
                <Note tone="amber">{pathB
                  ? `No PCB deal inputs under ${dealId || "this project's deal"} — register the client's design pack as deal inputs first; a Path B run has nothing to point at otherwise.`
                  : "No boards on this project yet — add one above before a run can name what it builds."}</Note>
              ) : (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {runBoardPool.map((id) => <button key={id} style={{ ...chipS(mF.boards.includes(id)), fontFamily: MONO, fontSize: 11 }} onClick={() => toggleRunBoard(id)}>{id}</button>)}
                </div>
              )}
            </Field>

            {mF.boards.length > 0 && (
              <Field label="PARENT board — exactly one" req hint="the board the run is for">
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {mF.boards.map((id) => <button key={id} style={{ ...chipS(mF.parent === id), fontFamily: MONO, fontSize: 11 }} onClick={() => setMF({ ...mF, parent: id })}>{id}</button>)}
                </div>
              </Field>
            )}

            {runProblem && <Note tone={mF.boards.length && !mF.parent ? "red" : "amber"}>{runProblem}</Note>}
            {!runProblem && <div style={{ fontSize: 12, color: "var(--txt2)" }}>Will allocate <Id v={`${pid}-MFG-nnn-${qtyN}`} /> — the serial comes from the register, the quantity from you.</div>}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Btn icon={Plus} title={whyNot} disabled={!canIssue || !!busy || !!runProblem}
                onClick={() => (runArmed ? addRun() : setArmedRun(runSig))}>
                {busy === "mfg" ? "Allocating…" : runArmed ? `Confirm ${qtyN} units — this quantity is permanent` : "Allocate the run + folder"}
              </Btn>
              {runArmed && !busy && <Btn small kind="ghost" onClick={() => setArmedRun("")}>Cancel</Btn>}
              {busy === "mfg" && <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--txt2)" }}><TypingDots /> {prog || "writing the register row…"}</span>}
            </div>
            {runArmed && !busy && (
              <Note tone="amber">
                <b>{qtyN}</b> units will be welded into <Id v={`${pid}-MFG-nnn-${qtyN}`} size={11.5} />. Law 8 forbids correcting
                an ordered quantity afterwards — a short ship is recorded in the Delivered column, never by re-issuing the id.
                Check the number, then confirm.
              </Note>
            )}

            <Rows cols={[{ k: "MFG ID", w: "2fr" }, { k: "Stage / type", w: "1.3fr" }, { k: "Parent board", w: "1.3fr" }, { k: "Ordered → delivered", w: "1.8fr" }, { k: "", w: "auto" }]}
              empty="No runs on this project yet."
              items={mfgs.map((m) => {
                const id = m["MFG ID"];
                const ordered = orderedQtyOf(id);
                const delivered = m["Delivered Qty"];
                const d = deliver[id] || {};
                const short = delivered && parseInt(delivered, 10) !== ordered;
                return [
                  <Id key="i" v={id} size={11.5} />,
                  <span key="s" style={{ color: "var(--txt2)" }}>{m["Build Stage"] || "—"}<br />{m.Type || "—"}</span>,
                  <Id key="p" v={m["PARENT board"] || "—"} color={m["PARENT board"] ? "var(--txt2)" : "var(--amber)"} size={11.5} />,
                  <div key="q" style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    <span>
                      <b style={{ fontFamily: MONO }}>{Number.isFinite(ordered) ? ordered : "?"}</b> ordered →{" "}
                      {delivered ? <b style={{ fontFamily: MONO, color: short ? "var(--amber)" : "var(--green)" }}>{delivered}</b> : <span style={{ color: "var(--txt3)" }}>not recorded</span>}
                    </span>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input className="inp" style={{ width: 96, padding: "5px 9px", fontSize: 12 }} inputMode="numeric" placeholder="delivered"
                        value={d.qty ?? ""} onChange={(e) => setDel(id, { qty: e.target.value.replace(/[^\d]/g, ""), asked: false, confirmed: false })} />
                      <Btn small kind="ghost" title={roleWhyNot} disabled={!!busy || !isRegistrar || !(d.qty ?? "").length} onClick={() => saveDelivered(m)}>{busy === "del-" + id ? "Saving…" : "Record"}</Btn>
                    </div>
                    {d.asked && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        <Note tone="amber">{parseInt(d.qty, 10)} ≠ {ordered} ordered. The identifier keeps the ordered quantity — a short ship is a fact in a column, never an edit to the id (Law 8). Confirm and it is recorded with a note.</Note>
                        <div><Btn small kind="ghost" onClick={() => saveDelivered(m, true)}>Confirm the short ship</Btn></div>
                      </div>
                    )}
                  </div>,
                  <div key="f" style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <FolderLink url={m["Run Folder Link"]} />
                    <span style={{ fontSize: 10.5, color: "var(--txt3)", fontFamily: MONO }}>{(m["Boards in this run"] || "").split(",").filter(Boolean).length} board(s)</span>
                  </div>,
                ];
              })} />
          </Panel>

          {/* 8 — the rules helper */}
          <Panel icon={Scale} title="What changed? — the issuance rules, and the MAJOR/minor test"
            sub="Rules 0.1–15.0 decide what gets a new identifier. For a PCB change the call is a judgement, so it is written to 00-Governance."
            open={open.rules} onToggle={() => toggle("rules")}>
            <Field label="Pick what changed">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, maxHeight: 190, overflowY: "auto" }}>
                {ISSUANCE_RULES.map((r) => (
                  <button key={r.rule} style={chipS(rule?.rule === r.rule)} onClick={() => { setRule(r); setMajors([]); setMinors([]); }}>
                    <span style={{ fontFamily: MONO, opacity: 0.65, marginRight: 5 }}>{r.rule}</span>{r.what}
                  </button>
                ))}
              </div>
            </Field>

            {rule && !isPcbChange && (
              <div className="card" style={{ padding: 12, background: "var(--s2)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13 }}>Rule <b style={{ fontFamily: MONO }}>{rule.rule}</b> — {rule.what}</div>
                <div style={{ fontSize: 12.5 }}>Issue: <b style={{ color: "var(--acc)" }}>{rule.gives}</b></div>
                {rule.rule === "0.4" && <Note tone="red">A dead deal is never reopened — Lost and Dropped are terminal forever. The revived idea takes the NEXT Deal ID under the same client.</Note>}
                {rule.rule === "8.0" && <Note tone="blue" icon={Info}>A firmware bug fix is a Git version, not an identifier. Tag it and move on.</Note>}
              </div>
            )}

            {isPcbChange && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Note tone="blue" icon={Info}>
                  §6.4: tick every indicator that is true of this change. <b>Two or more MAJOR indicators means a new project</b>,
                  and anything genuinely borderline is treated as MAJOR — the cheap mistake is a new project, the expensive one
                  is a project quietly becoming a different product.
                </Note>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--red)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Major indicators</div>
                    {MAJOR_MINOR.major.map((m) => (
                      <label key={m} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
                        <input type="checkbox" checked={majors.includes(m)} onChange={(e) => setMajors((x) => (e.target.checked ? [...x, m] : x.filter((y) => y !== m)))} style={{ marginTop: 1 }} />
                        <span>{m}</span>
                      </label>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--green)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>Minor indicators</div>
                    {MAJOR_MINOR.minor.map((m) => (
                      <label key={m} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, marginBottom: 6, cursor: "pointer" }}>
                        <input type="checkbox" checked={minors.includes(m)} onChange={(e) => setMinors((x) => (e.target.checked ? [...x, m] : x.filter((y) => y !== m)))} style={{ marginTop: 1 }} />
                        <span>{m}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="card" style={{ padding: 12, background: "var(--s2)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill color={verdict.c}><Gauge size={11} /> {verdict.call}</Pill>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Issue: {verdict.gives}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--txt2)" }}>{verdict.why}</div>
                </div>
              </div>
            )}

            {rule && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11.5, color: "var(--txt2)", lineHeight: 1.6, fontStyle: "italic" }}>“{govLine}”</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Btn icon={Sparkles} onClick={writeGovernance} title={whyNot} disabled={!canIssue || !!busy}>{busy === "gov" ? "Writing…" : "Record this call in 00-Governance"}</Btn>
                  <Btn kind="ghost" small icon={Copy} onClick={() => copy(govLine, "Decision line")}>Copy the line</Btn>
                </div>
                <Note tone="blue" icon={Info}>An unrecorded judgement is a judgement someone re-litigates in six months. The line is appended, dated and attributed to <b>{by}</b>.</Note>
              </div>
            )}
          </Panel>

          {/* 9 — Master mapping */}
          <Panel icon={Boxes} title="Master mapping — the only join between the three Drive trees"
            sub="One row per live combination: client, deal, project, board, BOM, firmware, enclosure, run — plus the rule that produced it."
            open={open.master} onToggle={() => toggle("master")}
            right={<Pill color="var(--purple)">{masterRows.length} row{masterRows.length === 1 ? "" : "s"}</Pill>}>
            <Note tone="purple" icon={Info}>
              Sales, Projects and Engineering live in three separate Drive trees on purpose. <b>The Master tab is the only place
              they meet.</b> A combination that is real but unmapped is invisible to every report the company runs.
            </Note>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
              <Field label="Client ID"><input className="inp" value={clientId} readOnly style={{ fontFamily: MONO, opacity: 0.75 }} /></Field>
              <Field label="Deal ID"><input className="inp" value={dealId} readOnly style={{ fontFamily: MONO, opacity: 0.75 }} /></Field>
              <Field label="Project ID"><input className="inp" value={pid} readOnly style={{ fontFamily: MONO, opacity: 0.75 }} /></Field>
              <Field label="PCB ID">
                <select className="inp" value={mm.pcb} onChange={(e) => setMm({ ...mm, pcb: e.target.value, bom: "" })}>
                  <option value="">—</option>{allBoardIds.map((id) => <option key={id}>{id}</option>)}
                </select>
              </Field>
              <Field label="BOM ID">
                <select className="inp" value={mm.bom} onChange={(e) => setMm({ ...mm, bom: e.target.value })}>
                  <option value="">—</option>
                  {boms.filter((b) => !mm.pcb || b["PCB ID"] === mm.pcb).map((b) => <option key={b["BOM ID"]}>{b["BOM ID"]}</option>)}
                </select>
              </Field>
              <Field label="FW ID">
                <select className="inp" value={mm.fw} onChange={(e) => setMm({ ...mm, fw: e.target.value })}>
                  <option value="">—</option>{fws.map((f) => <option key={f["FW ID"]}>{f["FW ID"]}</option>)}
                </select>
              </Field>
              <Field label="Enclosure ID">
                <select className="inp" value={mm.ed} onChange={(e) => setMm({ ...mm, ed: e.target.value })}>
                  <option value="">—</option>{eds.map((e) => <option key={e["Enclosure ID"]}>{e["Enclosure ID"]}</option>)}
                </select>
              </Field>
              <Field label="MFG ID">
                <select className="inp" value={mm.mfg} onChange={(e) => setMm({ ...mm, mfg: e.target.value })}>
                  <option value="">—</option>{mfgs.map((m) => <option key={m["MFG ID"]}>{m["MFG ID"]}</option>)}
                </select>
              </Field>
              <Field label="Rule" req hint="what produced this combination">
                <select className="inp" value={mm.rule} onChange={(e) => setMm({ ...mm, rule: e.target.value })}>
                  <option value="">—</option>{ISSUANCE_RULES.map((r) => <option key={r.rule} value={r.rule}>{r.rule} · {r.what}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Notes"><input className="inp" value={mm.notes} onChange={(e) => setMm({ ...mm, notes: e.target.value })} placeholder="anything the columns cannot say" /></Field>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <Btn icon={Link2} onClick={writeMaster} title={whyNot} disabled={!canIssue || !!busy || !mm.rule}>{busy === "master" ? "Writing…" : "Write the Master row"}</Btn>
              {!mm.rule && <span style={{ fontSize: 11.5, color: "var(--txt2)" }}>Pick the rule — a Master row without one records a fact but not its reason.</span>}
            </div>

            <Rows cols={[{ k: "PCB", w: "1.2fr" }, { k: "BOM", w: "1.5fr" }, { k: "FW", w: "1.2fr" }, { k: "MFG", w: "1.6fr" }, { k: "Rule", w: "0.6fr" }]}
              empty="No Master rows for this project — nothing joins its trees yet."
              items={masterRows.map((r) => [
                <Id key="a" v={r["PCB ID"] || "—"} color="var(--txt2)" size={11.5} />,
                <Id key="b" v={r["BOM ID"] || "—"} color="var(--txt2)" size={11.5} />,
                <Id key="c" v={r["FW ID"] || "—"} color="var(--txt2)" size={11.5} />,
                <Id key="d" v={r["MFG ID"] || "—"} color="var(--txt2)" size={11.5} />,
                <Pill key="e" color="var(--purple)">{r.Rule || "—"}</Pill>,
              ])} />
          </Panel>
        </>
      )}
    </div>
  );
}
