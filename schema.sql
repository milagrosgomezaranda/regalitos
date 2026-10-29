-- Run this in Supabase > SQL Editor before inviting the two accounts.
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  person text not null check (person in ('mami','papi','chunguita')),
  title text not null,
  product_url text,
  image_url text,
  price numeric,
  category text not null check (category in ('barato','mediano','caro','ninguna')),
  priority integer check (priority between 1 and 3),
  notes text,
  occasion text default 'Navidad',
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.allowed_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table public.gifts enable row level security;
alter table public.allowed_users enable row level security;

-- SECURITY DEFINER avoids the allowlist's own RLS blocking the policy check.
create or replace function public.is_allowed_gift_user()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.allowed_users a
    where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_allowed_gift_user() from public;
grant execute on function public.is_allowed_gift_user() to authenticated;

drop policy if exists "approved users can read gifts" on public.gifts;
drop policy if exists "approved users can add gifts" on public.gifts;
drop policy if exists "approved users can edit gifts" on public.gifts;
drop policy if exists "approved users can delete gifts" on public.gifts;

create policy "approved users can read gifts"
on public.gifts for select to authenticated
using (public.is_allowed_gift_user());

create policy "approved users can add gifts"
on public.gifts for insert to authenticated
with check (public.is_allowed_gift_user());

create policy "approved users can edit gifts"
on public.gifts for update to authenticated
using (public.is_allowed_gift_user())
with check (public.is_allowed_gift_user());

create policy "approved users can delete gifts"
on public.gifts for delete to authenticated
using (public.is_allowed_gift_user());

-- Add exactly the two approved auth user IDs after each has signed up:
-- insert into public.allowed_users (user_id) values ('UUID-DE-MAMI'), ('UUID-DE-PAPI');
