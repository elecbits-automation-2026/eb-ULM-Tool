-- ═══ ULM · 21 — THE v2.0 FLOWS ══════════════════════════════════════════════
-- The decisions the portal makes: triage a sales request, move a deal along
-- its ladder, and convert a WON deal into a sanctioned project with all six
-- gate conditions verified in one transaction.
--
-- The register (Google Sheet) remains the identity authority — these
-- functions record the WORKFLOW and authorise the act; the Apps Script
-- v2.allocate / v2.convert actions do the sheet writing, called through the
-- role-checked ulm-proxy edge function.
--
-- Run AFTER 20-ulm-v2.sql.

-- ─── 1. Triage — a sales request enters ULM (accept ≠ convert) ──────────────
-- Law 10: accepting a request creates NO project. It registers the client and
-- the deal, links the three systems, and leaves the request with ULM. The
-- project appears only when the deal is Won and the gate closes.

create or replace function ulm.portal_triage_request(
  p_request   uuid,                     -- sales.requests.id (via core.intake)
  p_client_id text,                     -- EB-C-YY-nnnn (already allocated in the sheet)
  p_deal_id   text,                     -- EB-C-YY-nnnn-Dss (ditto)
  p_org       uuid   default null,
  p_overtake  text   default 'pending', -- pending | full | semi
  p_note      text   default null
) returns ulm.deal_links
language plpgsql security definer set search_path = ulm, core, sales, public as $$
declare
  v_by uuid;
  v_link ulm.deal_links;
  v_sales_deal uuid;
begin
  v_by := ulm.require_role('registrar');
  if p_client_id !~ '^EB-C-\d{2}-\d{4}$' then
    raise exception 'client id % breaks the format law', p_client_id;
  end if;
  if p_deal_id !~ '^EB-C-\d{2}-\d{4}-D\d{2}$' then
    raise exception 'deal id % breaks the format law', p_deal_id;
  end if;
  if left(p_deal_id, 13) <> p_client_id then
    raise exception 'deal % does not carry client % — a derived id carries its parent in full', p_deal_id, p_client_id;
  end if;

  -- The originating sales deal, when the request came from the sales tool.
  begin
    select d.id into v_sales_deal
    from sales.requests r join sales.deals d on d.id = r.deal_id
    where r.id = p_request;
  exception when others then v_sales_deal := null;
  end;

  insert into ulm.deal_links as l (deal_id, client_id, sales_deal_id, intake_request, org_id, source, created_by)
  values (p_deal_id, p_client_id, v_sales_deal, p_request, p_org, 'sales', v_by)
  on conflict (deal_id) do update
    set intake_request = coalesce(excluded.intake_request, l.intake_request),
        sales_deal_id  = coalesce(excluded.sales_deal_id,  l.sales_deal_id),
        org_id         = coalesce(excluded.org_id,         l.org_id)
  returning * into v_link;

  -- ULM owns the takeover decision from here (sales' own writer is retired).
  begin
    update sales.requests set overtake = p_overtake where id = p_request;
  exception when others then null;
  end;

  -- Stamp the new-scheme client id on the org without touching the old one.
  if p_org is not null then
    update core.orgs set eb_client_id = p_client_id where id = p_org;
  end if;

  perform core.emit('ulm', 'deal', null, 'triaged', null, v_by,
                    jsonb_build_object('deal', p_deal_id, 'client', p_client_id, 'request', p_request, 'note', p_note));
  return v_link;
end $$;

-- ─── 2. The deal ladder ─────────────────────────────────────────────────────
-- Open → Quoted → Negotiation → Won | Lost | Dropped. Won demands a PO
-- reference (gate condition 0's evidence); terminal states are enforced by
-- the trigger in 20-ulm-v2.sql and settle the sales request as withdrawn.

create or replace function ulm.portal_set_deal_status(
  p_deal text, p_status text, p_po_ref text default null, p_reason text default null
) returns ulm.deal_links
language plpgsql security definer set search_path = ulm, core, sales, public as $$
declare v_by uuid; v_link ulm.deal_links;
begin
  v_by := ulm.require_role('deal_owner');
  if p_status not in ('Open','Quoted','Negotiation','Won','Lost','Dropped') then
    raise exception 'unknown deal status %', p_status;
  end if;
  if p_status = 'Won' and coalesce(trim(p_po_ref), '') = '' then
    raise exception 'a WON deal needs its PO reference — that is gate condition 0''s evidence';
  end if;
  if p_status in ('Lost','Dropped') and coalesce(trim(p_reason), '') = '' then
    raise exception 'a % deal needs a loss reason — the row stays forever as pipeline history', p_status;
  end if;

  update ulm.deal_links
     set status = p_status, status_by = v_by, status_at = now(),
         po_reference = coalesce(nullif(trim(p_po_ref), ''), po_reference)
   where deal_id = p_deal
  returning * into v_link;
  if v_link.deal_id is null then raise exception 'deal % is not linked in ULM', p_deal; end if;

  -- Gate condition 0 is confirmed by this very act.
  if p_status = 'Won' then
    insert into ulm.sanction_gates (deal_id, condition_no, evidence_url, confirmed_by, confirmed_role, confirmed_at, note)
    values (p_deal, 0, coalesce(p_po_ref, ''), v_by, 'deal_owner', now(), 'deal marked Won')
    on conflict (deal_id, condition_no) do update
      set evidence_url = excluded.evidence_url, confirmed_by = excluded.confirmed_by,
          confirmed_role = excluded.confirmed_role, confirmed_at = now();
  end if;

  -- A commercially dead deal releases its sales request.
  if p_status in ('Lost','Dropped') and v_link.intake_request is not null then
    begin
      perform sales.settle_request(v_link.intake_request, 'withdrawn', null, p_reason, v_by);
    exception when others then null;
    end;
  end if;

  perform core.emit('ulm', 'deal', null, 'status', null, v_by,
                    jsonb_build_object('deal', p_deal, 'status', p_status, 'reason', p_reason));
  return v_link;
end $$;

-- ─── 3. The gate, read as one verdict ───────────────────────────────────────
create or replace function ulm.gate_state(p_deal text)
returns table (condition_no int, required boolean, confirmed boolean, confirmed_role text, evidence_url text)
language sql stable security definer set search_path = ulm, public as $$
  select c.n,
         true,
         g.confirmed_at is not null,
         g.confirmed_role,
         coalesce(g.evidence_url, '')
    from generate_series(0, 5) as c(n)
    left join ulm.sanction_gates g on g.deal_id = p_deal and g.condition_no = c.n
   order by c.n
$$;

-- ─── 4. Conversion — the one lawful door to a Project ID ────────────────────
-- Called AFTER the Apps Script v2.convert has written the register rows (it
-- mints EB-P and fills both link ends). This records the project in the
-- shared spine, sanctions it through the existing one-door decide(), and
-- settles the originating sales request. All six gate rows are verified here.

create or replace function ulm.portal_convert_deal(
  p_deal       text,
  p_project_id text,                    -- EB-P-YY-nnnn, as minted in the sheet
  p_name       text,
  p_kind_v2    text,                    -- RND | RND+MFG | MFG | SCS | INT
  p_pm         uuid   default null,
  p_deadline   date   default null,
  p_path_b     boolean default false,
  p_desc       text   default null
) returns core.projects
language plpgsql security definer set search_path = ulm, core, sales, public as $$
declare
  v_by uuid; v_link ulm.deal_links; proj core.projects;
  v_missing int; v_kind text; v_org uuid; v_client_name text;
begin
  v_by := ulm.require_role('registrar');
  if p_project_id !~ '^EB-P-\d{2}-\d{4}$' then
    raise exception 'project id % breaks the format law', p_project_id;
  end if;
  if p_kind_v2 not in ('RND','RND+MFG','MFG','SCS','INT') then
    raise exception 'kind must be RND, RND+MFG, MFG, SCS or INT (got %)', p_kind_v2;
  end if;

  select * into v_link from ulm.deal_links where deal_id = p_deal;
  if v_link.deal_id is null then raise exception 'deal % is not linked in ULM', p_deal; end if;
  if v_link.status <> 'Won' then
    raise exception 'rule 0.2: only a WON deal converts — % is %', p_deal, v_link.status;
  end if;

  -- The gate: every condition confirmed, by its own role. Path B swaps 2 and
  -- 3 (the two LLDs) for the design-pack attestation, recorded on the same
  -- rows with path_b = true.
  select count(*) into v_missing
    from generate_series(0, 5) as c(n)
    left join ulm.sanction_gates g on g.deal_id = p_deal and g.condition_no = c.n
   where g.confirmed_at is null;
  if v_missing > 0 then
    raise exception 'the sanction gate is not closed — % of 6 conditions unconfirmed', v_missing;
  end if;
  if p_path_b and not exists (
        select 1 from ulm.sanction_gates where deal_id = p_deal and condition_no in (2,3) and path_b) then
    raise exception 'Path B: conditions 2 and 3 must be recorded as the design-pack attestation';
  end if;

  select id, name into v_org, v_client_name from core.orgs
   where eb_client_id = v_link.client_id or client_id = v_link.client_id limit 1;

  -- v1 kind vocabulary for the delivery tools; v2 kind kept beside it.
  v_kind := case p_kind_v2
              when 'RND' then 'odm' when 'RND+MFG' then 'odm'
              when 'MFG' then 'boxbuild' when 'SCS' then 'boxbuild'
              else 'product' end;

  if exists (select 1 from core.projects where project_id = p_project_id) then
    select * into proj from core.projects where project_id = p_project_id;   -- resumable
  else
    insert into core.projects
      (project_id, app_id, id_mode, name, description, client_id, client_name,
       status, sanction_state, kind, kind_v2, source_deal_id, deadline,
       org_id, requested_by, requested_at, created_by, created_at)
    values
      (p_project_id, p_project_id, 'auto', p_name, p_desc, v_link.client_id, v_client_name,
       'Planning', 'requested', v_kind, p_kind_v2, p_deal, p_deadline,
       v_org, v_by, now(), v_by, now())
    returning * into proj;
  end if;

  if proj.sanction_state <> 'sanctioned' then
    proj := ulm.decide(proj.id, 'sanction', v_kind,
                       'converted from ' || p_deal || ' — six gate conditions verified', v_by);
  end if;
  if p_pm is not null then
    update ulm.allocations set owner_id = p_pm where project_id = proj.id and released_at is null;
  end if;

  update ulm.deal_links set converted_project = p_project_id where deal_id = p_deal;

  if v_link.intake_request is not null then
    begin
      perform sales.settle_request(v_link.intake_request, 'accepted', proj.id,
                                   'sanctioned as ' || p_project_id, v_by);
    exception when others then null;
    end;
  end if;

  perform ulm.record_id_provisioning(p_project_id, 'P', 'row_written');
  perform core.emit('ulm', 'project', proj.id, 'converted', proj.id, v_by,
                    jsonb_build_object('project', p_project_id, 'deal', p_deal, 'kind', p_kind_v2));
  return proj;
end $$;

-- ─── 5. Grants ──────────────────────────────────────────────────────────────
revoke all on function ulm.portal_triage_request(uuid, text, text, uuid, text, text) from public;
revoke all on function ulm.portal_set_deal_status(text, text, text, text) from public;
revoke all on function ulm.portal_convert_deal(text, text, text, text, uuid, date, boolean, text) from public;
revoke all on function ulm.gate_state(text) from public;
grant execute on function
  ulm.portal_triage_request(uuid, text, text, uuid, text, text),
  ulm.portal_set_deal_status(text, text, text, text),
  ulm.portal_convert_deal(text, text, text, text, uuid, date, boolean, text),
  ulm.gate_state(text)
  to authenticated;

-- ─── 6. Bridge tasks — what the sales watcher asks a human to do ────────────
-- The bridge never writes the deal ladder (the two vocabularies don't map
-- 1:1 and the SOP makes it the Deal Owner's act); it records that someone
-- must look. One open task per deal per kind.

create table if not exists ulm.bridge_tasks (
  deal_id  text not null,
  kind     text not null check (kind in ('won','lost')),
  message  text not null default '',
  seen     boolean not null default false,
  seen_by  uuid,
  noticed_at timestamptz not null default now(),
  primary key (deal_id, kind)
);
alter table ulm.bridge_tasks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='bridge_tasks' and policyname='bridge_read') then
    create policy bridge_read on ulm.bridge_tasks for select to authenticated using (true);
  end if;
end $$;
grant select on ulm.bridge_tasks to authenticated;

create or replace function ulm.portal_clear_bridge_task(p_deal text, p_kind text)
returns void language plpgsql security definer set search_path = ulm, core, public as $$
declare v_by uuid;
begin
  v_by := ulm.require_admin();
  update ulm.bridge_tasks set seen = true, seen_by = v_by where deal_id = p_deal and kind = p_kind;
end $$;
revoke all on function ulm.portal_clear_bridge_task(text, text) from public;
grant execute on function ulm.portal_clear_bridge_task(text, text) to authenticated;
