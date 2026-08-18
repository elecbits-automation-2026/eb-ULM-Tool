# Elecbits ULM — Project Portal

The gate of the Elecbits tool family: **project acceptance, sanction, allocation
& architecture**. Sales (or anyone signed in) raises a request; ULM reviews it,
**sanctions** it, and routes it to exactly one delivery tool — **ODM, Box Build
or Product**. This portal is that tool.

Same Supabase as the ODM PMS, same UI/UX, its own Vercel deployment.

> Built with React + Vite. Zero-config demo mode: with no env vars set the
> portal boots on seeded local data so every flow works end-to-end.

---

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
```

## The six modules

1. **Sanction Inbox** — requests for project creation & sanction
   (`core.intake`, ULM's view over `sales.requests`, plus anything a delivery
   tool raised that sits in `sanction_state='requested'`). Score the four
   review questions (feasibility · capacity · commercial · strategic), then
   **Accept** (pick ODM / Box Build / Product → project created, sanctioned and
   routed in one transaction via `ulm.accept_request`), **Reject**, or ask for
   more info. Anyone can **raise** a request; only superadmin / dept_head
   profiles can decide.

2. **Create a Project** *(admin only)* — the chat wizard carried from the ODM
   tool, extended with the ULM bifurcation step:
   client lookup → Client ID (org-size + industry codes, e.g. `PL20-001`) →
   contact → project name → **delivery route (ODM / Box Build / Product)** →
   deadline → Project ID (`EbZ-<ClientID>-NN` auto, or manual) → team
   allocation (PM mandatory; the Senior PM becomes delivery owner) →
   **Customer LLD** (guided questionnaire or upload) → **Designer LLD** (AI or
   manual) → review → **Create & provision**. Three hard gates — Project ID and
   both LLDs — keep Create locked until green.

3. **Projects** — every project in every state, with the sanction pill, the
   delivery-tool routing, deadline countdowns, the **append-only sanction
   ledger**, decide actions (sanction / un-sanction / hold / resume / re-route
   / close / reopen — all through `ulm.decide()`, the one door), team editing,
   and Drive provisioning with retry.

4. **Allocation** — hand each sanctioned project to its delivery owner (the
   senior PM) — `ulm.allocations.owner_id` — with a roster-load view built on
   the common profile table.

5. **Clients** — the shared client table (`core.orgs`) with the historical
   Client-ID scheme and the Drive-side register.

6. **Integrations** — Supabase / Drive / AI status, visible seams, setup notes.

## What "create & provision" actually does

| Step | Where |
|---|---|
| Client ID minted (`<size><industry>-<seq>`) and appended to the **Client-ID register** | Google Drive (backend file) |
| Project ID minted (`EbZ-<ClientID>-NN`) and appended to the **Project-ID register** | Google Drive (backend file) |
| Client row | `core.orgs` (+ primary contact in `core.contacts`) |
| Project row, born sanctioned & routed | `core.projects` via `ulm.portal_create_project` → `ulm.decide()` |
| Team | `core.projects.team` jsonb **and** `core.assignments` rows (what `core.staffing` reads) |
| **Project-ID (PM) template folder replicated** into the Project Management area, renamed to the Project ID | Google Drive |
| **Template links written into the process-map sheet** inside the new folder (matched by `EB-T-nnn` Template ID against the eb-templates library) | Google Drive |
| Folder + process-map indexed | `core.documents`, `ulm.provisioning` |

And per board, from the project page (PCB IDs are assigned once the Designer
LLD fixes the board count — process step 8):

| Step | Where |
|---|---|
| PCB ID appended to the **PCB-ID register** | Google Drive (backend file) |
| **PCB-ID (engineering) template folder replicated** into the PCB & Firmware area, renamed to the PCB ID | Google Drive |
| PCB folder recorded against the project | `ulm.provisioning.pcb_folders`, `core.documents` |

Every Drive step degrades gracefully: unconfigured, it is recorded as a
pending seam and can be retried from the project page once the backend is up.

---

## Turn on the live services

### 1. Supabase (the same project as the ODM PMS)

The database side is already built by the ODM repo's schema files
(`sanction-gate.sql` → `01-core.sql` → `02-sales.sql` → `03-ulm.sql`). Then:

1. **SQL editor** → run [`supabase/10-ulm-tool.sql`](supabase/10-ulm-tool.sql).
   It ships the portal's `SECURITY DEFINER` wrappers (`ulm.portal_*`) gated on
   `public.is_admin()`, the `ulm.provisioning` table, and write policies for
   reviews / risks / resource plans. `ulm.decide()` and `sales.settle_request()`
   stay revoked from the browser — reachable only through the wrappers.
2. **Settings → API → Exposed schemas** → add **`ulm`** (keep `core`, `pms`).
3. Copy Project URL + anon key into the env (locally `.env`, on Vercel →
   Environment Variables):

   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```

Login is Supabase email/password; the roster comes from **`core.people`** — the
common profile table every Elecbits tool reads. Who may *decide* is fixed by
the signed-in person's own role (superadmin / dept_head), not by the view-as
switcher.

### 2. Google Drive — the ID registers & folder provisioning

1. [script.google.com](https://script.google.com) → New project → paste
   [`google-apps-script/ulm-drive.gs`](google-apps-script/ulm-drive.gs).
2. Set `SHARED_TOKEN` to a long random string. The five folder IDs are already
   filled in with the live Elecbits folders:

   | CONFIG key | Folder |
   |---|---|
   | `REGISTRY_FOLDER_ID` | Eb-Central-ULM |
   | `PROJECT_TEMPLATE_FOLDER_ID` | 01-Project-ID-Folder-PM-Template folder- 16-8-26 |
   | `PROJECTS_PARENT_FOLDER_ID` | Project Management - Project Managers |
   | `PCB_TEMPLATE_FOLDER_ID` | Eb-PCB & Firmware and Enclosure - template folder |
   | `PCB_PARENT_FOLDER_ID` | Eb-PCB & Firmware and Enclosure |

   `TEMPLATES_LIBRARY_FOLDER_ID` stays blank: the `EB-T-nnn` files already sit
   inside the template tree, so the process map links to the project's **own**
   copies, which is what a PM actually wants to click.

   **The registers need one decision.** `Eb-Client ID Sheet` and
   `Eb-Centralised Project Tracking Sheet` are uploaded `.xlsx` files, and no
   script can append a row to an `.xlsx` — only to a Google Sheet. So the
   script refuses rather than touching your master. Pick one:
   - open each → *File → Save as Google Sheets* → put the **new** file ids in
     `CLIENT_REGISTER_ID` / `PROJECT_REGISTER_ID` (recommended), or
   - set `AUTO_CONVERT_REGISTERS: true` and let it convert once (the `.xlsx`
     is kept, parked in `99-Source-Files`), or
   - leave the ids blank and it creates fresh registers in Eb-Central-ULM.

   Rows are appended by **matching your existing header names** (with aliases,
   e.g. "Company"/"Name of the Client" → Client Name), never by a fixed column
   order, and columns the portal doesn't know about are left alone. Verify the
   mapping before the first real project — it writes nothing:
   `…/exec?action=registry.check&token=YOUR_TOKEN`, or **Integrations → Check
   the registers** in the portal.
3. Deploy → Web app → *Execute as: Me* · *Access: Anyone* → copy the `/exec`
   URL.
4. Set:

   ```
   VITE_ULM_DRIVE_URL=<the /exec URL>
   VITE_ULM_DRIVE_TOKEN=<the same SHARED_TOKEN>
   ```

The script owns two register sheets (created on first use): the
**Client-ID-Register** and the **Project-ID-Register** — the "backend files"
of record for both IDs. `project.provision` copies the template tree, renames
it to the Project ID, finds the process-map sheet inside the copy and fills
its *Template Link* column with links to the canonical templates, matched by
Template ID.

### 3. Claude — the wizard's brain (optional)

With AI on, the wizard is genuinely conversational — every typed message is
read by Claude against the pending step, so greetings, questions and answers
in your own words all land sensibly ("they're a small startup" picks the org
size; "which route is for assembly-only?" gets a real answer). On top of
that: industry/org-size suggestions from the company name, a pasted client
brief fanned out across the 21-question customer LLD, and the Designer LLD
drafted with full project context. The wizard header shows a **Claude on/off**
pill with the reason, so a mis-configured backend is never silent.

The **Assistant** page (admin-only) is Claude with Drive hands: an agentic
tool loop running server-side in the web app — `drive_search`, `drive_list`,
`drive_read` (Docs/Sheets/text), `drive_write` (Google Docs) and
`register_read`. Ask it to find a project's LLD, summarise a process map, or
draft kickoff notes straight into the project folder; every tool call is shown
under the reply. First run after updating the script asks for one extra
Google permission (Docs) — approve it once.

Everything still works without AI — templates and manual entry take over.

The key never ships to the browser. Two server-side routes — the portal
prefers Supabase when configured and falls back to the Apps Script:

- **Supabase Edge Functions** (`supabase/functions/claude-ulm` +
  `supabase/functions/claude-ulm-agent` — the `-ulm` suffix keeps them clear
  of the ODM app's own `claude` function). The Anthropic key lives in Supabase
  secrets; `claude-ulm-agent` runs the Assistant's tool loop and borrows the
  Drive web app's hands via its `tool.run` action.

  ```
  supabase functions deploy claude-ulm claude-ulm-agent
  supabase secrets set ANTHROPIC_API_KEY=sk-ant-…
  supabase secrets set ULM_DRIVE_URL=https://script.google.com/macros/s/…/exec
  supabase secrets set ULM_DRIVE_TOKEN=…            # the SHARED_TOKEN
  ```

  (Dashboard route: Edge Functions → *Deploy new function*, named exactly
  `claude-ulm` / `claude-ulm-agent` → paste each `index.ts`, then Edge
  Functions → *Secrets* for the three values. Keep JWT verification ON — the
  portal sends its anon key automatically.)

  Then in Vercel: `VITE_CLAUDE_PROXY_URL=https://<project-ref>.functions.supabase.co/claude-ulm`.
  The agent URL is derived by appending `-agent`; override with
  `VITE_CLAUDE_AGENT_URL` only if you name it differently.

- **Drive web app only (no Supabase needed).** In the Apps Script project:
  ⚙ *Project Settings → Script properties → Add* → `ANTHROPIC_API_KEY`, then
  *Deploy → Manage deployments → ✏️ → New version → Deploy*. Leave
  `VITE_CLAUDE_PROXY_URL` unset and everything — chat and the agent — runs
  through the web app instead.

Model defaults to `claude-opus-5` (override with `VITE_CLAUDE_MODEL`, or
`AI_MODEL` in the Apps Script CONFIG).

### 4. Vercel

Import this repo into a **new Vercel project** (its own link, separate from the
ODM app), framework preset *Vite*, add the env vars, deploy. `vercel.json` is
already in place.

---

## Repo layout

```
src/
  App.jsx            shell: auth ladder, sidebar, topbar, module switch
  data.jsx           data layer: Supabase (rpc wrappers) ⇄ seeded demo mode
  ui.jsx             the design system (verbatim from the ODM app)
  constants.js       theme, ID code tables, slots, kinds, LLD questionnaire
  modules/           Inbox · Wizard · Projects · Allocation · Clients · Registers · Assistant · Integrations
  lib/
    supabase.js      client init (same robust env handling as the ODM app)
    tables.js        logical-name → schema.table map (+ ulm.* additions)
    auth.js          login / profiles from core.people
    ulmDrive.js      the Drive provisioning seam
    ai.js            the Claude seam
supabase/
  10-ulm-tool.sql    the portal's migration — run after the ODM schema files
  11-registers.sql   the register mirror (CPTS + Client ID sheet → ulm.registers)
google-apps-script/
  ulm-drive.gs       the Drive backend web app
legacy/              the earlier static dashboards this repo used to hold
```
