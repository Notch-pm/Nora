/**
 * Les deux gestes du MODE DIALOGUE, côté serveur — entendre l'usager, et faire
 * entendre l'assistant. `portal-api` les branche sur
 * `POST /v1/assistant/transcription` et `POST /v1/assistant/voix`.
 *
 * Le portail ne garde rien et ne parle pas au fournisseur : il vérifie, puis
 * relaie au guichet IA du Socle (`ai-api` 1.4.0), qui compte la dépense sur le
 * plafond — et la part — de la collectivité.
 *
 * ⚠️ **Les mêmes portes que la conversation, plus deux.**
 *  - La collectivité a ouvert l'assistant ET la voix (`voiceEnabled`, Socle
 *    1.37.0) — et la langue de l'usager s'entend (`hearsLanguage`) ou se
 *    prononce (`speaksLanguage`).
 *  - Le visiteur présente un ticket du serveur — ou, pour sa toute PREMIÈRE
 *    prise de parole, le défi résolu qui ouvrira la conversation.
 *  - Transcrire : l'enregistrement est EXACTEMENT le format du portail (WAV PCM
 *    16 bits, 16 kHz, mono) et dure 30 s au plus — lu dans son en-tête, avant
 *    tout envoi.
 *  - Prononcer : le texte est une réponse que le serveur a SIGNÉE dans cette
 *    conversation. Sans cette porte, la route serait une synthèse vocale
 *    gratuite, payée par la collectivité, pour qui la trouverait.
 *
 * ⚠️ RIEN N'EST JOURNALISÉ — ni l'audio, ni ce qu'il dit, ni ce que l'assistant
 * prononce. Le fil n'existe que dans l'onglet de l'usager.
 */
import { MAX_USER_MESSAGE_CHARS, type AssistantFailure } from "../domain/assistantTurn.ts";
import type { Tenant } from "../domain/tenant.ts";
import {
  baseLanguage,
  hearsLanguage,
  isExpectedRecording,
  MAX_RECORDING_BYTES,
  readWav,
  speaksLanguage,
} from "../domain/voice.ts";
import { verifySolution } from "./challenge.ts";
import { readTicket, verifyReply } from "./signing.ts";
import type { GuichetRefusal, SocleVoiceClient } from "./socleAi.ts";
import { speakable } from "./speakable.ts";

/** Une réponse de l'assistant ne dépasse jamais cette taille (`turn.ts`). */
const MAX_ASSISTANT_MESSAGE_CHARS = 4000;
/** Un défi sérialisé tient largement là-dedans ; au-delà, ce n'en est pas un. */
const MAX_CHALLENGE_CHARS = 1000;

export interface VoiceDeps {
  secret: string;
  ai: SocleVoiceClient;
  nowSeconds(): number;
}

export type VoiceFailure = { ok: false; reason: AssistantFailure; retryAfterSeconds?: number; message?: string };

const fail = (reason: AssistantFailure): VoiceFailure => ({ ok: false, reason });

/** Un refus du guichet, dans les mots de l'assistant — le même classement que `runAssistantTurn`. */
export function failureForRefusal(refusal: GuichetRefusal): VoiceFailure {
  switch (refusal.kind) {
    case "quota_exceeded":
      return { ok: false, reason: "assistant_quota_exceeded", message: refusal.message ?? undefined };
    case "rate_limited":
      return { ok: false, reason: "assistant_rate_limited", retryAfterSeconds: refusal.retryAfterSeconds };
    case "not_configured":
      return fail("assistant_not_configured");
    case "unavailable":
      return fail("assistant_unavailable");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * L'acteur d'une PREMIÈRE prise de parole, avant tout ticket : un UUID dérivé
 * du sel du défi. Stable pour ce défi — ses essais se comptent ensemble au
 * Socle — et sans lien avec la conversation qui s'ouvrira ensuite.
 */
export async function actorIdFromChallenge(salt: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("voix:" + salt)),
  );
  const hex = Array.from(digest.subarray(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  // Version 4, variante RFC 4122 : un UUID que tout validateur accepte.
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// --- Entendre ---------------------------------------------------------------

/** Le minimum lu d'un fichier de formulaire (testable sans `File`). */
export interface RecordingPart {
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface TranscriptionForm {
  audio: Uint8Array<ArrayBuffer>;
  ticket: string | null;
  challenge: unknown;
}

const TRANSCRIPTION_FIELDS = new Set(["file", "ticket", "challenge", "lang"]);

function isRecordingPart(value: unknown): value is RecordingPart {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RecordingPart).arrayBuffer === "function" &&
    typeof (value as RecordingPart).size === "number"
  );
}

/**
 * Le formulaire multipart de `POST /v1/assistant/transcription` : `file`,
 * `ticket` OU `challenge` (le défi résolu, en JSON), `lang`. Tout autre champ
 * est refusé — rien n'est relayé que le portail n'ait lu.
 */
export async function readTranscriptionForm(
  entries: Iterable<[string, unknown]>,
): Promise<{ ok: true; value: TranscriptionForm } | VoiceFailure> {
  const fields = new Map<string, unknown>();
  for (const [key, value] of entries) {
    if (!TRANSCRIPTION_FIELDS.has(key) || fields.has(key)) return fail("bad_request");
    fields.set(key, value);
  }
  const file = fields.get("file");
  if (!isRecordingPart(file) || file.size === 0 || file.size > MAX_RECORDING_BYTES) return fail("bad_request");

  const ticket = fields.get("ticket");
  if (ticket !== undefined && typeof ticket !== "string") return fail("bad_request");
  let challenge: unknown = undefined;
  const rawChallenge = fields.get("challenge");
  if (rawChallenge !== undefined) {
    if (typeof rawChallenge !== "string" || rawChallenge.length > MAX_CHALLENGE_CHARS) return fail("bad_request");
    try {
      challenge = JSON.parse(rawChallenge);
    } catch {
      return fail("bad_request");
    }
  }
  return {
    ok: true,
    value: { audio: new Uint8Array(await file.arrayBuffer()), ticket: ticket ?? null, challenge },
  };
}

/** Ce qu'a dit l'usager — à lui de le relire, puis de l'envoyer comme un message. */
export async function runTranscription(
  tenant: Tenant,
  lang: string,
  form: TranscriptionForm,
  deps: VoiceDeps,
): Promise<{ ok: true; text: string } | VoiceFailure> {
  if (!tenant.assistant.enabled || !tenant.assistant.voiceEnabled) return fail("assistant_closed");
  if (!hearsLanguage(lang)) return fail("bad_request");

  const wav = readWav(form.audio);
  if (!isExpectedRecording(wav)) return fail("bad_request");

  // Qui parle : la conversation en cours, ou celle que ce défi va ouvrir.
  const now = deps.nowSeconds();
  let actorId: string;
  if (form.ticket !== null) {
    const reading = await readTicket(deps.secret, form.ticket, tenant.id, now);
    if (!reading.ok) return fail(reading.reason === "exhausted" ? "conversation_ended" : "challenge_required");
    actorId = reading.ticket.conversationId;
  } else {
    if (!(await verifySolution(deps.secret, form.challenge, now))) return fail("challenge_required");
    actorId = await actorIdFromChallenge((form.challenge as { salt: string }).salt);
  }

  const result = await deps.ai.transcribe({
    organizationId: tenant.id,
    audio: form.audio,
    durationMs: wav.seconds * 1000,
    language: baseLanguage(lang),
    actorId,
  });
  if (result.kind !== "ok") return failureForRefusal(result);
  // Ce texte deviendra un message de l'usager : il en respecte la borne.
  return { ok: true, text: result.text.slice(0, MAX_USER_MESSAGE_CHARS).trim() };
}

// --- Faire entendre ---------------------------------------------------------

/**
 * La voix d'une réponse de l'assistant. Corps : `{ ticket, content, signature }`
 * — la réponse telle que `POST /v1/assistant` l'a rendue, signature comprise.
 */
export async function runSpeech(
  tenant: Tenant,
  lang: string,
  body: unknown,
  deps: VoiceDeps,
): Promise<{ ok: true; audio: Uint8Array<ArrayBuffer>; contentType: string } | VoiceFailure> {
  if (!tenant.assistant.enabled || !tenant.assistant.voiceEnabled) return fail("assistant_closed");
  if (!speaksLanguage(lang)) return fail("bad_request");
  if (!isRecord(body)) return fail("bad_request");

  // ⚠️ Un ticket ÉPUISÉ suffit ici : la dernière réponse d'une conversation
  // arrivée à sa borne mérite d'être dite comme les autres. Il ne rouvre aucun
  // tour — seule la route de conversation en ouvre.
  const reading = await readTicket(deps.secret, body.ticket, tenant.id, deps.nowSeconds());
  const ticket = reading.ok ? reading.ticket : reading.reason === "exhausted" ? reading.ticket : null;
  if (ticket === null) return fail("challenge_required");

  const content = body.content;
  if (typeof content !== "string" || content === "" || content.length > MAX_ASSISTANT_MESSAGE_CHARS) {
    return fail("bad_request");
  }
  if (!(await verifyReply(deps.secret, ticket.conversationId, content, body.signature))) {
    return fail("bad_request");
  }
  const text = speakable(content);
  if (text === "") return fail("bad_request");

  const result = await deps.ai.speak({
    organizationId: tenant.id,
    text,
    language: baseLanguage(lang),
    actorId: ticket.conversationId,
  });
  if (result.kind !== "ok") return failureForRefusal(result);
  return { ok: true, audio: result.audio, contentType: result.contentType };
}
