/**
 * TOTP (RFC 6238) — la double authentification facultative du compte citoyen
 * (CCTP Sceaux 5.1). Codes à 6 chiffres, pas de 30 secondes, HMAC-SHA1 : ce
 * que lisent toutes les applications d'authentification (FreeOTP, Aegis,
 * Google Authenticator…).
 *
 * Le secret ne vit en clair qu'en mémoire : la base n'en garde que le chiffré
 * (`secrets.ts`), et un code déjà servi est refusé (pas de temps consommé en
 * base, `citizen_totp_use_step`).
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> | null {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Un secret neuf : 160 bits, la taille recommandée pour HMAC-SHA1. */
export function newTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export function totpStep(nowSeconds: number): number {
  return Math.floor(nowSeconds / TOTP_STEP_SECONDS);
}

/** Le code d'un pas de temps, sur `digits` chiffres (RFC 4226 §5.3). */
export async function hotp(secret: Uint8Array<ArrayBuffer>, counter: number, digits = TOTP_DIGITS): Promise<string> {
  const message = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    message[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Le pas de temps auquel ce code correspond — l'actuel, ou un voisin (±1, la
 * dérive d'horloge d'un téléphone) — ou `null`. L'appelant consomme ce pas en
 * base : le même code ne sert qu'une fois.
 */
export async function matchTotp(secretBase32: string, code: string, nowSeconds: number): Promise<number | null> {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  if (secret === null || secret.length === 0) return null;
  const current = totpStep(nowSeconds);
  for (const step of [current, current - 1, current + 1]) {
    if ((await hotp(secret, step)) === digits) return step;
  }
  return null;
}

/** L'adresse `otpauth://` que lisent les applications (et le QR code qui la porte). */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
