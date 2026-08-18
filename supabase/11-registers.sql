-- ═══ ULM · 11 — THE REGISTER MIRROR ═════════════════════════════════════════
-- The two Drive masters — the Centralised Project Tracking Sheet (CPTS) and
-- the Client ID sheet — mirrored into the database so the portal can list,
-- search and join them without a Drive round-trip. The sheets stay the source
-- of truth; "Sync from Drive" on the portal's Registers page refreshes this
-- copy wholesale.
--
-- Run AFTER 10-ulm-tool.sql, in the Supabase SQL editor.

create table if not exists ulm.registers (
  register   text primary key check (register in ('clients','projects','pcbs')),
  headers    jsonb not null default '[]'::jsonb,   -- the sheet's real header row
  sheet_url  text not null default '',
  row_count  int  not null default 0,
  synced_by  uuid,
  synced_at  timestamptz not null default now()
);

create table if not exists ulm.register_rows (
  register text not null references ulm.registers(register) on delete cascade,
  row_no   int  not null,                          -- order as in the sheet
  cells    jsonb not null default '[]'::jsonb,     -- one array per sheet row
  primary key (register, row_no)
);

alter table ulm.registers     enable row level security;
alter table ulm.register_rows enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='ulm' and tablename='registers' and policyname='registers_read') then
    create policy registers_read on ulm.registers for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies
                 where schemaname='ulm' and tablename='register_rows' and policyname='register_rows_read') then
    create policy register_rows_read on ulm.register_rows for select to authenticated using (true);
  end if;
end $$;
grant select on ulm.registers, ulm.register_rows to authenticated;

-- Wholesale replace: the sheet is the truth, the mirror follows it. Admin-only
-- (the same gate as every other portal write).
create or replace function ulm.portal_sync_register(
  p_register text,
  p_headers  jsonb,
  p_rows     jsonb,
  p_url      text default null
) returns int
language plpgsql security definer set search_path = ulm, core, public as $$
declare
  v_by uuid;
  v_n  int;
begin
  v_by := ulm.require_admin();
  if p_register not in ('clients','projects','pcbs') then
    raise exception 'unknown register: %', p_register;
  end if;

  insert into ulm.registers as r (register, headers, sheet_url, synced_by, synced_at)
  values (p_register, coalesce(p_headers, '[]'::jsonb), coalesce(p_url, ''), v_by, now())
  on conflict (register) do update
    set headers   = excluded.headers,
        sheet_url = coalesce(nullif(excluded.sheet_url, ''), r.sheet_url),
        synced_by = excluded.synced_by,
        synced_at = now();

  delete from ulm.register_rows where register = p_register;
  insert into ulm.register_rows (register, row_no, cells)
  select p_register, t.ord::int, t.val
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(val, ord);
  get diagnostics v_n = row_count;

  update ulm.registers set row_count = v_n where register = p_register;
  return v_n;
end $$;

revoke all on function ulm.portal_sync_register(text, jsonb, jsonb, text) from public;
grant execute on function ulm.portal_sync_register(text, jsonb, jsonb, text) to authenticated;
