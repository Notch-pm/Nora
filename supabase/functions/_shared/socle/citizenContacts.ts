/**
 * La fiche d'un usager au Socle, pour SON compte du portail — contacts-api
 * 1.4.0, routes `/v1/citizen/*`, scope `citizen` sur la clé de Nora. Le seul
 * fichier du portail qui les connaît.
 *
 * Jamais le scope `contacts` : il ouvrirait le référentiel entier de la
 * collectivité, notes internes comprises.
 */

export type CitizenContactReply =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "not_found" }
  /** 400 : le Socle refuse l'identité ou les coordonnées (le message dit pourquoi). */
  | { kind: "rejected"; message: string | null }
  | { kind: "unavailable" };

export interface CitizenContacts {
  get(tenantId: string, accountId: string): Promise<CitizenContactReply>;
  link(tenantId: string, accountId: string, identity: Record<string, string>): Promise<CitizenContactReply>;
  update(tenantId: string, accountId: string, fields: Record<string, string | null>): Promise<CitizenContactReply>;
}

export interface CitizenContactsConfig {
  /** Racine de contacts-api (`SOCLE_CONTACTS_API_URL`, ou déduite de `SOCLE_API_URL`). */
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

/** contacts-api à côté de public-api, sauf réglage explicite (motif d'Iris). */
export function contactsApiUrl(explicit: string | undefined, publicApiUrl: string | undefined): string | null {
  if (explicit) return explicit.replace(/\/+$/, "");
  if (!publicApiUrl) return null;
  return publicApiUrl.replace(/\/+$/, "").replace(/public-api$/, "contacts-api");
}

export function createCitizenContacts(config: CitizenContactsConfig): CitizenContacts {
  const base = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? 8_000;

  async function call(method: string, tenantId: string, path: string, body?: unknown): Promise<CitizenContactReply> {
    let response: Response;
    try {
      response = await fetch(base + path, {
        method,
        headers: {
          Authorization: "Bearer " + config.apiKey,
          "X-Organization-Id": tenantId,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { kind: "unavailable" };
    }
    const parsed = await response.json().catch(() => null);
    if (response.status === 404) return { kind: "not_found" };
    if (response.status === 400) {
      const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message;
      return { kind: "rejected", message: typeof message === "string" ? message : null };
    }
    if (response.status === 401 || response.status === 403) {
      console.error("portal-api : clé Socle refusée sur /v1/citizen (scope citizen ?)");
      return { kind: "unavailable" };
    }
    if (!response.ok || parsed === null) return { kind: "unavailable" };
    return { kind: "ok", status: response.status, body: parsed };
  }

  const path = (accountId: string) => `/v1/citizen/contacts/${encodeURIComponent(accountId)}`;
  return {
    get: (tenantId, accountId) => call("GET", tenantId, path(accountId)),
    link: (tenantId, accountId, identity) => call("POST", tenantId, path(accountId) + "/link", identity),
    update: (tenantId, accountId, fields) => call("PATCH", tenantId, path(accountId), fields),
  };
}
