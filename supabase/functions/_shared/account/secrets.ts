/**
 * Les secrets du compte, tirés d'UN secret d'edge function (`NORA_AUTH_SECRET`)
 * par dérivation HKDF : une clé par usage, jamais la même deux fois.
 *
 *   · chiffrer le secret TOTP d'un compte (AES-GCM) — la base n'en voit que le
 *     chiffré ; une fuite de la base seule ne donne pas les seconds facteurs ;
 *   · signer le TICKET de second facteur : après un mot de passe juste, un
 *     compte à TOTP reçoit un ticket de 5 minutes, et non une session.
 *
 * WebCrypto seul : Deno en production, Node sous vitest.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const MIN_AUTH_SECRET_LENGTH = 32;

export function authSecretFrom(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length >= MIN_AUTH_SECRET_LENGTH ? value : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function derive(secret: string, label: string, usage: "aes" | "hmac"): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
  const params = { name: "HKDF", hash: "SHA-256", salt: encoder.encode("nora-espace-usager"), info: encoder.encode(label) };
  return usage === "aes"
    ? crypto.subtle.deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
    : crypto.subtle.deriveKey(params, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"]);
}

/** `v1.<iv>.<chiffré>` — la version permet de changer d'algorithme sans tout casser. */
/**
 * `aad` lie le chiffré à son propriétaire (l'identifiant du compte) : un
 * chiffré recopié sur un autre compte ne se déchiffre pas.
 */
export async function seal(secret: string, label: string, plaintext: string, aad = ""): Promise<string> {
  const key = await derive(secret, label, "aes");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, encoder.encode(plaintext)),
  );
  return `v1.${toBase64Url(iv)}.${toBase64Url(sealed)}`;
}

export async function unseal(secret: string, label: string, sealed: string, aad = ""): Promise<string | null> {
  const [version, ivText, bodyText] = sealed.split(".");
  if (version !== "v1" || ivText === undefined || bodyText === undefined) return null;
  const iv = fromBase64Url(ivText);
  const body = fromBase64Url(bodyText);
  if (iv === null || body === null || iv.length !== 12) return null;
  try {
    const key = await derive(secret, label, "aes");
    return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(aad) }, key, body));
  } catch {
    return null;
  }
}

/** Un jeton signé : `<charge>.<signature>`, la charge en JSON base64url avec une échéance `exp` (secondes). */
export async function signToken(secret: string, label: string, payload: Record<string, unknown>): Promise<string> {
  const key = await derive(secret, label, "hmac");
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${toBase64Url(mac)}`;
}

/** La charge si la signature est bonne et l'échéance pas passée ; `null` sinon. */
export async function verifyToken(
  secret: string,
  label: string,
  token: string,
  nowSeconds: number,
): Promise<Record<string, unknown> | null> {
  const [body, macText] = token.split(".");
  if (body === undefined || macText === undefined) return null;
  const mac = fromBase64Url(macText);
  if (mac === null) return null;
  const key = await derive(secret, label, "hmac");
  // `verify` compare à temps constant.
  if (!(await crypto.subtle.verify("HMAC", key, mac, encoder.encode(body)))) return null;
  const bytes = fromBase64Url(body);
  if (bytes === null) return null;
  try {
    const payload = JSON.parse(decoder.decode(bytes));
    if (typeof payload !== "object" || payload === null || typeof payload.exp !== "number") return null;
    return payload.exp > nowSeconds ? payload : null;
  } catch {
    return null;
  }
}
