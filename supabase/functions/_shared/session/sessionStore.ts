/**
 * Le stockage des sessions — un **port**, comme `SocleClient` : le service ne
 * connaît que cette interface, les tests la remplacent par une table en mémoire.
 *
 * L'implémentation réelle appelle les fonctions SQL de la migration
 * `espace_usager_sessions` par PostgREST, avec la clé service role du projet
 * Nora. Ce sont elles qui décident (expiration, inactivité, tenant) : une
 * session se résout en UN aller-retour, sous l'horloge de la base.
 *
 * ⚠️ La clé service role ne quitte pas l'edge function. Le navigateur ne parle
 * jamais à cette base.
 */

export interface SessionRecord {
  kind: "account" | "guest";
  accountId: string | null;
  guestRequestId: string | null;
  /** Session invitée : version de l'accès d'Iris à l'ouverture (contrat 2.8.0, lot L4a) ; `null` avant. */
  guestAccessVersion?: number | null;
  amr: string[];
  remember: boolean;
  /** Fin de vie absolue (ISO 8601). */
  expiresAt: string;
  /** Échéance d'inactivité, bornée par la fin de vie (ISO 8601). */
  idleExpiresAt: string;
}

export interface OpenSessionInput {
  idHash: string;
  kind: "account" | "guest";
  accountId: string | null;
  guestRequestId: string | null;
  /** Session invitée : version de l'accès d'Iris à l'ouverture (contrat 2.8.0, lot L4a) ; `null` avant. */
  guestAccessVersion?: number | null;
  tenantId: string;
  amr: string[];
  remember: boolean;
  idleSeconds: number;
  lifetimeSeconds: number;
}

/** Ce qui est consigné au journal avec l'événement. */
export interface RequestTrace {
  ip: string | null;
  userAgent: string | null;
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false };

export interface SessionStore {
  /** Ouvre une session ; renvoie sa fin de vie (ISO 8601). */
  open(input: OpenSessionInput, trace: RequestTrace): Promise<StoreResult<string>>;
  /** La session si elle est valable POUR CE TENANT, sinon `null`. */
  resolve(idHash: string, tenantId: string, trace: RequestTrace): Promise<StoreResult<SessionRecord | null>>;
  /** Clôt une session ; vrai si une session ouverte a été close. */
  close(idHash: string, reason: "logout" | "revoked", trace: RequestTrace): Promise<StoreResult<boolean>>;
}

export interface SessionStoreConfig {
  /** `SUPABASE_URL` du projet Nora. */
  url: string;
  /** `SUPABASE_SERVICE_ROLE_KEY` du projet Nora. */
  serviceKey: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Une ligne renvoyée par `citizen_session_resolve`, ou `null` si elle est illisible. */
export function parseSessionRow(row: unknown): SessionRecord | null {
  if (!isRecord(row)) return null;
  const kind = row.kind;
  if (kind !== "account" && kind !== "guest") return null;
  if (typeof row.expires_at !== "string" || typeof row.idle_expires_at !== "string") return null;
  const accountId = typeof row.account_id === "string" ? row.account_id : null;
  const guestRequestId = typeof row.guest_request_id === "string" ? row.guest_request_id : null;
  // Le sujet doit être cohérent avec la nature — la base le garantit, on le
  // revérifie : une session de compte sans compte ne doit rien ouvrir.
  if (kind === "account" && accountId === null) return null;
  if (kind === "guest" && guestRequestId === null) return null;
  return {
    kind,
    accountId,
    guestRequestId,
    guestAccessVersion: Number.isInteger(row.guest_access_version) ? (row.guest_access_version as number) : null,
    amr: Array.isArray(row.amr) ? row.amr.filter((v): v is string => typeof v === "string") : [],
    remember: row.remember === true,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
  };
}

export function createSessionStore(config: SessionStoreConfig): SessionStore {
  const base = config.url.replace(/\/+$/, "") + "/rest/v1/rpc/";
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function rpc(name: string, args: Record<string, unknown>): Promise<StoreResult<unknown>> {
    let response: Response;
    try {
      response = await fetch(base + name, {
        method: "POST",
        headers: {
          apikey: config.serviceKey,
          Authorization: "Bearer " + config.serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false };
    }
    if (!response.ok) {
      // Le détail va au journal : une fonction absente (migration non appliquée)
      // ou une clé refusée se diagnostiquent là, pas chez le visiteur.
      const detail = await response.text().catch(() => "");
      console.error(`portal-api : ${name} a répondu ${response.status}`, detail.slice(0, 300));
      return { ok: false };
    }
    try {
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false };
    }
  }

  return {
    async open(input, trace) {
      const result = await rpc("citizen_session_open", {
        p_id_hash: input.idHash,
        p_kind: input.kind,
        p_account_id: input.accountId,
        p_guest_request_id: input.guestRequestId,
        p_tenant_id: input.tenantId,
        p_amr: input.amr,
        p_remember: input.remember,
        p_idle_seconds: input.idleSeconds,
        p_lifetime_seconds: input.lifetimeSeconds,
        p_ip: trace.ip,
        p_user_agent: trace.userAgent,
        p_guest_access_version: input.guestAccessVersion ?? null,
      });
      if (!result.ok || typeof result.value !== "string") return { ok: false };
      return { ok: true, value: result.value };
    },

    async resolve(idHash, tenantId, trace) {
      const result = await rpc("citizen_session_resolve", {
        p_id_hash: idHash,
        p_tenant_id: tenantId,
        p_ip: trace.ip,
        p_user_agent: trace.userAgent,
      });
      if (!result.ok || !Array.isArray(result.value)) return { ok: false };
      if (result.value.length === 0) return { ok: true, value: null };
      const record = parseSessionRow(result.value[0]);
      return { ok: true, value: record };
    },

    async close(idHash, reason, trace) {
      const result = await rpc("citizen_session_close", {
        p_id_hash: idHash,
        p_reason: reason,
        p_ip: trace.ip,
        p_user_agent: trace.userAgent,
      });
      if (!result.ok || typeof result.value !== "boolean") return { ok: false };
      return { ok: true, value: result.value };
    },
  };
}
