-- ════════════════════════════════════════════════════════════════════════════
-- Session invitée : la VERSION de l'accès d'Iris (espace usager, lot L4a).
--
-- Iris tire un code NEUF au « code perdu » ou à la demande d'un agent, et un
-- agent peut COUPER l'accès invité d'une demande ; chaque fois, la version de
-- l'accès augmente (Iris, contrat 2.8.0). La session invitée retient la version
-- qu'Iris a rendue à son ouverture, et le portail la porte dans son jeton court
-- (`g`) : Iris refuse alors les lectures d'une session ouverte avec un code
-- remplacé ou coupé. Sans cette colonne, une coupure ne fermait que les
-- PROCHAINES sessions, pas celles déjà ouvertes (2 h au plus).
--
-- Les deux fonctions sont reprises de 20261019120000 à l'identique, la colonne
-- en plus. `p_guest_access_version` a une valeur par défaut : un portail
-- d'avant cette migration l'appelle encore sans erreur.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.citizen_sessions
  add column guest_access_version integer check (guest_access_version is null or guest_access_version >= 1);

comment on column public.citizen_sessions.guest_access_version is
  'Session invitée : version de l''accès d''Iris à l''ouverture (contrat 2.8.0). NULL = session ouverte avant le lot L4a, ou de compte.';

drop function public.citizen_session_open(text, text, uuid, text, uuid, text[], boolean, integer, integer, inet, text);

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
  p_user_agent text,
  p_guest_access_version integer default null
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expires timestamptz := now() + make_interval(secs => p_lifetime_seconds);
begin
  insert into public.citizen_sessions (
    id_hash, kind, account_id, guest_request_id, guest_access_version, tenant_id, amr, remember,
    idle_seconds, expires_at, ip, user_agent
  ) values (
    p_id_hash, p_kind, p_account_id, p_guest_request_id, p_guest_access_version, p_tenant_id,
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
  'Ouvre une session (compte ou invitée) et la consigne au journal. Le jeton n''arrive jamais ici : seulement son SHA-256. Invitée : retient la version de l''accès d''Iris.';

drop function public.citizen_session_resolve(text, uuid, inet, text);

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
  guest_access_version integer,
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
    s.kind, s.account_id, s.guest_request_id, s.guest_access_version, s.amr, s.remember, s.expires_at,
    least(s.expires_at, s.last_seen_at + make_interval(secs => s.idle_seconds));
end;
$$;

revoke all on function public.citizen_session_open(text, text, uuid, text, uuid, text[], boolean, integer, integer, inet, text, integer) from public, anon, authenticated;
revoke all on function public.citizen_session_resolve(text, uuid, inet, text) from public, anon, authenticated;
grant execute on function public.citizen_session_open(text, text, uuid, text, uuid, text[], boolean, integer, integer, inet, text, integer) to service_role;
grant execute on function public.citizen_session_resolve(text, uuid, inet, text) to service_role;
