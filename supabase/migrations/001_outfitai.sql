-- Run in Supabase SQL Editor. All personal records and images are private per user.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  preferences jsonb not null default '{"styles":["Minimalist"],"colors":["Black","Cream"],"occasions":["Everyday"]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_outfitai_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists outfitai_auth_user_created on auth.users;
create trigger outfitai_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_outfitai_profile();

create table if not exists public.wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  category text not null check (category in ('Tops','Bottoms','Dresses','Outerwear','Shoes','Accessories','Bags')),
  color text not null default 'Unspecified',
  style text not null default 'Everyday',
  season text not null default 'All season',
  occasion text not null default 'Everyday',
  brand text not null default '',
  image_path text,
  favorite boolean not null default false,
  wears integer not null default 0 check (wears >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists wardrobe_items_user_created_idx on public.wardrobe_items (user_id, created_at desc);

create table if not exists public.saved_outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  score integer not null default 0 check (score between 0 and 100),
  why text not null default '',
  color_note text not null default '',
  tip text not null default '',
  occasion text not null default 'Everyday',
  weather text not null default 'Not specified',
  saved_at timestamptz not null default now(),
  unique (user_id, id)
);
create index if not exists saved_outfits_user_saved_idx on public.saved_outfits (user_id, saved_at desc);

create table if not exists public.outfit_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_id uuid not null,
  item_id uuid not null,
  primary key (outfit_id, item_id),
  foreign key (user_id, outfit_id) references public.saved_outfits (user_id, id) on delete cascade,
  foreign key (user_id, item_id) references public.wardrobe_items (user_id, id) on delete cascade
);
create index if not exists outfit_items_user_idx on public.outfit_items (user_id);

create table if not exists public.outfit_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_id uuid not null,
  title text not null default 'Planned outfit',
  date date not null,
  occasion text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  foreign key (user_id, outfit_id) references public.saved_outfits (user_id, id) on delete cascade
);
create index if not exists outfit_plans_user_date_idx on public.outfit_plans (user_id, date);

alter table public.profiles enable row level security;
alter table public.wardrobe_items enable row level security;
alter table public.saved_outfits enable row level security;
alter table public.outfit_items enable row level security;
alter table public.outfit_plans enable row level security;

drop policy if exists "profile owner can read" on public.profiles;
create policy "profile owner can read" on public.profiles for select to authenticated using (id = (select auth.uid()));
drop policy if exists "profile owner can update" on public.profiles;
create policy "profile owner can update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "wardrobe owner access" on public.wardrobe_items;
create policy "wardrobe owner access" on public.wardrobe_items for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "saved outfit owner access" on public.saved_outfits;
create policy "saved outfit owner access" on public.saved_outfits for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "outfit item owner access" on public.outfit_items;
create policy "outfit item owner access" on public.outfit_items for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "plan owner access" on public.outfit_plans;
create policy "plan owner access" on public.outfit_plans for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.profiles, public.wardrobe_items, public.saved_outfits, public.outfit_items, public.outfit_plans from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.wardrobe_items, public.saved_outfits, public.outfit_items, public.outfit_plans to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 5000000, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = 5000000, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "wardrobe images owner read" on storage.objects;
create policy "wardrobe images owner read" on storage.objects for select to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "wardrobe images owner upload" on storage.objects;
create policy "wardrobe images owner upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "wardrobe images owner update" on storage.objects;
create policy "wardrobe images owner update" on storage.objects for update to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "wardrobe images owner delete" on storage.objects;
create policy "wardrobe images owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);
