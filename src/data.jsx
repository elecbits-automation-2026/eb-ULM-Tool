/* ─── Data layer ─────────────────────────────────────────────────────────────
   One provider, two modes, one shape.

   Supabase mode  — reads the same database as the ODM PMS: core.people (the
                    common profile table), core.orgs, core.projects (the
                    spine), core.intake (ULM's inbox over sales.requests),
                    ulm.sanction_events / allocations / provisioning /
                    reviews. Every WRITE goes through the SECURITY DEFINER
                    portal_* wrappers installed by supabase/10-ulm-tool.sql —
                    the browser never touches sanction state directly.

   Demo mode      — no env vars: seeded roster/clients/requests/projects,
                    persisted to localStorage, and the same decide() state
                    machine applied locally so the whole portal is usable
                    with zero setup.                                          */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseEnabled } from "./lib/supabase.js";
import { tbl, withLayoutRetry } from "./lib/tables.js";
import { fetchProfiles } from "./lib/auth.js";
import { uid } from "./ui.jsx";

const Ctx = createContext(null);
export const useUlm = () => useContext(Ctx);

/* ── demo seeds ───────────────────────────────────────────────────────────── */

export const SEED_PEOPLE = [
  { id: "u-saurav", name: "Saurav", role: "superadmin", title: "Super Admin", color: "#2563eb", email: "saurav@elecbits.in" },
  { id: "u-shreya", name: "Shreya", role: "dept_head", title: "Dept Head — Project Management", color: "#7c3aed", email: "shreya@elecbits.in" },
  { id: "u-akshay", name: "Akshay", role: "pm", title: "Senior PM (Technical Manager)", resourceRole: "sr_pm", color: "#0891b2", email: "akshay@elecbits.in" },
  { id: "u-priya", name: "Priya", role: "pm", title: "Project Manager", resourceRole: "jr_pm", color: "#be185d", email: "priya@elecbits.in" },
  { id: "u-rahul", name: "Rahul", role: "engineer", title: "Sr. Hardware Engineer", resourceRole: "sr_hw", color: "#ea580c", email: "rahul@elecbits.in" },
  { id: "u-gargi", name: "Gargi", role: "engineer", title: "Sr. Firmware Engineer", resourceRole: "sr_fw", color: "#16a34a", email: "gargi@elecbits.in" },
  { id: "u-nikhil", name: "Nikhil", role: "engineer", title: "Industrial Designer", resourceRole: "ind_design", color: "#d97706", email: "nikhil@elecbits.in" },
  { id: "u-vikram", name: "Vikram", role: "engineer", title: "Solution Architect", resourceRole: "sol_arch", color: "#4f46e5", email: "vikram@elecbits.in" },
];

const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ago = (n) => new Date(Date.now() - n * 86400000).toISOString();

const seedData = () => {
  const orgs = [
    { id: "o-1", clientId: "PL20-001", name: "Acme Devices", industry: "Consumer Electronics", orgSize: "Proto Level — Small Hardware Startups", kind: "customer", active: true, contacts: [{ name: "Meera Shah", designation: "Founder", email: "meera@acmedevices.in", phone: "+91 98100 11223" }] },
    { id: "o-2", clientId: "ML04-002", name: "GridSense Industrial", industry: "IIoT", orgSize: "Mid Level — Hardware Startups", kind: "customer", active: true, contacts: [{ name: "Arjun Rao", designation: "CTO", email: "arjun@gridsense.io", phone: "+91 98220 44556" }] },
  ];
  const projects = [
    {
      id: "p-1", projectId: "EbZ-PL20-001-01", appId: "EbZ-PL20-001-01", idMode: "auto", name: "ESP32 Air-Quality Monitor",
      desc: "Battery WiFi AQ monitor with app.", clientId: "PL20-001", clientName: "Acme Devices",
      industry: "Consumer Electronics", orgSize: "Proto Level — Small Hardware Startups",
      contact: { name: "Meera Shah", designation: "Founder" }, deadline: daysFromNow(45), status: "In Progress",
      team: [{ slot: "PM (Project Manager)", userId: "u-priya" }, { slot: "Senior PM (Technical Manager)", userId: "u-akshay" }, { slot: "Sr. Hardware Engineer", userId: "u-rahul" }, { slot: "Sr. Firmware Engineer", userId: "u-gargi" }],
      kind: "odm", sanctionState: "sanctioned", sanctionedAt: ago(21), sanctionedBy: "u-shreya",
      sanctionReason: "created and sanctioned in the ULM portal", requestedAt: ago(24),
      lldCustomer: { mode: "chat", text: "Product — battery WiFi air-quality monitor…" }, lldDesigner: { mode: "ai", text: "DESIGNER LLD — ESP32 AQ Monitor…" },
      createdAt: ago(24), createdBy: "u-shreya",
    },
    {
      id: "p-2", projectId: "EbZ-ML04-002-01", appId: "EbZ-ML04-002-01", idMode: "auto", name: "3-Phase Energy Gateway",
      desc: "Panel-mounted Modbus→cloud gateway, 200 units.", clientId: "ML04-002", clientName: "GridSense Industrial",
      industry: "IIoT", orgSize: "Mid Level — Hardware Startups", contact: { name: "Arjun Rao" },
      deadline: daysFromNow(90), status: "Planning", team: [],
      kind: "boxbuild", sanctionState: "requested", requestedAt: ago(3),
      lldCustomer: null, lldDesigner: null, createdAt: ago(3), createdBy: "u-akshay",
    },
  ];
  const requests = [
    { id: "r-1", title: "Wearable fall-detection pendant — pilot 50 units", summary: "Elderly-care startup; BLE + LTE-M pendant, 50-unit pilot then 5k/yr.", kind: "odm", orgId: null, orgName: "CarePulse Health (new)", qty: 50, targetDate: daysFromNow(120), valueInr: 1850000, urgency: "high", status: "submitted", submittedBy: "u-akshay", submittedAt: ago(2) },
    { id: "r-2", title: "Assembly of client-designed LED driver boards", summary: "Client supplies design + parts; we build and test 1,000 boards.", kind: "boxbuild", orgId: "o-2", orgName: "GridSense Industrial", qty: 1000, targetDate: daysFromNow(60), valueInr: 950000, urgency: "normal", status: "submitted", submittedBy: "u-priya", submittedAt: ago(1) },
  ];
  const events = [
    { id: "e-1", projectId: "p-1", projectCode: "EbZ-PL20-001-01", action: "request", fromState: "draft", toState: "requested", kind: "odm", reason: "raised in the ULM portal", decidedBy: "u-shreya", decidedAt: ago(24) },
    { id: "e-2", projectId: "p-1", projectCode: "EbZ-PL20-001-01", action: "sanction", fromState: "requested", toState: "sanctioned", kind: "odm", reason: "created and sanctioned in the ULM portal", decidedBy: "u-shreya", decidedAt: ago(21) },
    { id: "e-3", projectId: "p-2", projectCode: "EbZ-ML04-002-01", action: "request", fromState: "draft", toState: "requested", kind: "boxbuild", reason: "arrived from the ODM app intake", decidedBy: "u-akshay", decidedAt: ago(3) },
  ];
  const allocations = [
    { id: "a-1", projectId: "p-1", toolKey: "pms_odm", ownerId: "u-akshay", allocatedBy: "u-shreya", allocatedAt: ago(21), releasedAt: null, note: "Akshay takes delivery" },
  ];
  const provisioning = [
    { projectId: "p-1", projectCode: "EbZ-PL20-001-01", status: "provisioned", folderUrl: "", processMapUrl: "", filesCopied: 72, foldersCopied: 41, templatesLinked: 178, provisionedAt: ago(21) },
  ];
  return { orgs, projects, requests, events, allocations, provisioning, reviews: [] };
};

/* ── row normalisers (DB → app shape) ─────────────────────────────────────── */

const normProject = (r) => ({
  id: r.id, projectId: r.project_id, appId: r.app_id || r.project_id, idMode: r.id_mode || "auto",
  name: r.name || r.project_id, desc: r.description || "", clientId: r.client_id || "", clientName: r.client_name || "",
  industry: r.industry || "", orgSize: r.org_size || "", contact: r.contact || {},
  deadline: r.deadline || "", startDate: r.start_date || "", status: r.status || "Planning",
  team: Array.isArray(r.team) ? r.team : [],
  kind: r.kind || null, sanctionState: r.sanction_state || "draft",
  isSanctioned: !!r.is_sanctioned, sanctionedAt: r.sanctioned_at, sanctionedBy: r.sanctioned_by,
  sanctionReason: r.sanction_reason || "", requestedAt: r.requested_at, requestedBy: r.requested_by,
  orgId: r.org_id || null, parentId: r.parent_id || null,
  lldCustomer: r.lld_customer || null, lldDesigner: r.lld_designer || null,
  createdAt: r.created_at, createdBy: r.created_by,
});

const normRequest = (r) => ({
  id: r.id, title: r.title, summary: r.summary || "", kind: r.proposed_kind || null,
  orgId: r.org_id, orgName: r.org_name || "", qty: r.qty, targetDate: r.target_date,
  valueInr: r.value_inr, poRef: r.po_ref || "", urgency: r.urgency || "normal", status: r.status,
  projectId: r.project_id, submittedBy: r.submitted_by, submittedAt: r.submitted_at,
  decidedAt: r.decided_at, decidedBy: r.decided_by, decisionNote: r.decision_note || "",
});

const normOrg = (r, contacts) => ({
  id: r.id, clientId: r.client_id || "", name: r.name, industry: r.industry || "", orgSize: r.org_size || "",
  kind: r.kind || "customer", active: r.active !== false,
  contacts: (contacts || []).filter((c) => c.org_id === r.id).map((c) => ({ name: c.name, designation: c.role || "", email: c.email || "", phone: c.phone || "", isPrimary: c.is_primary })),
});

const normEvent = (r) => ({ id: r.id, projectId: r.project_id, projectCode: r.project_code, action: r.action, fromState: r.from_state, toState: r.to_state, kind: r.kind, reason: r.reason || "", decidedBy: r.decided_by, decidedAt: r.decided_at });
const normAlloc = (r) => ({ id: r.id, projectId: r.project_id, toolKey: r.tool_key, ownerId: r.owner_id, allocatedBy: r.allocated_by, allocatedAt: r.allocated_at, releasedAt: r.released_at, note: r.note || "" });
const normProv = (r) => ({ projectId: r.project_id, projectCode: r.project_code, status: r.status, folderId: r.folder_id, folderUrl: r.folder_url || "", processMapUrl: r.process_map_url || "", templatesLinked: r.templates_linked, filesCopied: r.files_copied, foldersCopied: r.folders_copied, clientRegisterUrl: r.client_register_url || "", projectRegisterUrl: r.project_register_url || "", error: r.error || "", provisionedAt: r.provisioned_at, pcbFolders: Array.isArray(r.pcb_folders) ? r.pcb_folders : [] });

/* ── the provider ─────────────────────────────────────────────────────────── */

const LS_KEY = "ulm-v1";
const LS_ME = "ulm-demo-user";

export function UlmProvider({ session, children }) {
  const live = supabaseEnabled;

  /* people — the common profile table (core.people) or the seed roster */
  const [people, setPeople] = useState(live ? null : SEED_PEOPLE);
  const [loadError, setLoadError] = useState("");

  /* the working set */
  const [data, setData] = useState(() => {
    if (live) return { orgs: [], projects: [], requests: [], events: [], allocations: [], provisioning: [], reviews: [] };
    try { const s = JSON.parse(localStorage.getItem(LS_KEY) || "null"); if (s?.projects) return s; } catch { /* seed */ }
    return seedData();
  });
  const [loading, setLoading] = useState(live);

  /* demo persistence */
  useEffect(() => {
    if (!live) { try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch { /* full */ } }
  }, [data, live]);

  /* identity + view-as (admins can inspect any role, like the ODM app) */
  const [me, setMe] = useState(() => (!live && localStorage.getItem(LS_ME)) || "");
  useEffect(() => { if (!live && me) localStorage.setItem(LS_ME, me); }, [me, live]);

  useEffect(() => {
    if (!live || !people || !session) return;
    const mine = people.find((p) => p.authId === session.user.id || p.id === session.user.id);
    setMe((cur) => cur || mine?.id || people[0]?.id || "");
  }, [live, people, session]);
  /* In demo mode `me` stays empty until the login screen picks a seed user. */

  const my = useMemo(() => (people || []).find((p) => p.id === me) || null, [people, me]);
  const realMe = useMemo(() => {
    if (!live || !session || !people) return my;
    return people.find((p) => p.authId === session.user.id || p.id === session.user.id) || null;
  }, [live, session, people, my]);
  /* what the signed-in human may DO is decided by who they really are; the
     view-as switcher only changes what they LOOK at. */
  const isAdmin = ["superadmin", "dept_head"].includes((live ? realMe : my)?.role);

  /* ── loading (supabase mode) ─────────────────────────────────────────── */
  const loadedOnce = useRef(false);
  const refresh = useCallback(async () => {
    if (!live) return;
    try {
      const [profiles, projRes, orgRes, conRes, reqRes, evtRes, allocRes, provRes, revRes] = await Promise.all([
        fetchProfiles(),
        withLayoutRetry(supabase, () => tbl(supabase, "projects").select("*").order("created_at", { ascending: false })),
        withLayoutRetry(supabase, () => tbl(supabase, "orgs").select("*").order("name")),
        withLayoutRetry(supabase, () => tbl(supabase, "contacts").select("*")),
        withLayoutRetry(supabase, () => tbl(supabase, "intake").select("*").order("submitted_at", { ascending: false })),
        withLayoutRetry(supabase, () => tbl(supabase, "sanction_events").select("*").order("decided_at", { ascending: false }).limit(400)),
        withLayoutRetry(supabase, () => tbl(supabase, "allocations").select("*")),
        withLayoutRetry(supabase, () => tbl(supabase, "provisioning").select("*")),
        withLayoutRetry(supabase, () => tbl(supabase, "reviews").select("*").order("created_at", { ascending: false }).limit(200)),
      ]);
      if (!profiles.length) throw new Error("No profiles in core.people — run the schema SQL and sign up once.");
      const firstErr = [projRes, reqRes].find((r) => r?.error);
      if (firstErr) throw new Error(firstErr.error.message);
      setPeople(profiles);
      setData({
        projects: (projRes.data || []).map(normProject),
        orgs: (orgRes.data || []).map((o) => normOrg(o, conRes.data || [])),
        requests: (reqRes.data || []).map(normRequest),
        events: (evtRes.data || []).map(normEvent),
        allocations: (allocRes.data || []).map(normAlloc),
        provisioning: (provRes.data || []).map(normProv),
        reviews: revRes.data || [],
      });
      setLoadError("");
    } catch (e) {
      setLoadError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [live]);

  useEffect(() => {
    if (live && session && !loadedOnce.current) { loadedOnce.current = true; refresh(); }
  }, [live, session, refresh]);

  /* ── toasts ──────────────────────────────────────────────────────────── */
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((msg, kind = "blue") => {
    const id = uid();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  /* ── rpc helper ──────────────────────────────────────────────────────── */
  const rpc = useCallback(async (fn, params) => {
    const { data: out, error } = await supabase.schema("ulm").rpc(fn, params);
    if (error) throw new Error(error.message);
    return out;
  }, []);

  /* ── the demo decide() state machine (mirror of ulm.decide) ──────────── */
  const demoDecide = (project, action, kind, reason, by) => {
    const nxt = { request: "requested", sanction: "sanctioned", unsanction: "unsanctioned", hold: "on_hold", resume: "sanctioned", route: project.sanctionState, close: "closed", reopen: "sanctioned" }[action];
    if (!nxt) throw new Error("unknown action: " + action);
    const newKind = kind || project.kind;
    if (nxt === "sanctioned" && !newKind) throw new Error("sanctioning requires a kind (odm | boxbuild | product)");
    const evt = { id: uid(), projectId: project.id, projectCode: project.projectId, action, fromState: project.sanctionState, toState: nxt, kind: newKind, reason: reason || "", decidedBy: by, decidedAt: new Date().toISOString() };
    setData((d) => {
      let allocations = d.allocations;
      if (nxt === "sanctioned" && !allocations.some((a) => a.projectId === project.id && !a.releasedAt)) {
        const toolKey = newKind === "odm" ? "pms_odm" : newKind === "boxbuild" ? "pms_bb" : "pms_product";
        allocations = [...allocations, { id: uid(), projectId: project.id, toolKey, ownerId: null, allocatedBy: by, allocatedAt: new Date().toISOString(), releasedAt: null, note: "" }];
      } else if (["unsanctioned", "closed"].includes(nxt)) {
        allocations = allocations.map((a) => (a.projectId === project.id && !a.releasedAt ? { ...a, releasedAt: new Date().toISOString() } : a));
      }
      return {
        ...d,
        allocations,
        events: [evt, ...d.events],
        projects: d.projects.map((p) => (p.id === project.id ? {
          ...p, sanctionState: nxt, kind: newKind, sanctionReason: reason || p.sanctionReason,
          sanctionedAt: nxt === "sanctioned" ? (p.sanctionedAt || new Date().toISOString()) : p.sanctionedAt,
          sanctionedBy: nxt === "sanctioned" ? (by || p.sanctionedBy) : p.sanctionedBy,
        } : p)),
      };
    });
  };

  /* ── actions — every write in the portal ─────────────────────────────── */

  const submitRequest = useCallback(async (f) => {
    if (live) {
      await rpc("portal_submit_request", { p_title: f.title, p_summary: f.summary || null, p_kind: f.kind || null, p_org: f.orgId || null, p_qty: f.qty ? Number(f.qty) : null, p_target: f.targetDate || null, p_value: f.valueInr ? Number(f.valueInr) : null, p_urgency: f.urgency || "normal" });
      await refresh();
    } else {
      setData((d) => ({ ...d, requests: [{ id: uid(), title: f.title, summary: f.summary || "", kind: f.kind || null, orgId: f.orgId || null, orgName: f.orgName || (d.orgs.find((o) => o.id === f.orgId)?.name ?? ""), qty: f.qty ? Number(f.qty) : null, targetDate: f.targetDate || null, valueInr: f.valueInr ? Number(f.valueInr) : null, urgency: f.urgency || "normal", status: "submitted", submittedBy: me, submittedAt: new Date().toISOString() }, ...d.requests] }));
    }
  }, [live, rpc, refresh, me]);

  const saveReview = useCallback(async (rev) => {
    if (live) {
      const { error } = await withLayoutRetry(supabase, () => tbl(supabase, "reviews").insert({
        request_id: rev.requestId || null, project_id: rev.projectId || null, project_code: rev.projectCode || null,
        proposed_kind: rev.kind || null, feasibility: rev.feasibility || null, capacity: rev.capacity || null,
        commercial: rev.commercial || null, strategic: rev.strategic || null, notes: rev.notes || null,
        verdict: rev.verdict || "pending", reviewed_by: realMe?.id || null, reviewed_at: rev.verdict && rev.verdict !== "pending" ? new Date().toISOString() : null,
      }));
      if (error) throw new Error(error.message);
    } else {
      setData((d) => ({ ...d, reviews: [{ id: uid(), ...rev, reviewedBy: me, createdAt: new Date().toISOString() }, ...d.reviews] }));
    }
  }, [live, me, realMe]);

  const acceptRequest = useCallback(async (req, { kind, code, name, deadline, note }) => {
    if (live) {
      await rpc("portal_accept_request", { p_request: req.id, p_kind: kind, p_code: code || null, p_name: name || null, p_deadline: deadline || null, p_note: note || null });
      await refresh();
      return null;
    }
    const projectId = code || `EbZ-REQ-${String(data.projects.length + 1).padStart(2, "0")}`;
    const proj = { id: uid(), projectId, appId: projectId, idMode: code ? "manual" : "auto", name: name || req.title, desc: req.summary, clientId: data.orgs.find((o) => o.id === req.orgId)?.clientId || "", clientName: req.orgName, industry: "", orgSize: "", contact: {}, deadline: deadline || req.targetDate || "", status: "Planning", team: [], kind, sanctionState: "requested", requestedAt: req.submittedAt, createdAt: new Date().toISOString(), createdBy: me, lldCustomer: null, lldDesigner: null };
    setData((d) => ({ ...d, projects: [proj, ...d.projects], requests: d.requests.map((r) => (r.id === req.id ? { ...r, status: "accepted", projectId: proj.id, decidedAt: new Date().toISOString(), decidedBy: me, decisionNote: note || "" } : r)) }));
    demoDecide(proj, "sanction", kind, note || `accepted from request ${req.id}`, me);
    return proj;
  }, [live, rpc, refresh, data, me]);

  const rejectRequest = useCallback(async (req, note) => {
    if (live) {
      await rpc("portal_reject_request", { p_request: req.id, p_note: note || null });
      await refresh();
    } else {
      setData((d) => ({ ...d, requests: d.requests.map((r) => (r.id === req.id ? { ...r, status: "rejected", decidedAt: new Date().toISOString(), decidedBy: me, decisionNote: note || "" } : r)) }));
    }
  }, [live, rpc, refresh, me]);

  const decide = useCallback(async (project, action, kind, reason) => {
    if (live) {
      await rpc("portal_decide", { p_project: project.id, p_action: action, p_kind: kind || null, p_reason: reason || null });
      await refresh();
    } else {
      demoDecide(project, action, kind, reason, me);
    }
  }, [live, rpc, refresh, me]);

  const createClient = useCallback(async (c) => {
    if (live) {
      await rpc("portal_create_client", { p_client_id: c.clientId, p_name: c.name, p_industry: c.industry || null, p_org_size: c.orgSize || null, p_contact: c.contact || null });
      await refresh();
      return c.clientId;
    }
    if (data.orgs.some((o) => o.clientId === c.clientId)) throw new Error(`Client ID ${c.clientId} already exists`);
    setData((d) => ({ ...d, orgs: [...d.orgs, { id: uid(), clientId: c.clientId, name: c.name, industry: c.industry || "", orgSize: c.orgSize || "", kind: "customer", active: true, contacts: c.contact?.name ? [{ ...c.contact, isPrimary: true }] : [] }] }));
    return c.clientId;
  }, [live, rpc, refresh, data.orgs]);

  const createProject = useCallback(async (p) => {
    if (live) {
      const row = await rpc("portal_create_project", {
        p_code: p.projectId, p_name: p.name, p_kind: p.kind, p_desc: p.desc || null,
        p_client_id: p.clientId || null, p_client_name: p.clientName || null,
        p_industry: p.industry || null, p_org_size: p.orgSize || null,
        p_contact: p.contact || null, p_deadline: p.deadline || null,
        p_team: p.team || [], p_lld_customer: p.lldCustomer || null, p_lld_designer: p.lldDesigner || null,
        p_owner: p.ownerId || null, p_sanction: p.sanction !== false, p_id_mode: p.idMode || "auto",
      });
      await refresh();
      return normProject(Array.isArray(row) ? row[0] : row);
    }
    if (data.projects.some((x) => x.projectId.toLowerCase() === p.projectId.toLowerCase())) throw new Error(`Project ID ${p.projectId} already exists`);
    const proj = { id: uid(), projectId: p.projectId, appId: p.projectId, idMode: p.idMode || "auto", name: p.name, desc: p.desc || "", clientId: p.clientId || "", clientName: p.clientName || "", industry: p.industry || "", orgSize: p.orgSize || "", contact: p.contact || {}, deadline: p.deadline || "", status: "Planning", team: p.team || [], kind: p.kind, sanctionState: "requested", requestedAt: new Date().toISOString(), createdAt: new Date().toISOString(), createdBy: me, lldCustomer: p.lldCustomer || null, lldDesigner: p.lldDesigner || null };
    setData((d) => ({ ...d, projects: [proj, ...d.projects] }));
    if (p.sanction !== false) {
      demoDecide(proj, "sanction", p.kind, "created and sanctioned in the ULM portal", me);
      if (p.ownerId) setData((d) => ({ ...d, allocations: d.allocations.map((a) => (a.projectId === proj.id && !a.releasedAt ? { ...a, ownerId: p.ownerId } : a)) }));
    }
    return proj;
  }, [live, rpc, refresh, data.projects, me]);

  const setTeam = useCallback(async (project, team) => {
    if (live) {
      await rpc("portal_set_team", { p_project: project.id, p_team: team });
      await refresh();
    } else {
      setData((d) => ({ ...d, projects: d.projects.map((p) => (p.id === project.id ? { ...p, team } : p)) }));
    }
  }, [live, rpc, refresh]);

  const allocateOwner = useCallback(async (project, ownerId, note) => {
    if (live) {
      await rpc("portal_allocate", { p_project: project.id, p_owner: ownerId, p_note: note || null });
      await refresh();
    } else {
      setData((d) => ({ ...d, allocations: d.allocations.map((a) => (a.projectId === project.id && !a.releasedAt ? { ...a, ownerId, note: note || a.note } : a)) }));
    }
  }, [live, rpc, refresh]);

  const saveProvisioning = useCallback(async (project, prov) => {
    if (live) {
      await rpc("record_provisioning", {
        p_project: project.id, p_status: prov.status,
        p_folder_id: prov.folderId || null, p_folder_url: prov.folderUrl || null,
        p_process_map_url: prov.processMapUrl || null, p_templates_linked: prov.templatesLinked ?? null,
        p_files_copied: prov.filesCopied ?? null, p_folders_copied: prov.foldersCopied ?? null,
        p_client_register: prov.clientRegisterUrl || null, p_project_register: prov.projectRegisterUrl || null,
        p_error: prov.error || null,
      });
      await refresh();
    } else {
      setData((d) => ({ ...d, provisioning: [...d.provisioning.filter((x) => x.projectId !== project.id), { projectId: project.id, projectCode: project.projectId, provisionedAt: new Date().toISOString(), ...prov }] }));
    }
  }, [live, rpc, refresh]);

  /* A PCB-ID folder was replicated into the engineering area for one board. */
  const recordPcbFolder = useCallback(async (project, pcb) => {
    if (live) {
      await rpc("record_pcb_folder", { p_project: project.id, p_pcb_id: pcb.pcbId, p_folder_url: pcb.folderUrl || null, p_folder_id: pcb.folderId || null, p_board_name: pcb.boardName || null });
      await refresh();
    } else {
      setData((d) => {
        const cur = d.provisioning.find((x) => x.projectId === project.id) || { projectId: project.id, projectCode: project.projectId, status: "pending" };
        const entry = { ...pcb, at: new Date().toISOString() };
        const pcbFolders = [...(cur.pcbFolders || []).filter((x) => x.pcbId !== pcb.pcbId), entry];
        return { ...d, provisioning: [...d.provisioning.filter((x) => x.projectId !== project.id), { ...cur, pcbFolders }] };
      });
    }
  }, [live, rpc, refresh]);

  const ctx = useMemo(() => ({
    live, loading, loadError, refresh,
    people: people || [], me, setMe, my, realMe, isAdmin,
    ...data,
    toasts, toast,
    submitRequest, saveReview, acceptRequest, rejectRequest, decide,
    createClient, createProject, setTeam, allocateOwner, saveProvisioning, recordPcbFolder,
  }), [live, loading, loadError, refresh, people, me, my, realMe, isAdmin, data, toasts, toast, submitRequest, saveReview, acceptRequest, rejectRequest, decide, createClient, createProject, setTeam, allocateOwner, saveProvisioning, recordPcbFolder]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}
