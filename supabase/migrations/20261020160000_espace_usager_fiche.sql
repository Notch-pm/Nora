-- ============================================================================
-- Espace usager — lot L3b : l'espace d'un compte retient SA fiche du Socle.
--
-- Le rattachement est fait par le Socle (contacts-api 1.4.0, rattachement
-- strict) ; Nora n'en garde que l'identifiant, dans `citizen_spaces` — une
-- fiche par compte et par collectivité, et un seul compte par fiche. C'est la
-- frontière de « Mes demandes » : la fiche n'est JAMAIS désignée par le
-- navigateur, elle se lit ici, depuis la session.
-- ============================================================================

create unique index if not exists citizen_spaces_tenant_contact_key
  on public.citizen_spaces (tenant_id, socle_contact_id) where socle_contact_id is not null;

alter table public.citizen_auth_events drop constraint citizen_auth_events_event_check;
alter table public.citizen_auth_events add constraint citizen_auth_events_event_check check (event in (
  'session_opened',
  'session_closed',
  'session_idle',
  'session_expired',
  'session_revoked',
  'session_tenant_mismatch',
  'account_registered',
  'account_confirmed',
  'login_failed',
  'login_locked',
  'password_reset_requested',
  'password_changed',
  'totp_enabled',
  'totp_disabled',
  'totp_failed',
  'contact_linked'
));

create or replace function public.citizen_space_contact(p_account_id uuid, p_tenant_id uuid)
returns uuid
language sql security invoker stable set search_path = '' as $fn$
  select s.socle_contact_id from public.citizen_spaces s
   where s.account_id = p_account_id and s.tenant_id = p_tenant_id;
$fn$;

-- Pose la fiche de l'espace — une seule fois : une fiche déjà posée ne change
-- pas (une correction de rattachement passe par la collectivité).
create or replace function public.citizen_space_set_contact(
  p_account_id uuid, p_tenant_id uuid, p_contact_id uuid, p_ip inet, p_user_agent text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
begin
  update public.citizen_spaces
     set socle_contact_id = p_contact_id
   where account_id = p_account_id and tenant_id = p_tenant_id
     and (socle_contact_id is null or socle_contact_id = p_contact_id);
  if not found then return false; end if;
  perform public.citizen_event('contact_linked', p_tenant_id, p_account_id, p_ip, p_user_agent,
                               jsonb_build_object('socle_contact_id', p_contact_id));
  return true;
end;
$fn$;

revoke execute on function public.citizen_space_contact(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.citizen_space_set_contact(uuid, uuid, uuid, inet, text) from public, anon, authenticated;
grant execute on function public.citizen_space_contact(uuid, uuid) to service_role;
grant execute on function public.citizen_space_set_contact(uuid, uuid, uuid, inet, text) to service_role;
