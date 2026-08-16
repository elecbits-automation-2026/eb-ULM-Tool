/* ─── WHERE EVERY TABLE LIVES ─────────────────────────────────────────────────
   One map, one place. Table names used to be string literals scattered across
   three files; when the database was reorganised into schemas that meant
   hunting them down one by one. Now a move is an edit to this file.

   Two schemas matter to this app:

     core   what the whole company shares — people, orgs, projects,
            assignments. The ULM, HR, Finance, Box Build and Product tools
            read the same rows.
     pms    this tool's own working data — tasks, stages, meetings, the
            workspace blob.

   Both must be listed in Supabase → Settings → API → Exposed schemas, or
   PostgREST will answer 404 for everything here.                            */

/* If the database has NOT been reorganised yet — 00-one-structure.sql not run,
   or rolled back — everything still lives in `public` under its old name. The
   app must work either way: a tool that needs its database migration and its
   deploy to land in the same two minutes is a tool that breaks at 4pm on a
   Wednesday. `ensureLayout` probes once per page load and every query then
   goes to wherever the data actually is. */

/* logical name → [schema, table] */
const WHERE = {
  // ── core ──────────────────────────────────────────────────────────────
  people:      ["core", "people"],        // was public.profiles
  orgs:        ["core", "orgs"],          // was public.clients
  projects:    ["core", "projects"],
  assignments: ["core", "assignments"],   // was public.team_assignments
  trainings:   ["core", "trainings"],
  memory:      ["core", "memory"],
  sync_log:    ["core", "sync_log"],      // was public.drive_sync_log

  // ── pms ───────────────────────────────────────────────────────────────
  workspace:          ["pms", "workspace"],           // was public.app_kv
  tasks:              ["pms", "tasks"],
  stages:             ["pms", "stages"],              // was public.project_stages
  scrum_notes:        ["pms", "scrum_notes"],
  meetings:           ["pms", "meetings"],            // was public.moms
  meeting_ideas:      ["pms", "meeting_ideas"],
  meeting_decisions:  ["pms", "meeting_decisions"],
  meeting_challenges: ["pms", "meeting_challenges"],
  messages:           ["pms", "messages"],
  intel:              ["pms", "intel"],               // was public.project_intel
  work_updates:       ["pms", "work_updates"],
  kpi_log:            ["pms", "kpi_log"],
  // Meeting transcripts (Google Meet, captured by Fireflies). Added after the
  // schema split, so it carries the same name in both layouts.
  transcripts:        ["pms", "transcripts"],

  // ── core, ULM-portal additions (01-core.sql — no legacy names) ────────
  contacts:  ["core", "contacts"],
  documents: ["core", "documents"],
  events:    ["core", "events"],
  tools:     ["core", "tools"],
  intake:    ["core", "intake"],          // view — ULM's inbox over sales.requests
  staffing:  ["core", "staffing"],        // view — people × projects

  // ── ulm — the portal's own schema (sanction-gate.sql + 03-ulm.sql +
  //    10-ulm-tool.sql; born after the split, so no legacy names) ────────
  sanction_events: ["ulm", "sanction_events"],
  allocations:     ["ulm", "allocations"],
  work_packages:   ["ulm", "work_packages"],
  reviews:         ["ulm", "reviews"],
  risks:           ["ulm", "risks"],
  resource_plan:   ["ulm", "resource_plan"],
  provisioning:    ["ulm", "provisioning"],
};

/* The same tables before the reorganisation: all in `public`, and eleven of
   them under a different name. */
const OLD_NAME = {
  people: "profiles",
  orgs: "clients",
  assignments: "team_assignments",
  sync_log: "drive_sync_log",
  workspace: "app_kv",
  stages: "project_stages",
  meetings: "moms",
  meeting_ideas: "mom_ideas",
  meeting_decisions: "mom_decisions",
  meeting_challenges: "mom_challenges",
  intel: "project_intel",
};

/* Which layout is this database in? Decided once per page load by a real
   probe, not by assumption. `legacy = true` means pre-move `public` tables. */
let legacy = false;
let probe = null;

const missingSchema = (e) =>
  ["PGRST106", "PGRST205", "42P01"].includes(e?.code) ||
  /does not exist|schema must be one of|could not find the table/i.test(e?.message || "");

export async function ensureLayout(sb) {
  if (!sb) return;
  if (!probe) {
    probe = (async () => {
      try {
        const { error } = await sb.schema("pms").from("workspace").select("key").limit(1);
        if (!error) { legacy = false; return; }            // new layout answers
        if (missingSchema(error)) { legacy = true; return; } // not moved yet
        legacy = false;   // reachable but refused (RLS etc.) → layout exists
      } catch {
        // Network failure: leave the current mode; callers retry anyway.
        probe = null;
      }
    })();
  }
  return probe;
}

/* Rarely needed by hand — flips the mode when a call itself discovers the
   layout changed under us (e.g. the move ran between probe and query). */
export function setLegacyLayout(v) { legacy = !!v; probe = Promise.resolve(); }
export const usingLegacyLayout = () => legacy;
export const isMissingSchemaError = missingSchema;

/* Run a query, and if it fails because the tables are not where this mode
   expects — the move ran mid-session, or was rolled back mid-session — flip
   the mode and run it once more. `run` gets a fresh builder each attempt. */
export async function withLayoutRetry(sb, run) {
  await ensureLayout(sb);
  let out = await run();
  if (out?.error && missingSchema(out.error)) {
    setLegacyLayout(!legacy);
    out = await run();
  }
  return out;
}

/* A query builder for a logical table. Everything that touches Postgres goes
   through here — `tbl(sb, "tasks")` rather than `sb.from("tasks")` — so the
   name and the schema are never written twice. */
export function tbl(sb, name) {
  const at = WHERE[name];
  if (!at) throw new Error(`Unknown table "${name}" — add it to src/lib/tables.js`);
  if (legacy) return sb.from(OLD_NAME[name] || at[1]);
  return sb.schema(at[0]).from(at[1]);
}

/* For error messages and logs: "core.people", not "people". */
export function tableName(name) {
  const at = WHERE[name];
  if (!at) return name;
  return legacy ? `public.${OLD_NAME[name] || at[1]}` : `${at[0]}.${at[1]}`;
}

export const TABLES = WHERE;
