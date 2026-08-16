-- ═══════════════════════════════════════════════════════════════════════════
-- 10-ulm-tool.sql — the ULM portal goes live.
--
-- The schemas (sanction-gate.sql, 01-core.sql, 02-sales.sql, 03-ulm.sql)
-- built the machinery and deliberately left it disconnected:
--     "Deliberately NOT granted yet: execute on ulm.decide(). Grant it to the
--      ULM tool's role when that tool ships, not to every signed-in browser."
-- This file is that tool shipping. It does NOT grant the internals to the
-- browser; it wraps them in portal_* functions that check who is calling
-- (public.is_admin() — superadmin / dept_head in core.people, the common
-- profile table) and exposes only the wrappers.
--
-- Run AFTER: ../sanction-gate.sql → 01-core.sql → 02-sales.sql → 03-ulm.sql
-- Then: Settings → API → Exposed schemas → add `ulm` (alongside core, pms).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists ulm;


-- ═══ 0. WHO IS CALLING ═════════════════════════════════════════════════════
-- Resolve the signed-in auth user to their row in core.people. Profiles are
-- keyed by id = auth.uid() when the person signed up themselves, or linked by
-- auth_id when a PM added them as a resource first.

create or replace function ulm.me() returns uuid
language sql stable security definer set search_path = core, public as $$
  select id from core.people
  where id = auth.uid() or auth_id = auth.uid()
  limit 1;
$$;

create or replace function ulm.require_admin() returns uuid
language plpgsql stable security definer set search_path = core, public as $$
declare v uuid;
begin
  if not public.is_admin() then
    raise exception 'ULM decisions need a superadmin or dept_head profile'
      using errcode = '42501';
  end if;
  select ulm.me() into v;
  return v;
end $$;


-- ═══ 1. THE PROVISIONING RECORD ════════════════════════════════════════════
-- What the Drive side did for a project: the replicated template folder, the
-- process-map sheet with the template links filled in, and the register rows.
-- Drive holds the files; this row holds where they are.

create table if not exists ulm.provisioning (
  project_id          uuid primary key references core.projects(id) on delete cascade,
  project_code        text,
  folder_id           text,
  folder_url          text,
  process_map_url     text,
  templates_linked    int,
  files_copied        int,
  folders_copied      int,
  client_register_url  text,
  project_register_url text,
  status              text not null default 'pending'
                        check (status in ('pending','provisioned','failed','skipped')),
  error               text,
  provisioned_by      uuid,
  provisioned_at      timestamptz,
  updated_at          timestamptz not null default now()
);

alter table ulm.provisioning enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='ulm' and tablename='provisioning' and policyname='provisioning_read') then
    create policy provisioning_read on ulm.provisioning for select to authenticated using (true);
  end if;
end $$;


-- ═══ 2. REQUESTS — raise, accept, reject ═══════════════════════════════════
-- Anyone signed in may RAISE a request for project creation & sanction (that
-- is requirement #1 of this portal — the request does not have to come from
-- the Sales tool). Only ULM admins may DECIDE one.

create or replace function ulm.portal_submit_request(
  p_title   text,
  p_summary text default null,
  p_kind    text default null,           -- odm | boxbuild | product | null
  p_org     uuid default null,           -- core.orgs.id, when the client exists
  p_qty     int  default null,
  p_target  date default null,
  p_value   numeric default null,
  p_urgency text default 'normal'
) returns uuid
language plpgsql security definer set search_path = sales, core, ulm, public as $$
declare v_id uuid; v_by uuid;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a request needs a title';
  end if;
  if p_kind is not null and p_kind not in ('odm','boxbuild','product') then
    raise exception 'kind must be odm, boxbuild or product (got %)', p_kind;
  end if;
  select ulm.me() into v_by;

  insert into sales.requests
    (title, summary, proposed_kind, org_id, qty, target_date, value_inr,
     urgency, status, submitted_by, submitted_at)
  values
    (trim(p_title), p_summary, p_kind, p_org, p_qty, p_target, p_value,
     coalesce(nullif(p_urgency,''), 'normal'), 'submitted', v_by, now())
  returning id into v_id;

  perform core.emit('ulm', 'request', v_id, 'submitted', null, v_by,
                    jsonb_build_object('title', p_title, 'kind', p_kind));
  return v_id;
end $$;

create or replace function ulm.portal_accept_request(
  p_request  uuid,
  p_kind     text,
  p_code     text default null,
  p_name     text default null,
  p_deadline date default null,
  p_note     text default null
) returns core.projects
language plpgsql security definer set search_path = ulm, core, sales, public as $$
declare v_by uuid;
begin
  v_by := ulm.require_admin();
  return ulm.accept_request(p_request, p_kind, p_code, p_name, p_deadline, v_by, p_note);
end $$;

create or replace function ulm.portal_reject_request(
  p_request uuid,
  p_note    text default null
) returns void
language plpgsql security definer set search_path = ulm, core, sales, public as $$
declare v_by uuid; req core.intake;
begin
  v_by := ulm.require_admin();
  select * into req from core.intake where id = p_request;
  if not found then raise exception 'no such request: %', p_request; end if;

  perform sales.settle_request(p_request, 'rejected', null, p_note, v_by);

  insert into ulm.reviews (request_id, proposed_kind, verdict, reviewed_by, reviewed_at, notes)
  values (p_request, req.proposed_kind, 'reject', v_by, now(), p_note);

  perform core.emit('ulm', 'request', p_request, 'rejected', null, v_by,
                    jsonb_build_object('note', p_note));
end $$;


-- ═══ 3. THE DECISION — sanction / unsanction / hold / resume / close ═══════
-- One wrapper over the one door. The guard trigger on core.projects keeps
-- refusing every other path, exactly as before.

create or replace function ulm.portal_decide(
  p_project uuid,
  p_action  text,
  p_kind    text default null,
  p_reason  text default null
) returns core.projects
language plpgsql security definer set search_path = ulm, core, public as $$
declare v_by uuid;
begin
  v_by := ulm.require_admin();
  return ulm.decide(p_project, p_action, p_kind, p_reason, v_by);
end $$;


-- ═══ 4. CLIENTS — create in the common table ═══════════════════════════════
-- core.orgs is the shared client table (was public.clients); the ODM app and
-- this portal both read it. Client codes stay in the app's historical format
-- (<org-size code><industry code>-<seq>, e.g. PL20-001); the Drive register
-- is the allocator of record and this insert refuses a duplicate.

create or replace function ulm.portal_create_client(
  p_client_id text,
  p_name      text,
  p_industry  text default null,
  p_org_size  text default null,
  p_contact   jsonb default null        -- { name, designation, email, phone }
) returns core.orgs
language plpgsql security definer set search_path = core, ulm, public as $$
declare v_by uuid; org core.orgs;
begin
  v_by := ulm.require_admin();
  if coalesce(trim(p_name), '') = '' then raise exception 'a client needs a name'; end if;
  if coalesce(trim(p_client_id), '') = '' then raise exception 'a client needs a Client ID'; end if;
  if exists (select 1 from core.orgs where client_id = trim(p_client_id)) then
    raise exception 'Client ID % already exists', p_client_id;
  end if;

  insert into core.orgs (client_id, name, industry, org_size, kind, active)
  values (trim(p_client_id), trim(p_name), p_industry, p_org_size, 'customer', true)
  returning * into org;

  if p_contact is not null and coalesce(trim(p_contact->>'name'), '') <> '' then
    insert into core.contacts (org_id, name, role, email, phone, is_primary)
    values (org.id, trim(p_contact->>'name'), p_contact->>'designation',
            p_contact->>'email', p_contact->>'phone', true);
  end if;

  perform core.emit('ulm', 'org', org.id, 'created', null, v_by,
                    jsonb_build_object('client_id', org.client_id, 'name', org.name));
  return org;
end $$;


-- ═══ 5. PROJECTS — create, staff, allocate ═════════════════════════════════
-- Creation through ULM is born decided: the portal is the sanctioning tool,
-- so a project it creates is sanctioned into its delivery kind in the same
-- transaction (p_sanction=false parks it as 'requested' instead).

create or replace function ulm.portal_create_project(
  p_code         text,
  p_name         text,
  p_kind         text,                    -- odm | boxbuild | product
  p_desc         text  default null,
  p_client_id    text  default null,      -- the human code, e.g. PL20-001
  p_client_name  text  default null,
  p_industry     text  default null,
  p_org_size     text  default null,
  p_contact      jsonb default null,
  p_deadline     date  default null,
  p_team         jsonb default '[]'::jsonb,   -- [{ slot, userId }]
  p_lld_customer jsonb default null,
  p_lld_designer jsonb default null,
  p_owner        uuid  default null,      -- the PM who takes delivery
  p_sanction     boolean default true,
  p_id_mode      text default 'auto'
) returns core.projects
language plpgsql security definer set search_path = ulm, core, public as $$
declare v_by uuid; proj core.projects; v_org uuid;
begin
  v_by := ulm.require_admin();
  if coalesce(trim(p_code), '') = '' then raise exception 'a project needs a Project ID'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'a project needs a name'; end if;
  if p_kind not in ('odm','boxbuild','product') then
    raise exception 'kind must be odm, boxbuild or product (got %)', p_kind;
  end if;
  if exists (select 1 from core.projects where project_id = trim(p_code)) then
    raise exception 'Project ID % already exists', p_code;
  end if;

  select id into v_org from core.orgs where client_id = p_client_id limit 1;

  insert into core.projects
    (project_id, app_id, id_mode, name, description, client_id, client_name,
     industry, org_size, contact, deadline, status, team,
     lld_customer, lld_designer, sanction_state, kind,
     requested_by, requested_at, org_id, created_by, created_at)
  values
    (trim(p_code), trim(p_code), coalesce(p_id_mode,'auto'), trim(p_name), p_desc,
     p_client_id, p_client_name, p_industry, p_org_size,
     coalesce(p_contact, '{}'::jsonb), p_deadline, 'Planning',
     coalesce(p_team, '[]'::jsonb), p_lld_customer, p_lld_designer,
     'requested', p_kind, v_by, now(), v_org, v_by, now())
  returning * into proj;

  perform ulm.portal_set_team(proj.id, coalesce(p_team, '[]'::jsonb));

  if p_sanction then
    proj := ulm.decide(proj.id, 'sanction', p_kind, 'created and sanctioned in the ULM portal', v_by);
    if p_owner is not null then
      update ulm.allocations set owner_id = p_owner
      where project_id = proj.id and released_at is null;
    end if;
  end if;

  perform core.emit('ulm', 'project', proj.id, 'created', proj.id, v_by,
                    jsonb_build_object('code', proj.project_id, 'kind', p_kind,
                                       'sanctioned', p_sanction));
  return proj;
end $$;

-- Team on a project: the jsonb on core.projects is what the delivery apps
-- read; core.assignments rows are the joinable form core.staffing is built
-- on. This keeps the two in step, the same shape src/lib/tableSync.js writes.
create or replace function ulm.portal_set_team(
  p_project uuid,
  p_team    jsonb                          -- [{ slot, userId }]
) returns void
language plpgsql security definer set search_path = core, ulm, public as $$
declare v_by uuid; proj core.projects; r jsonb; v_uid uuid;
begin
  v_by := ulm.require_admin();
  select * into proj from core.projects where id = p_project;
  if not found then raise exception 'no such project: %', p_project; end if;

  update core.projects set team = coalesce(p_team, '[]'::jsonb) where id = p_project;

  delete from core.assignments where project_app_id = proj.app_id
     or (proj.project_id is not null and app_id like proj.project_id || ':%');

  for r in select * from jsonb_array_elements(coalesce(p_team, '[]'::jsonb)) loop
    if coalesce(r->>'userId', '') = '' then continue; end if;
    begin v_uid := (r->>'userId')::uuid; exception when others then v_uid := null; end;
    insert into core.assignments (app_id, project_app_id, user_app_id, user_id, slot)
    values (proj.project_id || ':' || (r->>'slot'), proj.app_id, r->>'userId', v_uid,
            coalesce(r->>'slot', ''));
  end loop;
end $$;

-- Hand a sanctioned project to its delivery owner (the senior PM).
create or replace function ulm.portal_allocate(
  p_project uuid,
  p_owner   uuid,
  p_note    text default null
) returns void
language plpgsql security definer set search_path = ulm, core, public as $$
declare v_by uuid;
begin
  v_by := ulm.require_admin();
  update ulm.allocations
     set owner_id = p_owner, allocated_by = coalesce(allocated_by, v_by),
         note = coalesce(p_note, note)
   where project_id = p_project and released_at is null;
  if not found then
    raise exception 'project has no live allocation — sanction it first';
  end if;
  perform core.emit('ulm', 'project', p_project, 'allocated', p_project, v_by,
                    jsonb_build_object('owner', p_owner, 'note', p_note));
end $$;


-- ═══ 6. PROVISIONING — record what Drive did ═══════════════════════════════

create or replace function ulm.record_provisioning(
  p_project          uuid,
  p_status           text,
  p_folder_id        text default null,
  p_folder_url       text default null,
  p_process_map_url  text default null,
  p_templates_linked int  default null,
  p_files_copied     int  default null,
  p_folders_copied   int  default null,
  p_client_register  text default null,
  p_project_register text default null,
  p_error            text default null
) returns void
language plpgsql security definer set search_path = ulm, core, public as $$
declare v_by uuid; v_code text;
begin
  v_by := ulm.require_admin();
  select project_id into v_code from core.projects where id = p_project;
  if not found then raise exception 'no such project: %', p_project; end if;
  if p_status not in ('pending','provisioned','failed','skipped') then
    raise exception 'bad provisioning status: %', p_status;
  end if;

  insert into ulm.provisioning as pv
    (project_id, project_code, folder_id, folder_url, process_map_url,
     templates_linked, files_copied, folders_copied,
     client_register_url, project_register_url, status, error,
     provisioned_by, provisioned_at, updated_at)
  values
    (p_project, v_code, p_folder_id, p_folder_url, p_process_map_url,
     p_templates_linked, p_files_copied, p_folders_copied,
     p_client_register, p_project_register, p_status, p_error,
     v_by, case when p_status = 'provisioned' then now() end, now())
  on conflict (project_id) do update set
    folder_id            = coalesce(excluded.folder_id, pv.folder_id),
    folder_url           = coalesce(excluded.folder_url, pv.folder_url),
    process_map_url      = coalesce(excluded.process_map_url, pv.process_map_url),
    templates_linked     = coalesce(excluded.templates_linked, pv.templates_linked),
    files_copied         = coalesce(excluded.files_copied, pv.files_copied),
    folders_copied       = coalesce(excluded.folders_copied, pv.folders_copied),
    client_register_url  = coalesce(excluded.client_register_url, pv.client_register_url),
    project_register_url = coalesce(excluded.project_register_url, pv.project_register_url),
    status               = excluded.status,
    error                = excluded.error,
    provisioned_by       = coalesce(excluded.provisioned_by, pv.provisioned_by),
    provisioned_at       = coalesce(excluded.provisioned_at, pv.provisioned_at),
    updated_at           = now();

  -- Index the two artefacts in core.documents so every tool can find them.
  if p_folder_url is not null then
    insert into core.documents (project_id, project_code, tool_key, kind, title, url, drive_id, uploaded_by)
    select p_project, v_code, 'ulm', 'project-folder', v_code || ' — project folder', p_folder_url, p_folder_id, v_by
    where not exists (select 1 from core.documents
                      where project_id = p_project and kind = 'project-folder');
  end if;
  if p_process_map_url is not null then
    insert into core.documents (project_id, project_code, tool_key, kind, title, url, uploaded_by)
    select p_project, v_code, 'ulm', 'process-map', v_code || ' — process map', p_process_map_url, v_by
    where not exists (select 1 from core.documents
                      where project_id = p_project and kind = 'process-map');
  end if;

  perform core.emit('ulm', 'project', p_project, 'provisioned', p_project, v_by,
                    jsonb_build_object('status', p_status, 'folder', p_folder_url));
end $$;


-- ═══ 7. REVIEW WORKING — scores, risks, resource plan from the portal ══════
-- These tables shipped read-only. The portal writes them, gated on the same
-- admin check, through plain RLS policies (no wrapper needed — no state
-- machine to protect, unlike sanction).

do $$
declare t text;
begin
  foreach t in array array['reviews','risks','resource_plan','work_packages'] loop
    if not exists (select 1 from pg_policies
                   where schemaname='ulm' and tablename=t and policyname=t||'_insert') then
      execute format(
        'create policy %I on ulm.%I for insert to authenticated with check (public.is_admin())',
        t||'_insert', t);
    end if;
    if not exists (select 1 from pg_policies
                   where schemaname='ulm' and tablename=t and policyname=t||'_update') then
      execute format(
        'create policy %I on ulm.%I for update to authenticated using (public.is_admin())',
        t||'_update', t);
    end if;
  end loop;
end $$;

grant usage on schema ulm to authenticated;
grant select on all tables in schema ulm to authenticated;
grant insert, update on ulm.reviews, ulm.risks, ulm.resource_plan, ulm.work_packages
  to authenticated;

-- The wrappers are the browser's only doors. The internals stay revoked.
grant execute on function
  ulm.me(),
  ulm.portal_submit_request(text,text,text,uuid,int,date,numeric,text),
  ulm.portal_accept_request(uuid,text,text,text,date,text),
  ulm.portal_reject_request(uuid,text),
  ulm.portal_decide(uuid,text,text,text),
  ulm.portal_create_client(text,text,text,text,jsonb),
  ulm.portal_create_project(text,text,text,text,text,text,text,text,jsonb,date,jsonb,jsonb,jsonb,uuid,boolean,text),
  ulm.portal_set_team(uuid,jsonb),
  ulm.portal_allocate(uuid,uuid,text),
  ulm.record_provisioning(uuid,text,text,text,text,int,int,int,text,text,text)
to authenticated;

revoke execute on function ulm.require_admin() from public;
-- ulm.decide(), ulm.accept_request(), sales.settle_request() remain revoked
-- from public — reachable only through the wrappers above.


-- ═══ 8. WHAT YOU NOW HAVE ══════════════════════════════════════════════════
-- Reminder: add `ulm` to Settings → API → Exposed schemas (with core and pms)
-- or PostgREST cannot serve any of this to the portal.
select 'requests in inbox'      as what, count(*) from core.intake where status = 'submitted'
union all
select 'projects awaiting sanction', count(*) from core.projects where sanction_state = 'requested'
union all
select 'sanctioned projects',        count(*) from core.projects where is_sanctioned;
