-- Fulfill a verified 30-day pass atomically. Safe to call from both the
-- checkout verification endpoint and a retried payment.captured webhook.
create or replace function public.fulfill_outfitai_order(
  p_order_id text,
  p_payment_id text,
  p_user_id uuid
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_order public.billing_orders%rowtype;
  active_expiry timestamptz;
  now_at timestamptz := now();
begin
  select * into payment_order
  from public.billing_orders
  where order_id = p_order_id
  for update;

  if not found or payment_order.user_id <> p_user_id then
    raise exception 'Payment order does not belong to this account';
  end if;

  if payment_order.amount <> 14900 or payment_order.currency <> 'INR' then
    raise exception 'Payment order amount is not a valid OutfitAI pass';
  end if;

  if payment_order.status = 'paid' then
    if payment_order.payment_id <> p_payment_id then
      raise exception 'Payment order was already fulfilled by another payment';
    end if;
    select expires_at into active_expiry
    from public.user_entitlements
    where user_id = p_user_id;
    return active_expiry;
  end if;

  update public.billing_orders
  set payment_id = p_payment_id, status = 'paid', paid_at = now_at
  where id = payment_order.id;

  insert into public.user_entitlements (user_id, plan, status, expires_at, updated_at)
  values (p_user_id, 'plus', 'active', now_at + interval '30 days', now_at)
  on conflict (user_id) do update set
    plan = 'plus',
    status = 'active',
    expires_at = greatest(coalesce(public.user_entitlements.expires_at, now_at), now_at) + interval '30 days',
    updated_at = now_at
  returning expires_at into active_expiry;

  return active_expiry;
end;
$$;

revoke all on function public.fulfill_outfitai_order(text, text, uuid) from public, anon, authenticated;
grant execute on function public.fulfill_outfitai_order(text, text, uuid) to service_role;

