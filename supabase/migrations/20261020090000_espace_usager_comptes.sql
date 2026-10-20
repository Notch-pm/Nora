-- ============================================================================
-- Espace usager — lot L3a : le compte citoyen (Projet Sceaux, AO 26AS02).
-- Analyse : Notch/Sceaux/02-espace-usager.md (§3.1, §3.2) et 03-avancement.md.
--
-- Supabase Auth (auth.users du projet Nora) garde l'adresse et le mot de passe
-- — haché par GoTrue, jamais vu ici. Nora y ajoute ce que GoTrue ne fait pas
-- comme le veut le CCTP Sceaux, ou ne fait pas du tout :
--
--   · citizen_accounts.email_hash : retrouver un compte par son adresse sans la
--     garder en clair une seconde fois (renvoi du lien, mot de passe oublié) ;
--   · citizen_login_guards : le blocage après échecs répétés (CCTP 6.3), PAR
--     ADRESSE — qu'elle ait un compte ou non, pour ne rien révéler ;
--   · citizen_totp : la double authentification facultative (CCTP 5.1), secret
--     CHIFFRÉ par portal-api (AES-GCM, clé dérivée de NORA_AUTH_SECRET) ;
--   · citizen_cgu_acceptances : l'acceptation des CGU, datée, par collectivité.
--
-- Tout reste fermé : RLS sans politique, aucun droit pour anon/authenticated,
-- RPC réservées au service_role (motif du lot L1).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Le compte : empreinte d'adresse, confirmation
-- ----------------------------------------------------------------------------

alter table public.citizen_accounts
  add column email_hash text check (email_hash ~ '^[0-9a-f]{64}$'),
  add column confirmed_at timestamptz,
  add column password_changed_at timestamptz;

create unique index citizen_accounts_email_hash_key on public.citizen_accounts (email_hash);

comment on column public.citizen_accounts.email_hash is
  'SHA-256 de l''adresse normalisée (minuscules, sans espaces) — la recherche par adresse sans second exemplaire en clair (GoTrue garde l''adresse).';
comment on column public.citizen_accounts.confirmed_at is
  'Adresse confirmée par le lien envoyé à l''inscription. NULL = compte inutilisable.';

-- ----------------------------------------------------------------------------
-- 2. Le blocage après échecs répétés — par adresse, compte ou non
-- ----------------------------------------------------------------------------

create table public.citizen_login_guards (
  email_hash   text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  failures     integer not null default 0 check (failures >= 0),
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
comment on table public.citizen_login_guards is
  'Échecs de connexion par adresse (empreinte) : 10 échecs en 15 min verrouillent 15 min. Vaut aussi pour une adresse sans compte — rien ne doit distinguer les deux.';

-- ----------------------------------------------------------------------------
-- 3. Double authentification (TOTP)
-- ----------------------------------------------------------------------------

create table public.citizen_totp (
  account_id      uuid primary key references public.citizen_accounts (id) on delete cascade,
  secret_enc      text,
  pending_enc     text,
  pending_at      timestamptz,
  enabled_at      timestamptz,
  last_step       bigint,
  constraint citizen_totp_enabled check ((enabled_at is null) = (secret_enc is null))
);
comment on table public.citizen_totp is
  'TOTP du compte : secret actif et secret en cours d''activation, CHIFFRÉS par portal-api (jamais en clair ici). last_step interdit de rejouer un code.';

-- ----------------------------------------------------------------------------
-- 4. CGU
-- ----------------------------------------------------------------------------

create table public.citizen_cgu_acceptances (
  id          bigint generated always as identity primary key,
  account_id  uuid not null references public.citizen_accounts (id) on delete cascade,
  tenant_id   uuid not null,
  version     text not null check (version ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
  accepted_at timestamptz not null default now(),
  ip          inet
);
create index citizen_cgu_acceptances_account_idx on public.citizen_cgu_acceptances (account_id, accepted_at desc);
comment on table public.citizen_cgu_acceptances is
  'Acceptation des conditions générales d''utilisation, par compte, collectivité et version (CCTP 3.7).';

-- ----------------------------------------------------------------------------
-- 5. Journal : les événements du compte
-- ----------------------------------------------------------------------------

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
  'totp_failed'
));

-- ----------------------------------------------------------------------------
-- 6. RLS et droits
-- ----------------------------------------------------------------------------

alter table public.citizen_login_guards enable row level security;
alter table public.citizen_totp enable row level security;
alter table public.citizen_cgu_acceptances enable row level security;
revoke all on public.citizen_login_guards, public.citizen_totp, public.citizen_cgu_acceptances
  from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Fonctions
-- ----------------------------------------------------------------------------

create or replace function public.citizen_event(
  p_event text, p_tenant_id uuid, p_account_id uuid, p_ip inet, p_user_agent text, p_detail jsonb default '{}'::jsonb)
returns void
language sql security invoker set search_path = '' as $fn$
  insert into public.citizen_auth_events (event, tenant_id, account_id, ip, user_agent, detail)
  values (p_event, p_tenant_id, p_account_id, p_ip, left(p_user_agent, 512), coalesce(p_detail, '{}'::jsonb));
$fn$;

-- Inscription : le compte (adresse à confirmer), son espace dans la
-- collectivité, l'acceptation des CGU — d'un bloc.
create or replace function public.citizen_account_register(
  p_account_id uuid, p_email_hash text, p_tenant_id uuid, p_cgu_version text, p_ip inet, p_user_agent text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
begin
  insert into public.citizen_accounts (id, email_hash, status)
  values (p_account_id, p_email_hash, 'active')
  on conflict (id) do nothing;
  if not found then return false; end if;
  insert into public.citizen_spaces (account_id, tenant_id) values (p_account_id, p_tenant_id)
  on conflict (account_id, tenant_id) do nothing;
  insert into public.citizen_cgu_acceptances (account_id, tenant_id, version, ip)
  values (p_account_id, p_tenant_id, p_cgu_version, p_ip);
  perform public.citizen_event('account_registered', p_tenant_id, p_account_id, p_ip, p_user_agent);
  return true;
end;
$fn$;

-- Le compte d'une adresse : identifiant, confirmé ou non, actif ou non.
create or replace function public.citizen_account_by_email(p_email_hash text)
returns table (account_id uuid, confirmed boolean, active boolean)
language sql security invoker stable set search_path = '' as $fn$
  select a.id, a.confirmed_at is not null, a.status = 'active'
    from public.citizen_accounts a where a.email_hash = p_email_hash;
$fn$;

create or replace function public.citizen_account_confirm(
  p_account_id uuid, p_tenant_id uuid, p_ip inet, p_user_agent text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
begin
  update public.citizen_accounts set confirmed_at = coalesce(confirmed_at, now())
   where id = p_account_id and status = 'active';
  if not found then return false; end if;
  perform public.citizen_event('account_confirmed', p_tenant_id, p_account_id, p_ip, p_user_agent);
  return true;
end;
$fn$;

-- Le compte tel que la connexion le voit, et son espace dans la collectivité
-- (créé au premier passage : un compte sert dans toutes les collectivités, et
-- aucune ne voit les autres).
create or replace function public.citizen_account_for_login(p_account_id uuid, p_tenant_id uuid)
returns table (confirmed boolean, active boolean, totp_enabled boolean)
language plpgsql security invoker set search_path = '' as $fn$
begin
  insert into public.citizen_spaces (account_id, tenant_id)
  select a.id, p_tenant_id from public.citizen_accounts a where a.id = p_account_id
  on conflict (account_id, tenant_id) do nothing;
  return query
  select a.confirmed_at is not null, a.status = 'active', t.enabled_at is not null
    from public.citizen_accounts a
    left join public.citizen_totp t on t.account_id = a.id
   where a.id = p_account_id;
end;
$fn$;

-- Garde de connexion : verrouillée ? (lecture seule).
create or replace function public.citizen_login_locked(p_email_hash text)
returns boolean
language sql security invoker stable set search_path = '' as $fn$
  select coalesce((select g.locked_until > now() from public.citizen_login_guards g
                    where g.email_hash = p_email_hash), false);
$fn$;

-- Un échec : 10 dans une fenêtre de 15 minutes verrouillent 15 minutes.
-- Rend true quand cet échec pose le verrou.
create or replace function public.citizen_login_failed(
  p_email_hash text, p_tenant_id uuid, p_ip inet, p_user_agent text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_guard public.citizen_login_guards%rowtype;
  v_account uuid;
begin
  insert into public.citizen_login_guards (email_hash) values (p_email_hash)
  on conflict (email_hash) do nothing;
  select * into v_guard from public.citizen_login_guards where email_hash = p_email_hash for update;
  if v_guard.window_start < now() - interval '15 minutes' then
    v_guard.failures := 0;
    v_guard.window_start := now();
  end if;
  v_guard.failures := v_guard.failures + 1;
  select a.id into v_account from public.citizen_accounts a where a.email_hash = p_email_hash;
  if v_guard.failures >= 10 then
    update public.citizen_login_guards
       set failures = 0, window_start = now(), locked_until = now() + interval '15 minutes'
     where email_hash = p_email_hash;
    perform public.citizen_event('login_locked', p_tenant_id, v_account, p_ip, p_user_agent);
    return true;
  end if;
  update public.citizen_login_guards
     set failures = v_guard.failures, window_start = v_guard.window_start
   where email_hash = p_email_hash;
  perform public.citizen_event('login_failed', p_tenant_id, v_account, p_ip, p_user_agent);
  return false;
end;
$fn$;

create or replace function public.citizen_login_succeeded(p_email_hash text)
returns void
language sql security invoker set search_path = '' as $fn$
  delete from public.citizen_login_guards where email_hash = p_email_hash;
$fn$;

create or replace function public.citizen_password_changed(
  p_account_id uuid, p_tenant_id uuid, p_ip inet, p_user_agent text, p_keep_id_hash text)
returns integer
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_revoked integer;
begin
  update public.citizen_accounts set password_changed_at = now(),
         confirmed_at = coalesce(confirmed_at, now())
   where id = p_account_id;
  v_revoked := public.citizen_sessions_revoke_account(p_account_id, p_keep_id_hash);
  perform public.citizen_event('password_changed', p_tenant_id, p_account_id, p_ip, p_user_agent,
                               jsonb_build_object('sessions_revoked', v_revoked));
  return v_revoked;
end;
$fn$;

-- TOTP : lecture de l'état chiffré.
create or replace function public.citizen_totp_get(p_account_id uuid)
returns table (secret_enc text, pending_enc text, pending_at timestamptz, enabled_at timestamptz, last_step bigint)
language sql security invoker stable set search_path = '' as $fn$
  select t.secret_enc, t.pending_enc, t.pending_at, t.enabled_at, t.last_step
    from public.citizen_totp t where t.account_id = p_account_id;
$fn$;

create or replace function public.citizen_totp_set_pending(p_account_id uuid, p_pending_enc text)
returns void
language sql security invoker set search_path = '' as $fn$
  insert into public.citizen_totp (account_id, pending_enc, pending_at)
  values (p_account_id, p_pending_enc, now())
  on conflict (account_id) do update set pending_enc = excluded.pending_enc, pending_at = excluded.pending_at;
$fn$;

-- Active le secret en attente ; un code ne peut pas resservir (last_step).
create or replace function public.citizen_totp_enable(
  p_account_id uuid, p_step bigint, p_tenant_id uuid, p_ip inet, p_user_agent text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
begin
  update public.citizen_totp
     set secret_enc = pending_enc, enabled_at = now(), last_step = p_step,
         pending_enc = null, pending_at = null
   where account_id = p_account_id and pending_enc is not null
     and pending_at > now() - interval '15 minutes';
  if not found then return false; end if;
  perform public.citizen_event('totp_enabled', p_tenant_id, p_account_id, p_ip, p_user_agent);
  return true;
end;
$fn$;

-- Consomme un pas de temps : refuse un code déjà servi (rejeu).
create or replace function public.citizen_totp_use_step(p_account_id uuid, p_step bigint)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
begin
  update public.citizen_totp set last_step = p_step
   where account_id = p_account_id and enabled_at is not null
     and (last_step is null or last_step < p_step);
  return found;
end;
$fn$;

create or replace function public.citizen_totp_disable(
  p_account_id uuid, p_tenant_id uuid, p_ip inet, p_user_agent text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
begin
  delete from public.citizen_totp where account_id = p_account_id and enabled_at is not null;
  if not found then return false; end if;
  perform public.citizen_event('totp_disabled', p_tenant_id, p_account_id, p_ip, p_user_agent);
  return true;
end;
$fn$;

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.citizen_event(text, uuid, uuid, inet, text, jsonb)',
    'public.citizen_account_register(uuid, text, uuid, text, inet, text)',
    'public.citizen_account_by_email(text)',
    'public.citizen_account_confirm(uuid, uuid, inet, text)',
    'public.citizen_account_for_login(uuid, uuid)',
    'public.citizen_login_locked(text)',
    'public.citizen_login_failed(text, uuid, inet, text)',
    'public.citizen_login_succeeded(text)',
    'public.citizen_password_changed(uuid, uuid, inet, text, text)',
    'public.citizen_totp_get(uuid)',
    'public.citizen_totp_set_pending(uuid, text)',
    'public.citizen_totp_enable(uuid, bigint, uuid, inet, text)',
    'public.citizen_totp_use_step(uuid, bigint)',
    'public.citizen_totp_disable(uuid, uuid, inet, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$grants$;

-- Purge (lot L1) : les gardes de connexion périmées partent aussi.
create or replace function public.citizen_purge_auth_data()
returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_sessions integer;
  v_events integer;
  v_guards integer;
begin
  delete from public.citizen_sessions
   where coalesce(ended_at, expires_at) < now() - interval '30 days';
  get diagnostics v_sessions = row_count;
  delete from public.citizen_auth_events where occurred_at < now() - interval '1 year';
  get diagnostics v_events = row_count;
  delete from public.citizen_login_guards
   where coalesce(locked_until, window_start) < now() - interval '1 day';
  get diagnostics v_guards = row_count;
  return jsonb_build_object('sessions', v_sessions, 'events', v_events, 'guards', v_guards);
end;
$fn$;
