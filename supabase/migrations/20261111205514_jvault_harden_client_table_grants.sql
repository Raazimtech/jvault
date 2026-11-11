-- Restrict JVault's exposed tables to the operations its single-owner app needs.
-- The Edge Function uses service_role for bootstrap; browser clients never need
-- access to bootstrap state or the stored bootstrap hash.
revoke all privileges on table
  public.jvault_files,
  public.jvault_notes,
  public.jvault_profiles,
  public.jvault_bootstrap_state,
  public.jvault_bootstrap_secret
from anon, authenticated;

grant select, insert, update, delete on table
  public.jvault_files,
  public.jvault_notes
to authenticated;

grant select on table public.jvault_profiles to authenticated;
