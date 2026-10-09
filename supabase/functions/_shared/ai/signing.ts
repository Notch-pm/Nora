/**
 * Ce que le serveur SIGNE pour pouvoir se passer de mémoire : le ticket d'une
 * conversation, et chacune de ses réponses.
 *
 * HMAC-SHA-256 par WebCrypto (`crypto.subtle`) : présent tel quel dans Deno
 * comme dans Node — aucune dépendance, et les tests tournent sans Deno.
 *
 * ⚠️ Un ticket n'est PAS une session : le serveur ne retient rien, donc il ne
 * voit ni le rejeu d'un ticket, ni deux onglets qui se le partagent. Ce qu'il
 * garantit est plus étroit, et suffisant : un ticket ne vaut que pour SA
 * collectivité, pendant `TICKET_TTL_SECONDS`, et pour un nombre de tours borné —
 * le compteur est dans le ticket, que seul le serveur sait réécrire. Le frein
 * opposable, lui, est au Socle (cadence par conversation, plafond).
 */
import { maxTurnsFor } from "../domain/assistantTurn.ts";

/** Durée de vie d'une conversation d'orientation, en secondes. */
export const TICKET_TTL_SECONDS = 30 * 60;

/**
 * Durée de vie d'une conversation où un recueil est ouvert.
 *
 * Remplir un formulaire en parlant prend plus de trente minutes dès qu'on
 * s'interrompt — chercher une référence, retrouver une date. Une heure. Au
 * delà, le ticket expire mais rien n'est perdu : l'état du recueil vit dans le
 * navigateur, et un défi rouvre la conversation.
 */
export const TICKET_TTL_COLLECT_SECONDS = 60 * 60;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Comparaison à temps constant : la durée ne dit pas où deux signatures divergent. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Signature d'un texte, sous une étiquette qui sépare les usages d'un même secret. */
export async function sign(secret: string, label: string, message: string): Promise<string> {
  return toBase64Url(await hmac(secret, label + "\n" + message));
}

export async function verify(
  secret: string,
  label: string,
  message: string,
  signature: unknown,
): Promise<boolean> {
  if (typeof signature !== "string" || signature === "") return false;
  const given = fromBase64Url(signature);
  if (given === null) return false;
  return sameBytes(given, await hmac(secret, label + "\n" + message));
}

// --- Le ticket d'une conversation -------------------------------------------

export interface Ticket {
  /** Identifiant de la conversation (UUID) — c'est aussi l'`actor_id` du guichet. */
  conversationId: string;
  tenantId: string;
  /** Ouverture de la conversation, secondes Unix. Ne bouge pas d'un tour à l'autre. */
  issuedAt: number;
  /** Tours déjà consommés. */
  turn: number;
  /**
   * Un recueil a été ouvert au cours de cette conversation.
   *
   * ⚠️ **Posé par le SERVEUR seul**, et seulement après avoir constaté un
   * recueil valide (démarche publiée, formulaire présent, dépôt ouvert par la
   * collectivité). Il vit dans le corps SIGNÉ : un navigateur qui l'ajouterait
   * casserait le HMAC, et son ticket serait refusé. C'est ce qui permet de
   * relever la borne de tours sans que personne ne puisse la réclamer.
   *
   * ⚠️ Il ne redescend jamais. Un usager qui abandonne son recueil au tour 25
   * ne doit pas voir sa conversation se fermer dans la seconde.
   */
  collecting: boolean;
}

export type TicketReading =
  | { ok: true; ticket: Ticket }
  | { ok: false; reason: "invalid" | "expired" }
  /**
   * La borne de tours est atteinte — mais le ticket est authentique et vivant.
   * Il ne rouvre AUCUN tour ; il permet seulement de faire LIRE à voix haute la
   * dernière réponse, déjà signée (mode dialogue).
   */
  | { ok: false; reason: "exhausted"; ticket: Ticket };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function issueTicket(secret: string, ticket: Ticket): Promise<string> {
  const body = toBase64Url(
    encoder.encode(
      JSON.stringify({
        c: ticket.conversationId,
        t: ticket.tenantId,
        i: ticket.issuedAt,
        n: ticket.turn,
        // Absent quand il est faux : un ticket d'orientation garde sa taille.
        ...(ticket.collecting ? { r: 1 } : {}),
      }),
    ),
  );
  return body + "." + (await sign(secret, "ticket", body));
}

/**
 * Lit un ticket présenté par le navigateur. `tenantId` est celui du domaine
 * VISITÉ : un ticket obtenu chez une collectivité ne vaut pas chez une autre —
 * ce n'est pas le même crédit.
 */
export async function readTicket(
  secret: string,
  token: unknown,
  tenantId: string,
  nowSeconds: number,
): Promise<TicketReading> {
  if (typeof token !== "string" || token.length > 600) return { ok: false, reason: "invalid" };
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return { ok: false, reason: "invalid" };
  if (!(await verify(secret, "ticket", body, signature))) return { ok: false, reason: "invalid" };

  const bytes = fromBase64Url(body);
  if (bytes === null) return { ok: false, reason: "invalid" };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const { c, t, i, n, r } = raw;
  if (typeof c !== "string" || !UUID_RE.test(c)) return { ok: false, reason: "invalid" };
  if (typeof t !== "string" || t !== tenantId) return { ok: false, reason: "invalid" };
  if (typeof i !== "number" || typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    return { ok: false, reason: "invalid" };
  }
  // ⚠️ Le drapeau n'a que deux formes admises : absent, ou `1`. Tout autre
  // contenu est un ticket qu'on ne sait pas lire — et la signature le rend de
  // toute façon inatteignable depuis le navigateur.
  if (r !== undefined && r !== 1) return { ok: false, reason: "invalid" };
  const collecting = r === 1;

  // Une horloge en avance de quelques secondes ne ferme pas une conversation ;
  // un ticket daté de l'avenir, si.
  if (i > nowSeconds + 60) return { ok: false, reason: "invalid" };
  const ttl = collecting ? TICKET_TTL_COLLECT_SECONDS : TICKET_TTL_SECONDS;
  if (nowSeconds - i > ttl) return { ok: false, reason: "expired" };
  const ticket: Ticket = { conversationId: c, tenantId: t, issuedAt: i, turn: n, collecting };
  if (n >= maxTurnsFor(collecting)) return { ok: false, reason: "exhausted", ticket };
  return { ok: true, ticket };
}

// --- Les réponses de l'assistant --------------------------------------------

/**
 * ⚠️ La signature lie la réponse à SA conversation : une réponse authentique
 * d'une autre conversation ne se recolle pas dans celle-ci. Elle ne porte pas de
 * rang — rejouer dans le même fil une phrase que le serveur y a vraiment écrite
 * n'apprend rien à personne.
 */
export function signReply(secret: string, conversationId: string, content: string): Promise<string> {
  return sign(secret, "reply:" + conversationId, content);
}

export function verifyReply(
  secret: string,
  conversationId: string,
  content: string,
  signature: unknown,
): Promise<boolean> {
  return verify(secret, "reply:" + conversationId, content, signature);
}
