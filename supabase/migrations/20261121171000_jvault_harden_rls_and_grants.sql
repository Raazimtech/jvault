-- JVault security hardening: least-privilege grants and owner-profile-bound RLS.
-- This migration intentionally touches only JVault tables in the shared Supabase project.

begin;

revoke all privileges on table
  public.jvault_activity,
  public.jvault_bootstrap_secret,
  public.jvault_bootstrap_state,
  public.jvault_file_versions,
  public.jvault_files,
  public.jvault_folders,
  public.jvault_notes,
  public.jvault_pages,
  public.jvault_profiles,
  public.jvault_push_config,
  public.jvault_push_subscriptions,
  public.jvault_reminders,
  public.jvault_shares
from public, anon, authenticated;

grant select, insert on table public.jvault_activity to authenticated;
grant select, insert on table public.jvault_file_versions to authenticated;
grant select, insert, update, delete on table
  public.jvault_files,
  public.jvault_folders,
  public.jvault_notes,
  public.jvault_pages,
  public.jvault_reminders
to authenticated;
grant select on table public.jvault_profiles to authenticated;

alter table public.jvault_activity enable row level security;
alter table public.jvault_bootstrap_secret enable row level security;
alter table public.jvault_bootstrap_state enable row level security;
alter table public.jvault_file_versions enable row level security;
alter table public.jvault_files enable row level security;
alter table public.jvault_folders enable row level security;
alter table public.jvault_notes enable row level security;
alter table public.jvault_pages enable row level security;
alter table public.jvault_profiles enable row level security;
alter table public.jvault_push_config enable row level security;
alter table public.jvault_push_subscriptions enable row level security;
alter table public.jvault_reminders enable row level security;
alter table public.jvault_shares enable row level security;

drop policy if exists "JVault owners add their activity" on public.jvault_activity;
drop policy if exists "JVault owners read their activity" on public.jvault_activity;
create policy "JVault owners add their activity"
on public.jvault_activity for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
);
create policy "JVault owners read their activity"
on public.jvault_activity for select to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
);

drop policy if exists "JVault owners manage their file versions" on public.jvault_file_versions;
create policy "JVault owners manage their file versions"
on public.jvault_file_versions for all to authenticated
using (
  owner_id = (select auth.uid())
  and storage_path like ((select auth.uid())::text || '/%')
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
  and exists (
    select 1 from public.jvault_files f
    where f.id = jvault_file_versions.file_id
      and f.owner_id = (select auth.uid())
  )
)
with check (
  owner_id = (select auth.uid())
  and storage_path like ((select auth.uid())::text || '/%')
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
  and exists (
    select 1 from public.jvault_files f
    where f.id = jvault_file_versions.file_id
      and f.owner_id = (select auth.uid())
  )
);

drop policy if exists "JVault owners manage their file records" on public.jvault_files;
create policy "JVault owners manage their file records"
on public.jvault_files for all to authenticated
using (
  owner_id = (select auth.uid())
  and storage_path like ((select auth.uid())::text || '/%')
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and storage_path like ((select auth.uid())::text || '/%')
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
  and (
    folder_id is null
    or exists (
      select 1 from public.jvault_folders f
      where f.id = jvault_files.folder_id and f.owner_id = (select auth.uid())
    )
  )
);

drop policy if exists "JVault owners manage their folders" on public.jvault_folders;
create policy "JVault owners manage their folders"
on public.jvault_folders for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
  and (
    parent_id is null
    or exists (
      select 1 from public.jvault_folders parent
      where parent.id = jvault_folders.parent_id
        and parent.owner_id = (select auth.uid())
    )
  )
);

drop policy if exists "JVault owners manage their text note" on public.jvault_notes;
create policy "JVault owners manage their text note"
on public.jvault_notes for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
);

drop policy if exists "JVault owners manage their pages" on public.jvault_pages;
create policy "JVault owners manage their pages"
on public.jvault_pages for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
  and (
    folder_id is null
    or exists (
      select 1 from public.jvault_folders f
      where f.id = jvault_pages.folder_id and f.owner_id = (select auth.uid())
    )
  )
  and (
    related_file_id is null
    or exists (
      select 1 from public.jvault_files f
      where f.id = jvault_pages.related_file_id and f.owner_id = (select auth.uid())
    )
  )
);

drop policy if exists "JVault owners manage their reminders" on public.jvault_reminders;
create policy "JVault owners manage their reminders"
on public.jvault_reminders for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
  and (
    related_file_id is null
    or exists (
      select 1 from public.jvault_files f
      where f.id = jvault_reminders.related_file_id and f.owner_id = (select auth.uid())
    )
  )
);

drop policy if exists "JVault owners manage their share links" on public.jvault_shares;
create policy "JVault owners manage their share links"
on public.jvault_shares for all to authenticated
using (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
)
with check (
  owner_id = (select auth.uid())
  and exists (select 1 from public.jvault_profiles p where p.user_id = (select auth.uid()))
  and exists (
    select 1 from public.jvault_files f
    where f.id = jvault_shares.file_id and f.owner_id = (select auth.uid())
  )
);

drop policy if exists "JVault users can read own profile" on public.jvault_profiles;
create policy "JVault users can read own profile"
on public.jvault_profiles for select to authenticated
using (user_id = (select auth.uid()));

commit;
