/**
 * Le jeton de session et son cookie.
 *
 * Le jeton est 32 octets aléatoires (256 bits), encodés en base64url. Il ne vit
 * QUE dans le cookie du navigateur : la base n'en garde que le SHA-256, de sorte
 * qu'une lecture de la table des sessions ne permet d'en ouvrir aucune.
 *
 * Le cookie est `__Host-` : le navigateur refuse de le poser sans `Secure`, avec
 * un `Domain`, ou hors de `/`. Il reste donc attaché au SEUL nom d'hôte de la
 * collectivité visitée — `sceaux.edilumen.fr` ne voit pas celui d'`antony` — et
 * aucun sous-domaine ne peut l'écraser.
 *
 *   - `HttpOnly` : le JavaScript de la page ne le lit pas ; une faille XSS ne
 *     l'exfiltre pas.
 *   - `SameSite=Lax` : il ne part pas avec une requête POST d'un autre site.
 *
 * Aucune dépendance : WebCrypto, présent sous Deno comme sous Node.
 */
import { hashKey } from "../http/rateLimit.ts";

export const SESSION_COOKIE = "__Host-nora_sid";

/** 32 octets en base64url sans remplissage : 43 caractères. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Un jeton neuf, imprévisible. */
export function newSessionToken(): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** Ce que la base retient du jeton : son SHA-256 hexadécimal. */
export function sessionIdHash(token: string): Promise<string> {
  return hashKey(token);
}

/**
 * Le jeton porté par l'en-tête `Cookie`, ou `null`. Un jeton mal formé est
 * traité comme absent : il ne peut correspondre à rien, inutile de l'envoyer
 * en base.
 */
export function readSessionToken(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === "") return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return TOKEN_RE.test(value) ? value : null;
  }
  return null;
}

/**
 * L'en-tête `Set-Cookie` d'une session ouverte.
 *
 * Sans `maxAgeSeconds`, c'est un cookie de session du navigateur : il disparaît
 * à la fermeture. Avec (« rester connecté »), il survit, et c'est le serveur qui
 * borne sa vie — l'âge du cookie n'est qu'une commodité, jamais une garantie.
 */
export function sessionCookie(token: string, maxAgeSeconds: number | null = null): string {
  const base = `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax`;
  return maxAgeSeconds === null ? base : `${base}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

/** L'en-tête `Set-Cookie` qui efface la session côté navigateur. */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}
