-- JVault login abuse protection. All login attempt data stays in a non-API schema.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.jvault_login_attempts (
  id bigint generated always as identity primary key,
  pair_key text not null,
  account_key text not null,
  attempted_at timestamptz not null default now()
);
create index if not exists jvault_login_attempts_pair_time_idx
  on private.jvault_login_attempts (pair_key, attempted_at desc);
create index if not exists jvault_login_attempts_account_time_idx
  on private.jvault_login_attempts (account_key, attempted_at desc);

create or replace function public.jvault_login_rate_check(p_pair_key text, p_account_key text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_pair_count integer;
  v_pair_oldest timestamptz;
  v_account_count integer;
  v_account_oldest timestamptz;
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
  where pair_key = p_pair_key and attempted_at >= v_now - interval '15 minutes';
  select count(*)::integer, min(attempted_at)
    into v_account_count, v_account_oldest
  from private.jvault_login_attempts
  where account_key = p_account_key and attempted_at >= v_now - interval '1 hour';
  if v_pair_count >= 6 then
    v_retry := greatest(v_retry,
      ceil(extract(epoch from (v_pair_oldest + interval '15 minutes' - v_now)))::integer);
  end if;
  if v_account_count >= 20 then
    v_retry := greatest(v_retry,
      ceil(extract(epoch from (v_account_oldest + interval '1 hour' - v_now)))::integer);
  end if;
  return query select (v_retry <= 0), greatest(v_retry, 0);
end;
$function$;

create or replace function public.jvault_login_rate_record(
  p_pair_key text, p_account_key text, p_succeeded boolean
)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  if p_pair_key is null or length(p_pair_key) <> 64
     or p_account_key is null or length(p_account_key) <> 64 then
    return;
  end if;
  if coalesce(p_succeeded, false) then
    delete from private.jvault_login_attempts
    where pair_key = p_pair_key or account_key = p_account_key;
  else
    insert into private.jvault_login_attempts (pair_key, account_key)
    values (p_pair_key, p_account_key);
  end if;
end;
$function$;

revoke all on function public.jvault_login_rate_check(text, text) from public, anon, authenticated;
revoke all on function public.jvault_login_rate_record(text, text, boolean) from public, anon, authenticated;
grant execute on function public.jvault_login_rate_check(text, text) to service_role;
grant execute on function public.jvault_login_rate_record(text, text, boolean) to service_role;
