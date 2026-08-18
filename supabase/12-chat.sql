-- ═══ ULM · 12 — DATE-WISE CHAT STORAGE ══════════════════════════════════════
-- Every Assistant conversation is stored under its calendar date, per person.
-- The portal writes through ulm.portal_chat_log (identity resolved server-
-- side) and reads back only the caller's own messages.
--
-- Run AFTER 10-ulm-tool.sql, in the Supabase SQL editor.

create table if not exists ulm.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  day        date not null,                 -- the user's local date, from the client
  who        text not null check (who in ('me','ai')),
  text       text not null default '',
  trace      jsonb not null default '[]'::jsonb,   -- the ai's tool calls, for replay
  partial    boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_by_user_day
  on ulm.chat_messages (created_by, day, created_at);

alter table ulm.chat_messages enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname='ulm' and tablename='chat_messages' and policyname='chat_read_own') then
    create policy chat_read_own on ulm.chat_messages
      for select to authenticated using (created_by = ulm.me());
  end if;
end $$;
grant select on ulm.chat_messages to authenticated;

create or replace function ulm.portal_chat_log(
  p_day     date,
  p_who     text,
  p_text    text,
  p_trace   jsonb default '[]'::jsonb,
  p_partial boolean default false
) returns uuid
language plpgsql security definer set search_path = ulm, core, public as $$
declare
  v_by uuid;
  v_id uuid;
begin
  v_by := ulm.me();
  if v_by is null then
    raise exception 'no profile for this login';
  end if;
  if p_who not in ('me','ai') then
    raise exception 'who must be me or ai';
  end if;
  insert into ulm.chat_messages (day, who, text, trace, partial, created_by)
  values (coalesce(p_day, current_date), p_who, coalesce(p_text, ''),
          coalesce(p_trace, '[]'::jsonb), coalesce(p_partial, false), v_by)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function ulm.portal_chat_log(date, text, text, jsonb, boolean) from public;
grant execute on function ulm.portal_chat_log(date, text, text, jsonb, boolean) to authenticated;
