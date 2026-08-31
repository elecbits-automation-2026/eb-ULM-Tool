# ULM Portal v2.0 — build plan

Built against **Eb-SOP_Project-Creation-and-ID-Creation_v2.0**,
**Eb-SOP_Project-Setup_v2.0** and **Eb-Master_Register_v2.0.xlsx**
(30 Aug 2026). Projects arrive from either **XOR-Sales** (writes the live
register directly, stops at Status=Open) or the **Sales tool**
(`sales.requests → core.intake`, expects `settle_request()` back).

## One authority per concern

| Concern | Authority |
|---|---|
| Identity (every ID, counter, parent link, folder link) | The live Google **Eb-Master_Register** (native Sheet, pinned by fileId) |
| Workflow (gates, links, decisions, provisioning state, chat) | Supabase `ulm` schema |
| Hands (sheet + Drive writes) | Apps Script web app, called only through the edge-function proxy |

## The four jobs

1. **Deal decision board** — all deals, ULM owns the ladder past Open
   (Quoted → Negotiation → Won | Lost | Dropped, Date Closed, Loss Reason,
   Converted to Project ID). Bridge tasks fire when the Sales tool moves a
   linked deal to won **or** a dead stage.
2. **Sanction gate** — six conditions, each confirmed by its own role
   (Deal Owner, SCS, PM, Solution Architect, PM Head, Registrar). Path B
   swaps LLD conditions for the five-artefact design-pack attestation.
   Conversion is atomic and crash-resumable; both link ends written in one
   sitting; MCMA + quotation + PO + locked LLD PDFs copied into the tree;
   00-Governance generated.
3. **Digital registrar** — allocation *is* the append, under LockService,
   Asia/Kolkata year, per-parent derived sequences, XOR's collision-repair
   convention (earlier row stands, later repairs itself), family P refused
   by the generic allocator, EB-C-26-0000 reserved, blue example rows
   excluded and deleted at cutover.
4. **Provisioning engine** — register row → folder → link-back tracked as a
   state machine; blueprint copies to the right containers; CPTS + SKU +
   GitHub fw-repo recorders; naming-law lint on portal uploads.

## Phases

- **P0 (this commit)** — migration SQL (`supabase/20-ulm-v2.sql`), v2
  registrar engine in `ulm-drive.gs` (locate / validate / allocate),
  edge proxy scaffold (`supabase/functions/ulm-proxy`), this plan.
  V1 flows keep working untouched until P1 ships.
- **P1** — Deals board + deal drawer (Deal Inputs at 0.4, MCMA/quotation
  checklist, Loss Reason, revive-as-new-Dss) + sanction-gate panel +
  `portal_convert_deal` + project provisioning + one-time backlog sweep of
  live sales.deals ≥ rfq (incl. the stranded Won pile).
- **P2** — Path B: MFG runs (stem+frozen qty, one PARENT, Delivered Qty,
  vendor incl. minimal EB-V issuance), Master mapping with rule picker.
- **P3** — Path A: Add Board (PCB → BOM-001 → SKU), Attach Existing Board
  (rule 7.0), Add Firmware (repo + Logic-Sheet gate), Add Enclosure,
  BOM-002+ revisions, rules 0.1–15.0 helper writing its call to
  00-Governance.
- **P4** — all-18-tab mirror with red/orange/yellow re-validation, Vendors
  page, nightly health sweep (dupes, format, reopened terminals, org-name
  dupes, naming lint), sector remap 43→15, sales bridge polling, Assistant
  fed the ten laws.

## Open decisions (owner: Saurav)

1. **Pin the live register** — run the portal's `v2.locate` (Integrations →
   coming in P1; until then run `testLocateRegister` in the Apps Script
   editor) and paste the chosen fileId into `V2.MASTER_REGISTER_ID`.
   Must be the same file XOR's binding points at.
2. **Blue example rows** — approve deletion at cutover (`v2.validate`
   reports them; the allocator refuses to run while they exist).
3. **Eight pending Drive changes** (Setup SOP §13) — land the blueprint
   fixes on the masters before P1 provisioning ships; client folders in
   Eb-07-Sales precede the Storage Map layout.
4. **Roles** — seed `ulm.roles` (registrar, pm, pm_head, scs,
   solution_architect, deal_owner). Registrar defaults to Saurav.
5. **Old wizard retirement** — after P1 ships.

## Upstream contracts

- **XOR**: zero code change. Contract test pins YY timezone, repair
  tiebreak, header names.
- **Sales tool**: freeze `mintClientId` behind a flag; keep raising
  requests; ULM takes over `requests.overtake` writes and calls
  `settle_request('accepted'|'withdrawn'|'rejected')`. `core.orgs` gains
  nullable `eb_client_id`; old `client_id` untouched.
