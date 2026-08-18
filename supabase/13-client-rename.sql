-- ═══ ULM · 13 — RENAME A CLIENT EVERYWHERE IN THE DATABASE ══════════════════
-- One call fixes core.orgs and every core.projects row carrying the old name.
-- The portal pairs it with registry.update on the Drive side, so a rename
-- lands in the DB and both sheets together.
--
-- Run AFTER 10-ulm-tool.sql, in the Supabase SQL editor.

create or replace function ulm.portal_rename_client(
  p_client_id text,
  p_name      text
) returns void
language plpgsql security definer set search_path = ulm, core, public as $$
declare
  v_by uuid;
begin
  v_by := ulm.require_admin();
  if coalesce(trim(p_name), '') = '' then
    raise exception 'the new name cannot be empty';
  end if;
  update core.orgs set name = trim(p_name) where client_id = trim(p_client_id);
  if not found then
    raise exception 'no client with id %', p_client_id;
  end if;
  update core.projects set client_name = trim(p_name) where client_id = trim(p_client_id);
end $$;

revoke all on function ulm.portal_rename_client(text, text) from public;
grant execute on function ulm.portal_rename_client(text, text) to authenticated;
