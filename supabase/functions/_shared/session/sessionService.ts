/**
 * Les sessions de citoyen, vues de `portal-api` : lire celle d'une requête,
 * en ouvrir une, la clore — et refuser les requêtes d'écriture forgées ailleurs.
 *
 * Trois règles, qui sont toute la sécurité de la session :
 *
 *   1. **Hors proxy, personne n'est connecté.** Une session n'est lue que sur
 *      une requête relayée par le Worker du portail (`ProxyContext.proxied`) :
 *      c'est le seul chemin où le cookie est de première partie et où l'hôte
 *      est certifié. Un appel direct à `portal-api` est anonyme, quoi qu'il
 *      porte.
 *   2. **Une session appartient à UNE collectivité.** Le tenant vient de l'hôte
 *      certifié, jamais du navigateur ; la base refuse une session présentée
 *      sous un autre tenant que le sien.
 *   3. **Le navigateur ne désigne jamais qui il est.** Aucun identifiant de
 *      compte ni de fiche ne vient d'un paramètre : tout se déduit de la
 *      session.
 */
import type { ProxyContext } from "../http/proxy.ts";
import type { SessionDurations } from "./sessionPolicy.ts";
import type { RequestTrace, SessionRecord, SessionStore } from "./sessionStore.ts";
import {
  clearedSessionCookie,
  newSessionToken,
  readSessionToken,
  sessionCookie,
  sessionIdHash,
} from "./sessionToken.ts";

/** Les façons dont une opération de session peut échouer, vues du visiteur. */
export type SessionFailure =
  /** La base des sessions ne répond pas : on ne sait pas qui est là. */
  | "session_unavailable"
  /** Requête d'écriture qui ne vient pas d'une page du portail. */
  | "csrf_rejected"
  /** Opération réservée à un citoyen connecté. */
  | "session_required";

export const SESSION_MESSAGES: Record<SessionFailure, string> = {
  session_unavailable: "Votre espace est momentanément indisponible. Merci de réessayer dans quelques instants.",
  csrf_rejected: "Cette action n'a pas pu être vérifiée. Merci de recharger la page.",
  session_required: "Merci de vous connecter pour continuer.",
};

export function httpStatusForSessionFailure(failure: SessionFailure): number {
  switch (failure) {
    case "session_unavailable":
      return 503;
    case "csrf_rejected":
      return 403;
    case "session_required":
      return 401;
  }
}

export type CurrentSession =
  | { status: "anonymous"; clearCookie: boolean }
  | { status: "active"; idHash: string; record: SessionRecord };

export interface SessionContext {
  proxy: ProxyContext;
  tenantId: string;
  store: SessionStore;
  trace: RequestTrace;
}

/** Ce qui est consigné d'une requête : adresse certifiée, navigateur tronqué. */
export function traceOf(headers: Headers, proxy: ProxyContext): RequestTrace {
  const agent = headers.get("user-agent");
  return {
    ip: proxy.proxied ? proxy.clientIp : null,
    userAgent: agent === null ? null : agent.slice(0, 512),
  };
}

/**
 * La session de la requête.
 *
 * `clearCookie` dit qu'un cookie a été présenté mais ne vaut plus rien
 * (expiré, clos, inconnu) : la réponse doit l'effacer, sans quoi le navigateur
 * le renverrait à chaque appel.
 */
export async function currentSession(
  headers: Headers,
  context: SessionContext,
): Promise<{ ok: true; session: CurrentSession } | { ok: false; reason: "session_unavailable" }> {
  if (!context.proxy.proxied) return { ok: true, session: { status: "anonymous", clearCookie: false } };
  const token = readSessionToken(headers.get("cookie"));
  if (token === null) return { ok: true, session: { status: "anonymous", clearCookie: false } };

  const idHash = await sessionIdHash(token);
  const resolved = await context.store.resolve(idHash, context.tenantId, context.trace);
  if (!resolved.ok) return { ok: false, reason: "session_unavailable" };
  if (resolved.value === null) return { ok: true, session: { status: "anonymous", clearCookie: true } };
  return { ok: true, session: { status: "active", idHash, record: resolved.value } };
}

export interface OpenSessionRequest {
  kind: "account" | "guest";
  accountId: string | null;
  guestRequestId: string | null;
  amr: string[];
  remember: boolean;
  durations: SessionDurations;
}

/**
 * Ouvre une session et rend l'en-tête `Set-Cookie` à poser. Le jeton naît ici et
 * ne sort que dans ce cookie ; la base n'en reçoit que le haché.
 *
 * Refusée hors proxy : un cookie posé par un appel direct serait de TIERCE
 * partie (`*.supabase.co`) — inutilisable, et contraire à la règle 1.
 */
export async function openSession(
  request: OpenSessionRequest,
  context: SessionContext,
): Promise<{ ok: true; setCookie: string; expiresAt: string } | { ok: false; reason: SessionFailure }> {
  if (!context.proxy.proxied) return { ok: false, reason: "csrf_rejected" };
  const token = newSessionToken();
  const opened = await context.store.open(
    {
      idHash: await sessionIdHash(token),
      kind: request.kind,
      accountId: request.accountId,
      guestRequestId: request.guestRequestId,
      tenantId: context.tenantId,
      amr: request.amr,
      remember: request.remember,
      idleSeconds: request.durations.idleSeconds,
      lifetimeSeconds: request.durations.lifetimeSeconds,
    },
    context.trace,
  );
  if (!opened.ok) return { ok: false, reason: "session_unavailable" };
  return {
    ok: true,
    setCookie: sessionCookie(token, request.remember ? request.durations.lifetimeSeconds : null),
    expiresAt: opened.value,
  };
}

/**
 * Clôt la session de la requête (déconnexion). Idempotent : sans session, ou
 * avec une session déjà close, le cookie est effacé et c'est tout.
 */
export async function endSession(
  headers: Headers,
  context: SessionContext,
): Promise<{ ok: true; setCookie: string } | { ok: false; reason: "session_unavailable" }> {
  const token = context.proxy.proxied ? readSessionToken(headers.get("cookie")) : null;
  if (token !== null) {
    const closed = await context.store.close(await sessionIdHash(token), "logout", context.trace);
    if (!closed.ok) return { ok: false, reason: "session_unavailable" };
  }
  return { ok: true, setCookie: clearedSessionCookie() };
}

/** En-tête que seule une page du portail pose sur ses requêtes d'écriture. */
export const MUTATION_HEADER = "x-nora-request";

/**
 * Contrôle anti-CSRF d'une requête d'écriture qui touche à une session.
 *
 * Défense en profondeur, au-delà de `SameSite=Lax` :
 *   - l'en-tête `x-nora-request` est « non simple » : un autre site ne peut pas
 *     le poser sans pré-vol CORS, que le Worker de même origine n'accorde pas ;
 *   - si le navigateur dit d'où vient la requête (`Origin`, `Sec-Fetch-Site`),
 *     ce doit être le domaine même de la collectivité.
 */
export function checkMutation(headers: Headers, proxy: ProxyContext): { ok: true } | { ok: false } {
  if (!proxy.proxied) return { ok: false };
  if (headers.get(MUTATION_HEADER) !== "1") return { ok: false };

  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return { ok: false };

  const origin = headers.get("origin");
  if (origin !== null) {
    let host: string;
    try {
      host = new URL(origin).hostname.toLowerCase();
    } catch {
      return { ok: false };
    }
    if (host !== proxy.host) return { ok: false };
  }
  return { ok: true };
}
