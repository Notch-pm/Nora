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
--   · citizen_login_guards : le blocage après tentatives répétées (CCTP 6.3),
--     PAR ADRESSE — qu'elle ait un compte ou non, pour ne rien révéler. Chaque
--     tentative est COMPTÉE AVANT la vérification, d'un bloc : cent essais
--     lancés en parallèle n'en font pas passer plus de dix ;
--   · citizen_mail_quota : au plus 5 courriels de compte par adresse et par
--     heure — ni harcèlement d'une adresse, ni domaine de la ville mis sur
--     liste noire ;
--   · citizen_totp : la double authentification facultative (CCTP 5.1), secret
--     CHIFFRÉ par portal-api (AES-GCM, clé dérivée de NORA_AUTH_SECRET) ;
--   · citizen_cgu_acceptances : l'acceptation des CGU, datée, par collectivité.
--
-- Relecture de sécurité du 2026-10-20 prise en compte : inscription SANS mot
-- de passe (il se choisit au lien de confirmation — personne ne pré-inscrit
-- l'adresse d'un autre avec le sien) ; liens envoyés seulement par une
-- collectivité où le compte a un espace ; espace créé APRÈS l'authentification
-- complète ; compte désactivé = sessions fermées.
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
  'Adresse confirmée — et mot de passe choisi — par le lien envoyé à l''inscription. NULL = compte inutilisable.';

-- ----------------------------------------------------------------------------
-- 2. Le blocage après tentatives répétées — par adresse, compte ou non
-- ----------------------------------------------------------------------------

create table public.citizen_login_guards (
  email_hash   text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  attempts     integer not null default 0 check (attempts >= 0),
  window_start timestamptz not null default now(),
  locked_until timestamptz
);
comment on table public.citizen_login_guards is
  'Tentatives de connexion par adresse (empreinte), comptées AVANT vérification : au-delà de 10 en 15 min, verrou de 15 min. Une connexion réussie efface la ligne. Vaut aussi pour une adresse sans compte.';

create table public.citizen_mail_quota (
  email_hash   text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  sent         integer not null default 0 check (sent >= 0),
  window_start timestamptz not null default now()
);
comment on table public.citizen_mail_quota is
  'Courriels de compte envoyés par adresse (empreinte) : au plus 5 par heure.';

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
  'TOTP du compte : secret actif et secret en cours d''activation, CHIFFRÉS par portal-api et liés au compte (AAD). last_step interdit de rejouer un code.';

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
alter table public.citizen_mail_quota enable row level security;
alter table public.citizen_totp enable row level security;
alter table public.citizen_cgu_acceptances enable row level security;
revoke all on public.citizen_login_guards, public.citizen_mail_quota, public.citizen_totp,
  public.citizen_cgu_acceptances from anon, authenticated;

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

-- Inscription : le compte (adresse à confirmer, mot de passe à choisir), son
-- espace dans la collectivité, l'acceptation des CGU — d'un bloc.
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

-- Le compte d'une adresse, et s'il a un espace dans CETTE collectivité : un
-- lien de compte ne part que par le serveur d'envoi d'une collectivité où le
-- compte a un espace (une autre ne doit pas pouvoir lire le lien d'un citoyen
-- qui n'est pas le sien).
create or replace function public.citizen_account_by_email(p_email_hash text, p_tenant_id uuid)
returns table (account_id uuid, confirmed boolean, active boolean, has_space boolean)
language sql security invoker stable set search_path = '' as $fn$
  select a.id, a.confirmed_at is not null, a.status = 'active',
         exists (select 1 from public.citizen_spaces s where s.account_id = a.id and s.tenant_id = p_tenant_id)
    from public.citizen_accounts a where a.email_hash = p_email_hash;
$fn$;

create or replace function public.citizen_account_confirm(
  p_account_id uuid, p_tenant_id uuid, p_ip inet, p_user_agent text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
begin
  update public.citizen_accounts
     set confirmed_at = coalesce(confirmed_at, now()), password_changed_at = now()
   where id = p_account_id and status = 'active';
  if not found then return false; end if;
  perform public.citizen_event('account_confirmed', p_tenant_id, p_account_id, p_ip, p_user_agent);
  return true;
end;
$fn$;

-- Le compte tel que la connexion le voit. Lecture seule : l'espace dans la
-- collectivité n'est créé qu'une fois l'authentification COMPLÈTE
-- (`citizen_space_ensure`), second facteur compris.
create or replace function public.citizen_account_for_login(p_account_id uuid)
returns table (confirmed boolean, active boolean, totp_enabled boolean)
language sql security invoker stable set search_path = '' as $fn$
  select a.confirmed_at is not null, a.status = 'active', t.enabled_at is not null
    from public.citizen_accounts a
    left join public.citizen_totp t on t.account_id = a.id
   where a.id = p_account_id;
$fn$;

create or replace function public.citizen_space_ensure(p_account_id uuid, p_tenant_id uuid)
returns void
language sql security invoker set search_path = '' as $fn$
  insert into public.citizen_spaces (account_id, tenant_id)
  select a.id, p_tenant_id from public.citizen_accounts a where a.id = p_account_id
  on conflict (account_id, tenant_id) do nothing;
$fn$;

-- Une tentative de connexion (mot de passe ou code TOTP), comptée AVANT la
-- vérification et d'un bloc (verrou de ligne). Rend false si l'adresse est
-- verrouillée — ou le devient avec cette tentative.
create or replace function public.citizen_login_attempt(
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
  if v_guard.locked_until is not null and v_guard.locked_until > now() then
    return false;
  end if;
  if v_guard.window_start < now() - interval '15 minutes' then
    v_guard.attempts := 0;
    v_guard.window_start := now();
  end if;
  v_guard.attempts := v_guard.attempts + 1;
  if v_guard.attempts > 10 then
    update public.citizen_login_guards
       set attempts = 0, window_start = now(), locked_until = now() + interval '15 minutes'
     where email_hash = p_email_hash;
    select a.id into v_account from public.citizen_accounts a where a.email_hash = p_email_hash;
    perform public.citizen_event('login_locked', p_tenant_id, v_account, p_ip, p_user_agent);
    return false;
  end if;
  update public.citizen_login_guards
     set attempts = v_guard.attempts, window_start = v_guard.window_start, locked_until = null
   where email_hash = p_email_hash;
  return true;
end;
$fn$;

create or replace function public.citizen_login_succeeded(p_email_hash text)
returns void
language sql security invoker set search_path = '' as $fn$
  delete from public.citizen_login_guards where email_hash = p_email_hash;
$fn$;

-- Un courriel de compte vers cette adresse est-il encore permis (5 par heure) ?
-- Le compte s'il y a lieu : chaque appel qui rend true en consomme un.
create or replace function public.citizen_mail_allowed(p_email_hash text)
returns boolean
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_quota public.citizen_mail_quota%rowtype;
begin
  insert into public.citizen_mail_quota (email_hash) values (p_email_hash)
  on conflict (email_hash) do nothing;
  select * into v_quota from public.citizen_mail_quota where email_hash = p_email_hash for update;
  if v_quota.window_start < now() - interval '1 hour' then
    v_quota.sent := 0;
    v_quota.window_start := now();
  end if;
  if v_quota.sent >= 5 then
    return false;
  end if;
  update public.citizen_mail_quota set sent = v_quota.sent + 1, window_start = v_quota.window_start
   where email_hash = p_email_hash;
  return true;
end;
$fn$;

-- Mot de passe changé ou réinitialisé : les autres sessions se ferment, et le
-- verrou de l'adresse se lève (un lien reçu par courriel est une preuve).
create or replace function public.citizen_password_changed(
  p_account_id uuid, p_tenant_id uuid, p_ip inet, p_user_agent text, p_keep_id_hash text)
returns integer
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_revoked integer;
begin
  update public.citizen_accounts set password_changed_at = now()
   where id = p_account_id;
  delete from public.citizen_login_guards g
   using public.citizen_accounts a
   where a.id = p_account_id and g.email_hash = a.email_hash;
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

-- Un compte désactivé ne garde aucune session ouverte.
create or replace function public.citizen_accounts_disabled_revokes()
returns trigger
language plpgsql security invoker set search_path = '' as $fn$
begin
  perform public.citizen_sessions_revoke_account(new.id, null);
  return new;
end;
$fn$;

create trigger t10_citizen_accounts_disabled_revokes
  after update of status on public.citizen_accounts
  for each row when (new.status = 'disabled' and old.status is distinct from 'disabled')
  execute function public.citizen_accounts_disabled_revokes();

do $grants$
declare
  f text;
begin
  foreach f in array array[
    'public.citizen_event(text, uuid, uuid, inet, text, jsonb)',
    'public.citizen_account_register(uuid, text, uuid, text, inet, text)',
    'public.citizen_account_by_email(text, uuid)',
    'public.citizen_account_confirm(uuid, uuid, inet, text)',
    'public.citizen_account_for_login(uuid)',
    'public.citizen_space_ensure(uuid, uuid)',
    'public.citizen_login_attempt(text, uuid, inet, text)',
    'public.citizen_login_succeeded(text)',
    'public.citizen_mail_allowed(text)',
    'public.citizen_password_changed(uuid, uuid, inet, text, text)',
    'public.citizen_totp_get(uuid)',
    'public.citizen_totp_set_pending(uuid, text)',
    'public.citizen_totp_enable(uuid, bigint, uuid, inet, text)',
    'public.citizen_totp_use_step(uuid, bigint)',
    'public.citizen_totp_disable(uuid, uuid, inet, text)',
    'public.citizen_accounts_disabled_revokes()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$grants$;

-- Purge (lot L1) : les gardes et quotas périmés partent aussi.
create or replace function public.citizen_purge_auth_data()
returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
declare
  v_sessions integer;
  v_events integer;
  v_guards integer;
  v_quota integer;
begin
  delete from public.citizen_sessions
   where coalesce(ended_at, expires_at) < now() - interval '30 days';
  get diagnostics v_sessions = row_count;
  delete from public.citizen_auth_events where occurred_at < now() - interval '1 year';
  get diagnostics v_events = row_count;
  delete from public.citizen_login_guards
   where coalesce(locked_until, window_start) < now() - interval '1 day';
  get diagnostics v_guards = row_count;
  delete from public.citizen_mail_quota where window_start < now() - interval '1 day';
  get diagnostics v_quota = row_count;
  return jsonb_build_object('sessions', v_sessions, 'events', v_events, 'guards', v_guards, 'mail_quota', v_quota);
end;
$fn$;
