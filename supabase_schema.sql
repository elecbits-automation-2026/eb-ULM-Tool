-- ============================================================
-- Partnership & Sales — Supabase schema
-- Run this once in your Supabase project's SQL Editor.
-- (Project: ogfonkaeucojbqutrorc.supabase.co)
--
-- Open-access RLS for now: anyone with the anon key can read/
-- write. When you want to scope per user/org, replace the open
-- policies at the bottom with auth.uid()-based ones.
--
-- This script is idempotent — safe to re-run.
-- ============================================================

-- Make sure pgcrypto is available for gen_random_uuid()
create extension if not exists pgcrypto;

-- ============================================================
-- TABLES
-- ============================================================
create table if not exists public.partners (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  relationship_since  date,
  products            text[]   default '{}',
  priorities          jsonb    default '[]'::jsonb,   -- [{text, level: 'high'|'medium'|'low'}]
  size_unit           text     check (size_unit  in ('thousands','lakhs','crores')),
  size_value          numeric(14,2),
  volume_unit         text     check (volume_unit in ('thousands','lakhs')),
  volume_value        numeric(14,2),
  captain             text,
  spoc_name           text,
  spoc_designation    text,
  spoc_email          text,
  spoc_phone_country  text,
  spoc_phone          text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create table if not exists public.partner_tasks (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete cascade,
  title           text not null,
  subtasks        jsonb   default '[]'::jsonb,        -- [{text, done}]
  start_date      date,
  end_date        date,
  assignee        text,
  description     text,
  attachment_name text,
  attachment_path text,                                -- key in storage bucket
  created_at      timestamptz default now()
);
create index if not exists partner_tasks_partner_idx on public.partner_tasks(partner_id);

create table if not exists public.partner_emails (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,
  date        date,
  subject     text,
  body        text,
  from_addr   text,
  to_addr     text,
  created_at  timestamptz default now()
);
create index if not exists partner_emails_partner_idx on public.partner_emails(partner_id);

create table if not exists public.partner_moms (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.partners(id) on delete cascade,
  date          date,
  heading       text,
  attendees     text,
  agenda        text,
  notes         text,
  action_items  jsonb default '[]'::jsonb,   -- [{text, assignee, done}]
  created_at    timestamptz default now()
);
create index if not exists partner_moms_partner_idx on public.partner_moms(partner_id);

-- One-time migration: if action_items was previously a text column, convert it
-- to jsonb, wrapping any pre-existing string into a single checklist item.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_moms'
      and column_name = 'action_items' and data_type = 'text'
  ) then
    alter table public.partner_moms
      alter column action_items drop default,
      alter column action_items type jsonb
        using case
          when action_items is null or btrim(action_items) = '' then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object('text', action_items, 'assignee', '', 'done', false))
        end,
      alter column action_items set default '[]'::jsonb;
  end if;
end $$;

-- ============================================================
-- STORAGE BUCKET (for task attachments)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('partnership-attachments','partnership-attachments', true)
on conflict (id) do nothing;

-- ============================================================
-- RLS — open access for now (anon key can read+write)
-- Replace these with auth.uid() policies later to lock down.
-- ============================================================
alter table public.partners        enable row level security;
alter table public.partner_tasks   enable row level security;
alter table public.partner_emails  enable row level security;
alter table public.partner_moms    enable row level security;

drop policy if exists partners_open        on public.partners;
drop policy if exists partner_tasks_open   on public.partner_tasks;
drop policy if exists partner_emails_open  on public.partner_emails;
drop policy if exists partner_moms_open    on public.partner_moms;

create policy partners_open       on public.partners       for all to anon, authenticated using (true) with check (true);
create policy partner_tasks_open  on public.partner_tasks  for all to anon, authenticated using (true) with check (true);
create policy partner_emails_open on public.partner_emails for all to anon, authenticated using (true) with check (true);
create policy partner_moms_open   on public.partner_moms   for all to anon, authenticated using (true) with check (true);

-- Storage bucket: open read + write for anon
-- Drop ALL four policies (read/write/update/delete) before re-creating —
-- earlier versions of this file only dropped two, which is what caused
-- "policy partnership_attachments_update for table objects already exists".
drop policy if exists partnership_attachments_read    on storage.objects;
drop policy if exists partnership_attachments_write   on storage.objects;
drop policy if exists partnership_attachments_update  on storage.objects;
drop policy if exists partnership_attachments_delete  on storage.objects;

create policy partnership_attachments_read    on storage.objects for select to anon, authenticated using  (bucket_id = 'partnership-attachments');
create policy partnership_attachments_write   on storage.objects for insert to anon, authenticated with check (bucket_id = 'partnership-attachments');
create policy partnership_attachments_update  on storage.objects for update to anon, authenticated using  (bucket_id = 'partnership-attachments') with check (bucket_id = 'partnership-attachments');
create policy partnership_attachments_delete  on storage.objects for delete to anon, authenticated using  (bucket_id = 'partnership-attachments');
