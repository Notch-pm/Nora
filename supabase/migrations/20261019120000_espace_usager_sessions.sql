-- ════════════════════════════════════════════════════════════════════════════
-- Espace usager — lot L1 : comptes, espaces par collectivité, sessions, journal.
--
-- Les PREMIÈRES tables de Nora. Jusqu'ici le portail n'avait aucune base : le
-- Socle porte les collectivités et les usagers, Iris les demandes. Ce qui arrive
-- ici n'appartient à aucun des deux — c'est la CONNEXION d'un citoyen :
--   · son compte (l'identité de connexion vit dans `auth.users` de CE projet,
--     jamais dans celui du Socle, réservé aux agents) ;
--   · un espace par collectivité, qui porte le lien vers SA fiche du Socle ;
--   · ses sessions, opaques et révocables ;
--   · le journal des connexions exigé par les marchés (CCTP Sceaux §7.8).
--
-- La fiche usager (identité, adresse, consentements) RESTE au Socle : un
-- espace ne copie rien, il ne garde que `socle_contact_id`.
--
-- ⚠️ AUCUN ACCÈS DIRECT. RLS activée sans aucune politique, et privilèges retirés
-- à `anon` / `authenticated` : seule `portal-api`, en service role, lit et écrit
-- ici. Le navigateur ne reçoit jamais la clé anon de ce projet. Une table
-- citoyenne lisible par l'API de données serait une fuite entre comptes.
--
-- Rejouable tel quel sur un projet neuf : la bascule vers un projet hébergé en
-- France recréera Nora à partir de ce dossier.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Comptes ─────────────────────────────────────────────────────────────────
-- Une ligne par identité de connexion. `id` EST celui de `auth.users` : Supabase
-- Auth vérifie le mot de passe, la confirmation du courriel et le TOTP ; Nora
-- porte tout le reste. `last_seen_at` alimente la purge des comptes inactifs
-- (24 mois, CCTP §5.5).
create table public.citizen_accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.citizen_accounts is
  'Compte citoyen du portail. Identité de connexion dans auth.users ; fiche usager au Socle (via citizen_spaces).';

-- ── Espaces : un compte, une collectivité ───────────────────────────────────
-- Un même courriel sert à Sceaux et à Antony sans qu'une ville voie l'autre :
-- chaque collectivité (racine du Socle) a son espace, et la fiche usager est
-- celle de CETTE collectivité — les contacts du Socle sont scopés par racine.
create table public.citizen_spaces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.citizen_accounts (id) on delete cascade,
  tenant_id uuid not null,
  socle_contact_id uuid,
  created_at timestamptz not null default now(),
  constraint citizen_spaces_account_tenant_key unique (account_id, tenant_id)
);

comment on column public.citizen_spaces.tenant_id is
  'Organisation racine du Socle (la collectivité). Pas de FK : le Socle est un autre projet.';
comment on column public.citizen_spaces.socle_contact_id is
  'Fiche usager du Socle rattachée à cet espace. Le rattachement est la frontière de sécurité de « Mes demandes ».';

-- ── Sessions ────────────────────────────────────────────────────────────────
-- Opaques côté serveur : le cookie porte un jeton aléatoire, la base n'en garde
-- que le SHA-256 (`id_hash`). Une fuite de cette table ne permet donc d'ouvrir
-- aucune session.
--
-- Deux natures :
--   · `account` — un citoyen connecté ;
--   · `guest`   — un accès hors compte, limité à UNE demande (courriel + code
--                 de suivi, lot L2).
--
-- Une session est LIÉE À UNE COLLECTIVITÉ : le cookie est posé par domaine
-- (`__Host-`), et `citizen_session_resolve` refuse une session présentée sous
-- un autre tenant que le sien.
create table public.citizen_sessions (
  id_hash text primary key check (id_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('account', 'guest')),
  account_id uuid references public.citizen_accounts (id) on delete cascade,
  guest_request_id text,
  tenant_id uuid not null,
  -- Moyens d'authentification présentés : pwd, totp, fc, code.
  amr text[] not null default '{}',
  remember boolean not null default false,
  idle_seconds integer not null check (idle_seconds between 60 and 2592000),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in ('logout', 'idle', 'expired', 'revoked')),
  ip inet,
  user_agent text check (char_length(user_agent) <= 512),
  constraint citizen_sessions_subject check (
    (kind = 'account' and account_id is not null and guest_request_id is null)
    or (kind = 'guest' and account_id is null and guest_request_id is not null)
  ),
  constraint citizen_sessions_end check ((ended_at is null) = (end_reason is null))
);

create index citizen_sessions_account_open_idx
  on public.citizen_sessions (account_id) where ended_at is null;
create index citizen_sessions_expires_open_idx
  on public.citizen_sessions (expires_at) where ended_at is null;
create index citizen_sessions_ended_idx
  on public.citizen_sessions (ended_at) where ended_at is not null;

-- ── Journal des connexions ──────────────────────────────────────────────────
-- Exigé par les marchés publics (identifiant, adresse IP, connexion et
-- déconnexion, CCTP Sceaux §3.7 et §7.8) — c'est pourquoi l'adresse y est EN
-- CLAIR, contrairement à la mesure d'audience. Sa durée de vie est bornée
-- (`citizen_purge_auth_data`, un an).
--
-- Pas de FK vers les comptes : le journal survit à la suppression d'un compte,
-- le temps de sa conservation — c'est précisément ce qu'on lui demande.
create table public.citizen_auth_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  tenant_id uuid,
  account_id uuid,
  session_id_hash text,
  event text not null check (event in (
    'session_opened',
    'session_closed',
    'session_idle',
    'session_expired',
    'session_revoked',
    'session_tenant_mismatch'
  )),
  ip inet,
  user_agent text check (char_length(user_agent) <= 512),
  detail jsonb not null default '{}'::jsonb
);

create index citizen_auth_events_account_idx
  on public.citizen_auth_events (account_id, occurred_at desc);
create index citizen_auth_events_tenant_idx
  on public.citizen_auth_events (tenant_id, occurred_at desc);
create index citizen_auth_events_occurred_idx
  on public.citizen_auth_events (occurred_at);

-- ── Verrouillage : personne d'autre que le service role ─────────────────────
alter table public.citizen_accounts enable row level security;
alter table public.citizen_spaces enable row level security;
alter table public.citizen_sessions enable row level security;
alter table public.citizen_auth_events enable row level security;

revoke all on public.citizen_accounts from anon, authenticated;
revoke all on public.citizen_spaces from anon, authenticated;
revoke all on public.citizen_sessions from anon, authenticated;
revoke all on public.citizen_auth_events from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Fonctions de session — appelées par `portal-api` (PostgREST, service role).
-- Une session se résout en UN aller-retour : vérification, expiration et
-- rafraîchissement de l'activité se font ici, sous une seule horloge.
-- ════════════════════════════════════════════════════════════════════════════

create function public.citizen_session_open(
  p_id_hash text,
  p_kind text,
  p_account_id uuid,
  p_guest_request_id text,
  p_tenant_id uuid,
  p_amr text[],
  p_remember boolean,
  p_idle_seconds integer,
  p_lifetime_seconds integer,
  p_ip inet,
  p_user_agent text
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + make_interval(secs => p_lifetime_seconds);
begin
  insert into public.citizen_sessions (
    id_hash, kind, account_id, guest_request_id, tenant_id, amr, remember,
    idle_seconds, expires_at, ip, user_agent
  ) values (
    p_id_hash, p_kind, p_account_id, p_guest_request_id, p_tenant_id,
    coalesce(p_amr, '{}'), coalesce(p_remember, false),
    p_idle_seconds, v_expires, p_ip, left(p_user_agent, 512)
  );

  insert into public.citizen_auth_events (
    tenant_id, account_id, session_id_hash, event, ip, user_agent, detail
  ) values (
    p_tenant_id, p_account_id, p_id_hash, 'session_opened', p_ip, left(p_user_agent, 512),
    jsonb_build_object(
      'kind', p_kind,
      'amr', coalesce(p_amr, '{}'),
      'remember', coalesce(p_remember, false),
      'guest_request_id', p_guest_request_id
    )
  );

  return v_expires;
end;
$$;

comment on function public.citizen_session_open is
  'Ouvre une session (compte ou invitée) et la consigne au journal. Le jeton n''arrive jamais ici : seulement son SHA-256.';

-- Résout une session présentée sous une collectivité. Ne renvoie RIEN si elle
-- est inconnue, close, expirée, inactive trop longtemps, ou présentée sous un
-- autre tenant que le sien — l'appelant ne distingue pas ces cas, et c'est voulu.
create function public.citizen_session_resolve(
  p_id_hash text,
  p_tenant_id uuid,
  p_ip inet,
  p_user_agent text
) returns table (
  kind text,
  account_id uuid,
  guest_request_id text,
  amr text[],
  remember boolean,
  expires_at timestamptz,
  idle_expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  s public.citizen_sessions%rowtype;
  v_now timestamptz := now();
  v_reason text;
begin
  select * into s from public.citizen_sessions cs where cs.id_hash = p_id_hash;
  if not found or s.ended_at is not null then
    return;
  end if;

  -- Un cookie `__Host-` ne quitte pas son domaine : une session présentée sous
  -- une autre collectivité signale un défaut du proxy ou une falsification. On
  -- refuse et on consigne, SANS clore la session légitime.
  if s.tenant_id <> p_tenant_id then
    insert into public.citizen_auth_events (
      tenant_id, account_id, session_id_hash, event, ip, user_agent, detail
    ) values (
      p_tenant_id, s.account_id, s.id_hash, 'session_tenant_mismatch', p_ip, left(p_user_agent, 512),
      jsonb_build_object('session_tenant_id', s.tenant_id)
    );
    return;
  end if;

  if v_now >= s.expires_at then
    v_reason := 'expired';
  elsif v_now >= s.last_seen_at + make_interval(secs => s.idle_seconds) then
    v_reason := 'idle';
  end if;

  if v_reason is not null then
    update public.citizen_sessions cs
      set ended_at = v_now, end_reason = v_reason
      where cs.id_hash = s.id_hash and cs.ended_at is null;
    insert into public.citizen_auth_events (
      tenant_id, account_id, session_id_hash, event, ip, user_agent
    ) values (
      s.tenant_id, s.account_id, s.id_hash, 'session_' || v_reason, p_ip, left(p_user_agent, 512)
    );
    return;
  end if;

  -- L'activité n'est réécrite qu'une fois par minute : une page qui fait dix
  -- appels ne fait pas dix écritures. L'inactivité est donc mesurée à la minute.
  if v_now - s.last_seen_at >= interval '60 seconds' then
    update public.citizen_sessions cs set last_seen_at = v_now where cs.id_hash = s.id_hash;
    if s.account_id is not null then
      update public.citizen_accounts ca set last_seen_at = v_now where ca.id = s.account_id;
    end if;
    s.last_seen_at := v_now;
  end if;

  return query select
    s.kind, s.account_id, s.guest_request_id, s.amr, s.remember, s.expires_at,
    least(s.expires_at, s.last_seen_at + make_interval(secs => s.idle_seconds));
end;
$$;

-- Clôt UNE session : déconnexion par l'usager (`logout`) ou retrait (`revoked`).
-- Vrai si une session ouverte a été close.
create function public.citizen_session_close(
  p_id_hash text,
  p_reason text,
  p_ip inet,
  p_user_agent text
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_account uuid;
begin
  if p_reason not in ('logout', 'revoked') then
    raise exception 'citizen_session_close : motif inconnu %', p_reason;
  end if;

  update public.citizen_sessions cs
    set ended_at = now(), end_reason = p_reason
    where cs.id_hash = p_id_hash and cs.ended_at is null
    returning cs.tenant_id, cs.account_id into v_tenant, v_account;
  if not found then
    return false;
  end if;

  insert into public.citizen_auth_events (
    tenant_id, account_id, session_id_hash, event, ip, user_agent
  ) values (
    v_tenant, v_account, p_id_hash,
    case p_reason when 'logout' then 'session_closed' else 'session_revoked' end,
    p_ip, left(p_user_agent, 512)
  );
  return true;
end;
$$;

-- Retire toutes les sessions ouvertes d'un compte, sauf éventuellement celle
-- en cours : changement de mot de passe, « déconnecter mes autres appareils »,
-- désactivation. Renvoie le nombre de sessions closes.
create function public.citizen_sessions_revoke_account(
  p_account_id uuid,
  p_keep_id_hash text
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with closed as (
    update public.citizen_sessions cs
      set ended_at = now(), end_reason = 'revoked'
      where cs.account_id = p_account_id
        and cs.ended_at is null
        and (p_keep_id_hash is null or cs.id_hash <> p_keep_id_hash)
      returning cs.id_hash, cs.tenant_id
  ), logged as (
    insert into public.citizen_auth_events (tenant_id, account_id, session_id_hash, event)
      select c.tenant_id, p_account_id, c.id_hash, 'session_revoked' from closed c
      returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$$;

-- Purge : sessions closes ou expirées depuis 30 jours, journal au-delà d'un an.
-- ⚠️ À PLANIFIER (pg_cron) au déploiement — consigné dans l'inventaire de bascule.
create function public.citizen_purge_auth_data()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_sessions integer;
  v_events integer;
begin
  delete from public.citizen_sessions cs
    where coalesce(cs.ended_at, cs.expires_at) < now() - interval '30 days';
  get diagnostics v_sessions = row_count;

  delete from public.citizen_auth_events e
    where e.occurred_at < now() - interval '1 year';
  get diagnostics v_events = row_count;

  return jsonb_build_object('sessions', v_sessions, 'events', v_events);
end;
$$;

revoke all on function public.citizen_session_open(text, text, uuid, text, uuid, text[], boolean, integer, integer, inet, text) from public, anon, authenticated;
revoke all on function public.citizen_session_resolve(text, uuid, inet, text) from public, anon, authenticated;
revoke all on function public.citizen_session_close(text, text, inet, text) from public, anon, authenticated;
revoke all on function public.citizen_sessions_revoke_account(uuid, text) from public, anon, authenticated;
revoke all on function public.citizen_purge_auth_data() from public, anon, authenticated;

grant execute on function public.citizen_session_open(text, text, uuid, text, uuid, text[], boolean, integer, integer, inet, text) to service_role;
grant execute on function public.citizen_session_resolve(text, uuid, inet, text) to service_role;
grant execute on function public.citizen_session_close(text, text, inet, text) to service_role;
grant execute on function public.citizen_sessions_revoke_account(uuid, text) to service_role;
grant execute on function public.citizen_purge_auth_data() to service_role;
