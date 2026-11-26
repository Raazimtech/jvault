alter table public.jvault_profiles add column if not exists role text not null default 'user';
alter table public.jvault_profiles drop constraint if exists jvault_profiles_role_check;
alter table public.jvault_profiles add constraint jvault_profiles_role_check check (role in ('admin','user'));
update public.jvault_profiles set role='admin' where user_id='dc93274c-7b26-41e1-879e-b896a5a45e48';
alter table public.jvault_files add column if not exists group_id uuid, add column if not exists expires_at timestamptz, add column if not exists expiry_notice_sent_at timestamptz;
update public.jvault_files set expires_at=now()+interval '7 days' where expires_at is null;
alter table public.jvault_files alter column expires_at set default (now()+interval '7 days');
alter table public.jvault_files alter column expires_at set not null;
create table if not exists public.jvault_groups(id uuid primary key default gen_random_uuid(),name text not null check(char_length(trim(name)) between 2 and 60),created_by uuid not null references auth.users(id) on delete cascade,created_at timestamptz not null default now());
create index if not exists jvault_groups_creator_idx on public.jvault_groups(created_by);
create table if not exists public.jvault_group_members(group_id uuid not null references public.jvault_groups(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,member_role text not null default 'member' check(member_role in ('owner','member')),created_at timestamptz not null default now(),primary key(group_id,user_id));
create index if not exists jvault_group_members_user_idx on public.jvault_group_members(user_id,group_id);
alter table public.jvault_files drop constraint if exists jvault_files_group_id_fkey;
alter table public.jvault_files add constraint jvault_files_group_id_fkey foreign key(group_id) references public.jvault_groups(id) on delete set null;
create index if not exists jvault_files_group_expiry_idx on public.jvault_files(group_id,expires_at);
alter table public.jvault_groups enable row level security; alter table public.jvault_group_members enable row level security;
create policy jvault_groups_read_member on public.jvault_groups for select to authenticated using(created_by=(select auth.uid()) or exists(select 1 from public.jvault_group_members gm where gm.group_id=id and gm.user_id=(select auth.uid())));
create policy jvault_groups_create_self on public.jvault_groups for insert to authenticated with check(created_by=(select auth.uid()));
create policy jvault_groups_owner_update on public.jvault_groups for update to authenticated using(created_by=(select auth.uid())) with check(created_by=(select auth.uid()));
create policy jvault_groups_owner_delete on public.jvault_groups for delete to authenticated using(created_by=(select auth.uid()));
create policy jvault_group_members_read_self on public.jvault_group_members for select to authenticated using(user_id=(select auth.uid()));
-- Membership mutations are performed only by the authenticated Edge Function using the service role.
drop policy if exists "JVault owners manage their file records" on public.jvault_files;
create policy jvault_files_select_owner_or_group on public.jvault_files for select to authenticated using(owner_id=(select auth.uid()) or (group_id is not null and exists(select 1 from public.jvault_group_members gm where gm.group_id=jvault_files.group_id and gm.user_id=(select auth.uid()))));
create policy jvault_files_insert_owner on public.jvault_files for insert to authenticated with check(owner_id=(select auth.uid()) and (group_id is null or exists(select 1 from public.jvault_group_members gm where gm.group_id=jvault_files.group_id and gm.user_id=(select auth.uid()))));
create policy jvault_files_update_owner on public.jvault_files for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()) and (group_id is null or exists(select 1 from public.jvault_group_members gm where gm.group_id=jvault_files.group_id and gm.user_id=(select auth.uid()))));
create policy jvault_files_delete_owner on public.jvault_files for delete to authenticated using(owner_id=(select auth.uid()));
drop policy if exists "JVault users read own objects" on storage.objects;
create policy "JVault users read own or group objects" on storage.objects for select to authenticated using(bucket_id='jvault-private' and ((storage.foldername(name))[1]=(select auth.uid())::text or exists(select 1 from public.jvault_files f join public.jvault_group_members gm on gm.group_id=f.group_id where f.storage_path=storage.objects.name and gm.user_id=(select auth.uid()) and f.deleted_at is null and f.expires_at>now())));

-- Preserve existing vault contents for one final seven-day download window.
update public.jvault_files set expires_at=now()+interval '7 days', expiry_notice_sent_at=null where expires_at <= now();

-- Independent secret for scheduled maintenance; it is separate from push-notification setup.
create table if not exists public.jvault_system_config (
  id smallint primary key default 1 check (id = 1),
  dispatch_secret text not null default encode(gen_random_bytes(32),'hex'),
  created_at timestamptz not null default now()
);
alter table public.jvault_system_config enable row level security;
insert into public.jvault_system_config(id) values (1) on conflict (id) do nothing;
select cron.unschedule(jobid) from cron.job where command like '%jvault/push-dispatch%';
select cron.schedule('jvault-maintenance','* * * * *',$job$
  select net.http_post(
    url := 'https://dpiwdhtbhwjgatvcfkcb.supabase.co/functions/v1/jvault/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_PSZnTEo74jObih_6TTpXVQ_tJwzTnXY',
      'x-jvault-dispatch',(select dispatch_secret from public.jvault_system_config where id=1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  ) where exists(select 1 from public.jvault_system_config where id=1);
$job$);
