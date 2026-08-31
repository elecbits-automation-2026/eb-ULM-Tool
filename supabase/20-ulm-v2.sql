-- ═══ ULM · 20 — THE v2.0 FOUNDATION ═════════════════════════════════════════
-- Schema groundwork for SOP v2.0 (meaning-free EB-FAMILY-YY-nnnn identifiers,
-- deal-before-project, role-gated sanction). Additive: nothing here breaks
-- the running v1 portal — v1 flows retire only when the Phase-1 UI ships.
--
-- Run AFTER 10-ulm-tool.sql (and 11/12/13), in the Supabase SQL editor.

-- ─── 1. Roles ────────────────────────────────────────────────────────────────
-- The SOP separates who may do what: the registrar issues, the PM fills rows,
-- and each sanction-gate condition has its own confirmer. One row per person
-- per role, resolved against core.people like everything else.

create table if not exists ulm.roles (
  person_id  uuid not null,
  role       text not null check (role in
               ('registrar','pm','pm_head','scs','solution_architect','deal_owner')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (person_id, role)
);
alter table ulm.roles enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='roles' and policyname='roles_read') then
    create policy roles_read on ulm.roles for select to authenticated using (true);
  end if;
end $$;
grant select on ulm.roles to authenticated;

create or replace function ulm.has_role(p_role text) returns boolean
language sql stable security definer set search_path = ulm, core, public as $$
  select exists (select 1 from ulm.roles where person_id = ulm.me() and role = p_role)
      or public.is_admin();  -- superadmins hold every role until delegation is real
$$;

create or replace function ulm.require_role(p_role text) returns uuid
language plpgsql stable security definer set search_path = ulm, core, public as $$
declare v uuid;
begin
  v := ulm.me();
  if v is null or not ulm.has_role(p_role) then
    raise exception 'this action needs the % role', p_role;
  end if;
  return v;
end $$;

create or replace function ulm.portal_grant_role(p_person uuid, p_role text) returns void
language plpgsql security definer set search_path = ulm, core, public as $$
declare v_by uuid;
begin
  v_by := ulm.require_admin();
  insert into ulm.roles (person_id, role, granted_by) values (p_person, p_role, v_by)
  on conflict (person_id, role) do nothing;
end $$;

-- ─── 2. Deal links — one deal, three systems ────────────────────────────────
-- The register Deal ID is the identity; this table remembers which
-- sales.deals row and which core.intake request it corresponds to, so the
-- bridge can watch Sales and the gate can settle the request.

create table if not exists ulm.deal_links (
  deal_id        text primary key,          -- EB-C-YY-nnnn-Dss
  client_id      text not null,             -- EB-C-YY-nnnn
  sales_deal_id  uuid,                      -- sales.deals.id, when Sales-born
  intake_request uuid,                      -- sales.requests.id, when raised
  org_id         uuid,                      -- core.orgs.id
  source         text not null default 'portal'
                   check (source in ('portal','xor','sales','sweep')),
  status         text not null default 'Open'
                   check (status in ('Open','Quoted','Negotiation','Won','Lost','Dropped')),
  status_by      uuid,
  status_at      timestamptz,
  po_reference   text,                      -- evidence for Won
  converted_project text,                   -- EB-P-YY-nnnn once converted
  created_by     uuid,
  created_at     timestamptz not null default now()
);
alter table ulm.deal_links enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='deal_links' and policyname='deal_links_read') then
    create policy deal_links_read on ulm.deal_links for select to authenticated using (true);
  end if;
end $$;
grant select on ulm.deal_links to authenticated;

-- Terminal states never reopen (Law 10 / rule 0.4).
create or replace function ulm.guard_deal_terminal() returns trigger
language plpgsql as $$
begin
  if old.status in ('Lost','Dropped') and new.status is distinct from old.status then
    raise exception 'a % deal is terminal — revive with a NEW Deal ID (rule 0.4)', old.status;
  end if;
  return new;
end $$;
drop trigger if exists deal_terminal on ulm.deal_links;
create trigger deal_terminal before update on ulm.deal_links
  for each row execute function ulm.guard_deal_terminal();

-- ─── 3. The sanction gate ───────────────────────────────────────────────────
-- Six conditions per converting deal (Path B swaps 2+3 for the design-pack
-- attestation). Each condition names the ROLE that may confirm it; conversion
-- reads this table inside one transaction and refuses on any gap.

create table if not exists ulm.sanction_gates (
  deal_id      text not null references ulm.deal_links(deal_id) on delete cascade,
  condition_no int  not null check (condition_no between 0 and 5),
  -- 0 deal WON (deal_owner) · 1 signed PO/PI filed (scs) · 2 customer LLD
  -- locked (pm) · 3 designer LLD locked (solution_architect) · 4 one owner
  -- per domain (pm_head) · 5 client registered (registrar)
  path_b       boolean not null default false,   -- 2/3 as design-pack items
  evidence_url text not null default '',
  confirmed_by uuid,
  confirmed_role text,
  confirmed_at timestamptz,
  note         text,
  primary key (deal_id, condition_no)
);
alter table ulm.sanction_gates enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='sanction_gates' and policyname='gates_read') then
    create policy gates_read on ulm.sanction_gates for select to authenticated using (true);
  end if;
end $$;
grant select on ulm.sanction_gates to authenticated;

-- p_path_b marks conditions 2 and 3 as the client design-pack attestation
-- rather than the two locked LLDs. It is a real column, not a note: the
-- conversion refuses a Path B project whose gate does not carry it.
create or replace function ulm.portal_confirm_gate(
  p_deal text, p_condition int, p_evidence text, p_note text default null,
  p_path_b boolean default false
) returns void
language plpgsql security definer set search_path = ulm, core, public as $$
declare
  v_role text := case p_condition
    when 0 then 'deal_owner' when 1 then 'scs' when 2 then 'pm'
    when 3 then 'solution_architect' when 4 then 'pm_head' when 5 then 'registrar' end;
  v_by uuid;
  v_path_b boolean := coalesce(p_path_b, false) and p_condition in (2, 3);
begin
  v_by := ulm.require_role(v_role);
  insert into ulm.sanction_gates as g (deal_id, condition_no, path_b, evidence_url, confirmed_by, confirmed_role, confirmed_at, note)
  values (p_deal, p_condition, v_path_b, coalesce(p_evidence,''), v_by, v_role, now(), p_note)
  on conflict (deal_id, condition_no) do update
    set path_b = excluded.path_b, evidence_url = excluded.evidence_url,
        confirmed_by = excluded.confirmed_by,
        confirmed_role = excluded.confirmed_role, confirmed_at = now(), note = excluded.note;
end $$;

-- ─── 4. Provisioning as a state machine ─────────────────────────────────────
-- Law 6 ordering made inspectable: every identifier walks
-- row_written → folder_created → link_written. A row stuck before
-- link_written is "link debt" and surfaces in the UI.

create table if not exists ulm.id_provisioning (
  identifier  text primary key,             -- any EB-… id
  family      text not null,                -- C|DEAL|P|PCB|BOM|FW|ED|MFG|DEALINPUT|V
  state       text not null default 'row_written'
                check (state in ('row_written','folder_created','link_written','failed')),
  folder_id   text default '',
  folder_url  text default '',
  repo_url    text default '',              -- FW only
  error       text default '',
  updated_at  timestamptz not null default now()
);
alter table ulm.id_provisioning enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='id_provisioning' and policyname='idprov_read') then
    create policy idprov_read on ulm.id_provisioning for select to authenticated using (true);
  end if;
end $$;
grant select on ulm.id_provisioning to authenticated;

create or replace function ulm.record_id_provisioning(
  p_identifier text, p_family text, p_state text,
  p_folder_id text default null, p_folder_url text default null,
  p_repo_url text default null, p_error text default null
) returns void
language plpgsql security definer set search_path = ulm, core, public as $$
begin
  perform ulm.require_admin();
  insert into ulm.id_provisioning as r (identifier, family, state, folder_id, folder_url, repo_url, error, updated_at)
  values (p_identifier, p_family, p_state, coalesce(p_folder_id,''), coalesce(p_folder_url,''), coalesce(p_repo_url,''), coalesce(p_error,''), now())
  on conflict (identifier) do update
    set state = excluded.state,
        folder_id = coalesce(nullif(excluded.folder_id,''), r.folder_id),
        folder_url = coalesce(nullif(excluded.folder_url,''), r.folder_url),
        repo_url = coalesce(nullif(excluded.repo_url,''), r.repo_url),
        error = excluded.error, updated_at = now();
end $$;

-- ─── 5. v2 vocabulary beside v1 (no breakage) ───────────────────────────────
-- v1 kinds (odm|boxbuild|product) stay for the PMS tools; the v2 register
-- Kind vocabulary gets its own column, mapped at conversion time.
alter table core.projects add column if not exists kind_v2 text
  check (kind_v2 is null or kind_v2 in ('RND','RND+MFG','MFG','SCS','INT'));
alter table core.projects add column if not exists source_deal_id text;
alter table core.orgs     add column if not exists eb_client_id text;

comment on function ulm.portal_accept_request is
  'v1 path — accept creates a project directly. Deprecated under SOP v2.0: use portal_triage_request (P1) + portal_convert_deal; sanction happens only at conversion.';

-- The pre-p_path_b signature would otherwise linger and be picked by callers.
drop function if exists ulm.portal_confirm_gate(text, int, text, text);

revoke all on function ulm.has_role(text) from public;
revoke all on function ulm.require_role(text) from public;
revoke all on function ulm.portal_confirm_gate(text, int, text, text, boolean) from public;
revoke all on function ulm.portal_grant_role(uuid, text) from public;
revoke all on function ulm.record_id_provisioning(text, text, text, text, text, text, text) from public;
grant execute on function ulm.has_role(text), ulm.require_role(text),
  ulm.portal_confirm_gate(text, int, text, text, boolean), ulm.portal_grant_role(uuid, text),
  ulm.record_id_provisioning(text, text, text, text, text, text, text) to authenticated;
