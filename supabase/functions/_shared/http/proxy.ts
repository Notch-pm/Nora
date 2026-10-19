/**
 * Le proxy de même origine — ce que le Worker du portail certifie à `portal-api`.
 *
 * Jusqu'ici le navigateur appelait `portal-api` en direct, sur `*.supabase.co`,
 * et le domaine visité n'était connu que par `Origin`. Une session de citoyen
 * demande davantage : un cookie de PREMIÈRE partie, posé sur le domaine de la
 * collectivité. Le Worker qui sert le portail relaie donc `/api/*` vers
 * `portal-api`, et lui transmet ce qu'il est seul à savoir :
 *
 *   - `x-nora-host`      — le nom d'hôte réellement visité (le `Host` du Worker) ;
 *   - `x-nora-client-ip` — l'adresse du visiteur (`cf-connecting-ip`) : vue de
 *                          `portal-api`, toutes les requêtes viennent sinon du
 *                          Worker, et les freins par adresse ne freineraient plus
 *                          que Cloudflare ;
 *   - `x-nora-proxy-secret` — le secret partagé qui prouve que c'est bien LE
 *                          Worker qui parle.
 *
 * ⚠️ Sans secret valable, ces en-têtes sont IGNORÉS — un client hors navigateur
 * peut les poser comme il veut. La requête est alors traitée comme avant :
 * anonyme, domaine tiré d'`Origin`. Aucune session n'est jamais lue hors proxy.
 *
 * Aucune dépendance : importable par l'edge function (Deno) comme par les tests.
 */
import { normalizeHostname } from "./hostname.ts";
import { clientAddress } from "./rateLimit.ts";

export const PROXY_SECRET_HEADER = "x-nora-proxy-secret";
export const PROXY_HOST_HEADER = "x-nora-host";
export const PROXY_CLIENT_IP_HEADER = "x-nora-client-ip";

export type ProxyContext =
  /** Appel direct (ancien chemin, ou client hors navigateur) : rien n'est certifié. */
  | { proxied: false }
  /** Relayé par le Worker du portail : l'hôte et l'adresse sont fiables. */
  | { proxied: true; host: string; clientIp: string | null };

/** Comparaison à temps constant : la durée ne dit pas où deux secrets divergent. */
function sameText(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Forme d'une adresse IP (v4 ou v6), sans plus : elle part en colonne `inet`,
 * qui refuserait le reste — et une adresse illisible vaut mieux absente.
 */
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:.]+$/i;

export function readableIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const ip = raw.trim();
  if (ip === "" || ip.length > 45) return null;
  if (IPV4_RE.test(ip)) return ip.split(".").every((part) => Number(part) <= 255) ? ip : null;
  return ip.includes(":") && IPV6_RE.test(ip) ? ip : null;
}

/**
 * Ce que le proxy certifie, ou `{ proxied: false }`.
 *
 * `secret` est celui de l'edge function (`NORA_PROXY_SECRET`). Absent, le proxy
 * n'est reconnu pour personne : on ne fait pas confiance à un en-tête par défaut.
 */
export function readProxyContext(headers: Headers, secret: string | null | undefined): ProxyContext {
  if (typeof secret !== "string" || secret.length < 32) return { proxied: false };
  const given = headers.get(PROXY_SECRET_HEADER);
  if (given === null || !sameText(given, secret)) return { proxied: false };
  const host = normalizeHostname(headers.get(PROXY_HOST_HEADER));
  if (host === null) return { proxied: false };
  return { proxied: true, host, clientIp: readableIp(headers.get(PROXY_CLIENT_IP_HEADER)) };
}

/**
 * L'adresse du visiteur pour les freins : celle que certifie le proxy, sinon
 * celle de la passerelle (appel direct).
 */
export function visitorAddress(headers: Headers, proxy: ProxyContext): string {
  if (proxy.proxied && proxy.clientIp !== null) return proxy.clientIp;
  return clientAddress(headers);
}
