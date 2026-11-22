-- Prevent distributed login attempts from locking the single owner account.
-- Keep the per-IP/account threshold; remove the account-wide hourly threshold.
create or replace function public.jvault_login_rate_check(p_pair_key text, p_account_key text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pair_count integer;
  v_pair_oldest timestamptz;
  v_now timestamptz := clock_timestamp();
  v_retry integer := 0;
begin
  if p_pair_key is null or length(p_pair_key) <> 64
     or p_account_key is null or length(p_account_key) <> 64 then
    return query select false, 900;
    return;
  end if;

  delete from private.jvault_login_attempts
  where attempted_at < v_now - interval '1 day';

  select count(*)::integer, min(attempted_at)
    into v_pair_count, v_pair_oldest
  from private.jvault_login_attempts
  where pair_key = p_pair_key
    and attempted_at >= v_now - interval '15 minutes';

  if v_pair_count >= 6 then
    v_retry := greatest(v_retry,
      ceil(extract(epoch from (v_pair_oldest + interval '15 minutes' - v_now)))::integer);
  end if;

  return query select (v_retry <= 0), greatest(v_retry, 0);
end;
$function$;

revoke all on function public.jvault_login_rate_check(text, text) from public, anon, authenticated;
grant execute on function public.jvault_login_rate_check(text, text) to service_role;
