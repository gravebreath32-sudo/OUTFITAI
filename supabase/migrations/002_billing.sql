-- Optional monthly pass billing. Apply only when enabling Razorpay checkout.
create table if not exists public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id text not null unique,
  payment_id text unique,
  amount integer not null check (amount > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status text not null default 'created' check (status in ('created','paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists billing_orders_user_created_idx on public.billing_orders (user_id, created_at desc);

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','plus')),
  status text not null default 'active' check (status in ('active','expired')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.recommendation_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists recommendation_usage_user_created_idx on public.recommendation_usage (user_id, created_at desc);

alter table public.billing_orders enable row level security;
alter table public.user_entitlements enable row level security;
alter table public.recommendation_usage enable row level security;
drop policy if exists "billing owner can read orders" on public.billing_orders;
create policy "billing owner can read orders" on public.billing_orders
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "billing owner can read entitlement" on public.user_entitlements;
create policy "billing owner can read entitlement" on public.user_entitlements
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "recommendation owner can record usage" on public.recommendation_usage;
create policy "recommendation owner can record usage" on public.recommendation_usage
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "recommendation owner can read usage" on public.recommendation_usage;
create policy "recommendation owner can read usage" on public.recommendation_usage
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.billing_orders, public.user_entitlements, public.recommendation_usage from anon;
grant select on public.billing_orders, public.user_entitlements to authenticated;
grant select, insert on public.recommendation_usage to authenticated;
grant all on public.billing_orders, public.user_entitlements to service_role;

