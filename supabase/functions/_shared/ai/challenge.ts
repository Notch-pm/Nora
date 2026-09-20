/**
 * La preuve de travail qui ouvre une conversation — le frein anti-robot du
 * portail, choisi pour ce qu'il NE fait PAS : aucun tiers ne voit le visiteur,
 * aucun cookie n'est posé, aucune case n'est à cocher. Le portail reste sans
 * bandeau (décision du 2026-09-20 : pas de Turnstile).
 *
 * Le serveur tire un sel, le signe avec son échéance et sa difficulté, et
 * n'en retient rien. Le navigateur cherche un `nonce` tel que l'empreinte
 * SHA-256 de `sel.nonce` commence par `bits` bits nuls : quelques dixièmes de
 * seconde pour un humain, un coût qui s'additionne pour qui en ouvre des
 * milliers. La vérification tient en une empreinte et une signature.
 *
 * ⚠️ Ce que cela n'arrête PAS : un attaquant décidé, et le rejeu d'un défi
 * résolu pendant sa (courte) durée de vie — le serveur n'a pas de mémoire pour
 * le voir. C'est un frein contre le script opportuniste ; la borne opposable
 * est au Socle (cadence par conversation, plafond de la collectivité).
 *
 * Module pur, importé aussi par l'écran (`@fn`) : le même code résout et vérifie.
 */
import type { AssistantChallenge, SolvedChallenge } from "../domain/assistantTurn.ts";
import { sign, verify } from "./signing.ts";

/** Un défi se résout en une seconde : lui laisser deux minutes couvre un appareil lent. */
export const CHALLENGE_TTL_SECONDS = 120;
export const DEFAULT_CHALLENGE_BITS = 15;
/** Au-delà, un téléphone modeste n'ouvrirait plus la conversation. */
const MAX_CHALLENGE_BITS = 22;
const MAX_NONCE_CHARS = 32;

const encoder = new TextEncoder();

export function clampBits(raw: unknown): number {
  const bits = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(bits) || bits < 1) return DEFAULT_CHALLENGE_BITS;
  return Math.min(bits, MAX_CHALLENGE_BITS);
}

function signedPart(salt: string, bits: number, expires: number): string {
  return salt + "." + bits + "." + expires;
}

export async function issueChallenge(
  secret: string,
  nowSeconds: number,
  bits: number = DEFAULT_CHALLENGE_BITS,
): Promise<AssistantChallenge> {
  const salt = crypto.randomUUID();
  const expires = nowSeconds + CHALLENGE_TTL_SECONDS;
  return { salt, bits, expires, signature: await sign(secret, "defi", signedPart(salt, bits, expires)) };
}

/** Nombre de bits nuls en tête d'une empreinte. */
function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    return count + Math.clz32(byte) - 24;
  }
  return count;
}

/**
 * L'empreinte d'une tentative. `binding` LIE le travail à une chose précise.
 *
 * ⚠️ C'est ce qui compense l'absence de mémoire du serveur, pour le DÉPÔT : il
 * ne peut pas voir qu'un défi résolu lui est présenté deux fois. Lié à
 * l'identifiant de la demande (`submissionId`), un défi rejoué ne peut
 * redéposer que LA MÊME demande — qu'Iris dédoublonne déjà par cette clé. Chaque
 * demande nouvelle coûte donc son propre calcul, sans que le serveur retienne rien.
 *
 * Vide pour une conversation : son ouverture n'a rien à quoi se lier, et la
 * borne est ailleurs (ticket signé, cadence et plafond au Socle).
 */
async function digestOf(salt: string, nonce: string, binding: string): Promise<Uint8Array> {
  const input = binding === "" ? salt + "." + nonce : salt + "." + binding + "." + nonce;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(input)));
}

export async function verifySolution(
  secret: string,
  solved: unknown,
  nowSeconds: number,
  binding = "",
): Promise<boolean> {
  if (typeof solved !== "object" || solved === null) return false;
  const { salt, bits, expires, signature, nonce } = solved as Partial<SolvedChallenge>;
  if (typeof salt !== "string" || typeof bits !== "number" || typeof expires !== "number") return false;
  if (typeof nonce !== "string" || nonce === "" || nonce.length > MAX_NONCE_CHARS) return false;
  // La signature d'abord : elle seule dit que `bits` et `expires` sont les
  // nôtres — un visiteur ne choisit ni sa difficulté, ni son échéance.
  if (!(await verify(secret, "defi", signedPart(salt, bits, expires), signature))) return false;
  if (nowSeconds > expires) return false;
  return leadingZeroBits(await digestOf(salt, nonce, binding)) >= bits;
}

/**
 * Résout un défi — côté navigateur. Rend la main à l'interface toutes les
 * `yieldEvery` tentatives : une page qui se fige pendant que l'assistant
 * « s'ouvre » serait une régression d'accessibilité.
 */
export async function solveChallenge(
  challenge: AssistantChallenge,
  yieldEvery = 2000,
  binding = "",
): Promise<SolvedChallenge> {
  for (let attempt = 0; ; attempt++) {
    const nonce = attempt.toString(36);
    if (leadingZeroBits(await digestOf(challenge.salt, nonce, binding)) >= challenge.bits) {
      return { ...challenge, nonce };
    }
    if (attempt % yieldEvery === yieldEvery - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}
