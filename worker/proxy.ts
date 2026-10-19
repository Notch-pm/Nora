/**
 * Le proxy de même origine du portail : `https://<collectivité>/api/*` →
 * `portal-api`.
 *
 * Pourquoi un proxy : la session d'un citoyen tient dans un cookie `HttpOnly`
 * de PREMIÈRE partie, posé sur le domaine de la collectivité. Appelée en direct
 * sur `*.supabase.co`, l'API ne pourrait poser qu'un cookie tiers — bloqué par
 * les navigateurs, et lisible de partout où l'API l'est. Relayée ici, elle est
 * sur le domaine du portail : plus de CORS, cookie local au domaine.
 *
 * Ce module ne contient AUCUNE règle métier — elles restent dans `portal-api`,
 * testées. Il fait quatre choses :
 *   1. ne transmettre que des en-têtes connus (liste blanche) — en particulier,
 *      un visiteur ne peut pas poser lui-même les en-têtes `x-nora-*` ;
 *   2. certifier l'hôte visité et l'adresse du visiteur ;
 *   3. prouver par un secret partagé que c'est bien ce Worker qui parle ;
 *   4. au retour, ne rendre au navigateur que les en-têtes du portail — ni les
 *      cookies de Supabase (`__cf_bm`, domaine `supabase.co`), ni son CORS `*`.
 *
 * Pur et sans dépendance : testé sous Node, exécuté sous Cloudflare Workers.
 */

export const API_PREFIX = "/api";

export interface ProxyEnv {
  /** Racine de `portal-api` (variable de runtime du Worker, pas de build). */
  PORTAL_API_URL?: string;
  /** Secret partagé avec `portal-api` (`NORA_PROXY_SECRET`). */
  NORA_PROXY_SECRET?: string;
}

/**
 * En-têtes du navigateur relayés tels quels. Tout le reste est écarté — dont
 * `x-nora-*`, `x-forwarded-*` et `authorization`, que seul ce Worker pose.
 */
const FORWARDED_HEADERS = [
  "accept",
  "accept-language",
  // Relayée pour que `portal-api` refuse un envoi trop lourd AVANT de le lire.
  "content-length",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "sec-fetch-site",
  "user-agent",
  "x-nora-request",
];

/**
 * En-têtes de `portal-api` rendus au navigateur. Tout le reste est écarté :
 * le CORS (inutile en même origine), les en-têtes propres à Supabase, et
 * `content-encoding`/`content-length` — le runtime décode le corps relayé et
 * le réencode lui-même.
 */
const RETURNED_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-language",
  "content-type",
  "etag",
  "last-modified",
  "location",
  "retry-after",
];

/** Seuls les cookies du portail repartent : `__Host-nora_sid` et ses futurs voisins. */
const PORTAL_COOKIE = /^__Host-nora_[A-Za-z0-9_]*=/;

export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(API_PREFIX + "/");
}

function unavailable(): Response {
  // Même forme que les erreurs de `portal-api` : l'interface sait la lire.
  return new Response(
    JSON.stringify({ error: { code: "not_configured", message: "Le portail n'est pas configuré." } }),
    { status: 503, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/**
 * La requête à envoyer à `portal-api`, ou une réponse d'erreur si le Worker
 * n'a pas sa configuration — jamais un relais sans secret, qui rendrait les
 * en-têtes certifiés indiscernables de ceux d'un visiteur.
 */
export function upstreamRequest(request: Request, env: ProxyEnv): Request | Response {
  const apiUrl = env.PORTAL_API_URL?.trim();
  const secret = env.NORA_PROXY_SECRET;
  if (!apiUrl || !secret || secret.length < 32) return unavailable();

  const url = new URL(request.url);
  const target = apiUrl.replace(/\/+$/, "") + url.pathname.slice(API_PREFIX.length) + url.search;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-nora-proxy-secret", secret);
  headers.set("x-nora-host", url.hostname);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip !== null) headers.set("x-nora-client-ip", ip);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: "manual",
    // Corps relayé en flux (pièces jointes) : exigé par la spécification fetch
    // dès qu'un corps est un flux. Absent des types DOM de TypeScript.
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

/**
 * La réponse de `portal-api` telle que le navigateur la reçoit : même statut,
 * même corps (en flux), en-têtes filtrés par liste blanche.
 */
export function downstreamResponse(upstream: Response): Response {
  const headers = new Headers();
  for (const name of RETURNED_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) {
    if (PORTAL_COOKIE.test(cookie)) headers.append("set-cookie", cookie);
  }
  headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
}
