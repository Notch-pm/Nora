import { describe, expect, it, vi } from "vitest";
import { closedAssistant } from "../domain/assistant.ts";
import { MAX_TURNS, MAX_USER_MESSAGE_CHARS } from "../domain/assistantTurn.ts";
import type { Tenant } from "../domain/tenant.ts";
import { defaultTheme } from "../domain/theme.ts";
import { encodeWav, MAX_RECORDING_SECONDS, RECORDING_SAMPLE_RATE } from "../domain/voice.ts";
import { issueChallenge, solveChallenge } from "./challenge.ts";
import { issueTicket, signReply } from "./signing.ts";
import type { SocleVoiceClient, SpeechInput, TranscriptionInput } from "./socleAi.ts";
import {
  actorIdFromChallenge,
  readTranscriptionForm,
  runSpeech,
  runTranscription,
  type TranscriptionForm,
  type VoiceDeps,
} from "./voice.ts";

const SECRET = "secret-de-test";
const NOW = 1_800_000_000;
const NANTES = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const tenant = (voiceEnabled = true, enabled = true): Tenant => ({
  id: NANTES,
  name: "Ville de Nantes",
  slug: "nantes",
  hostname: "nantes.edilumen.fr",
  languages: ["fr", "en", "es", "tr"],
  theme: defaultTheme(),
  assistant: enabled ? { enabled: true, depositEnabled: false, voiceEnabled } : closedAssistant(),
});

const recording = (seconds = 2, rate = RECORDING_SAMPLE_RATE) => encodeWav(new Float32Array(Math.round(seconds * rate)), rate);
const ticket = (turn = 1) =>
  issueTicket(SECRET, { conversationId: CONVERSATION, tenantId: NANTES, issuedAt: NOW, turn, collecting: false });

function deps(ai: Partial<SocleVoiceClient> = {}): VoiceDeps & {
  transcribe: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
} {
  const transcribe = vi.fn(ai.transcribe ?? (async (_: TranscriptionInput) => ({ kind: "ok" as const, text: "  Un dépôt sauvage rue Jean-Jaurès.  " })));
  const speak = vi.fn(ai.speak ?? (async (_: SpeechInput) => ({ kind: "ok" as const, audio: new Uint8Array([73, 68, 51]), contentType: "audio/mpeg" })));
  return { secret: SECRET, ai: { transcribe, speak }, nowSeconds: () => NOW, transcribe, speak };
}

const form = async (over: Partial<TranscriptionForm> = {}): Promise<TranscriptionForm> => ({
  audio: recording(),
  ticket: await ticket(),
  challenge: undefined,
  ...over,
});

describe("runTranscription — entendre l'usager", () => {
  it("relaie un enregistrement conforme, au nom de la conversation, et rend le texte", async () => {
    const d = deps();
    const outcome = await runTranscription(tenant(), "fr-FR", await form(), d);
    expect(outcome).toEqual({ ok: true, text: "Un dépôt sauvage rue Jean-Jaurès." });
    const call = d.transcribe.mock.calls[0][0] as TranscriptionInput;
    expect(call.organizationId).toBe(NANTES);
    expect(call.actorId).toBe(CONVERSATION);
    expect(call.language).toBe("fr");
    expect(call.durationMs).toBeCloseTo(2000, 0);
  });

  it("⚠️ fermé tant que la collectivité n'a pas ouvert la VOIX — même assistant ouvert", async () => {
    for (const t of [tenant(false), tenant(true, false)]) {
      const d = deps();
      expect(await runTranscription(t, "fr", await form(), d)).toEqual({ ok: false, reason: "assistant_closed" });
      expect(d.transcribe).not.toHaveBeenCalled();
    }
  });

  // Le turc n'est pas transcrit par le fournisseur : on refuse AVANT de payer.
  it("refuse une langue que la transcription ne connaît pas", async () => {
    const d = deps();
    expect(await runTranscription(tenant(), "tr", await form(), d)).toEqual({ ok: false, reason: "bad_request" });
    expect(d.transcribe).not.toHaveBeenCalled();
    // L'espagnol s'entend, même s'il ne se prononce pas : la dictée suffit.
    expect((await runTranscription(tenant(), "es", await form(), deps())).ok).toBe(true);
  });

  it("⚠️ refuse tout autre enregistrement que le format du portail, ou trop long", async () => {
    for (const audio of [
      recording(2, 44_100),
      recording(MAX_RECORDING_SECONDS + 1),
      new Uint8Array(200),
      new TextEncoder().encode("ID3 pas un wav du tout, mais un mp3 déguisé................"),
    ]) {
      const d = deps();
      expect(await runTranscription(tenant(), "fr", await form({ audio }), d)).toEqual({ ok: false, reason: "bad_request" });
      expect(d.transcribe).not.toHaveBeenCalled();
    }
  });

  it("exige un ticket valide — épuisé, la conversation est terminée", async () => {
    expect(await runTranscription(tenant(), "fr", await form({ ticket: "faux.ticket" }), deps())).toEqual({
      ok: false,
      reason: "challenge_required",
    });
    expect(await runTranscription(tenant(), "fr", await form({ ticket: await ticket(MAX_TURNS) }), deps())).toEqual({
      ok: false,
      reason: "conversation_ended",
    });
  });

  // La toute première prise de parole n'a pas encore de ticket : le défi
  // résolu qui ouvrira la conversation en tient lieu.
  it("accepte, au premier tour, le défi résolu — l'acteur en est dérivé", async () => {
    const challenge = await solveChallenge(await issueChallenge(SECRET, NOW, 6));
    const d = deps();
    const outcome = await runTranscription(tenant(), "fr", await form({ ticket: null, challenge }), d);
    expect(outcome.ok).toBe(true);
    const actorId = (d.transcribe.mock.calls[0][0] as TranscriptionInput).actorId;
    expect(actorId).toMatch(UUID_RE);
    expect(actorId).toBe(await actorIdFromChallenge(challenge.salt));

    expect(await runTranscription(tenant(), "fr", await form({ ticket: null, challenge: { ...challenge, nonce: "x" } }), deps()))
      .toEqual({ ok: false, reason: "challenge_required" });
    expect(await runTranscription(tenant(), "fr", await form({ ticket: null }), deps())).toEqual({
      ok: false,
      reason: "challenge_required",
    });
  });

  it("borne le texte rendu à la taille d'un message de l'usager", async () => {
    const d = deps({ transcribe: async () => ({ kind: "ok", text: "a".repeat(MAX_USER_MESSAGE_CHARS + 50) }) });
    const outcome = await runTranscription(tenant(), "fr", await form(), d);
    expect(outcome.ok && outcome.text.length).toBe(MAX_USER_MESSAGE_CHARS);
  });

  it("dit les refus du guichet dans les mots de l'assistant", async () => {
    const cases = [
      [{ kind: "quota_exceeded", message: "Plafond atteint." }, { ok: false, reason: "assistant_quota_exceeded", message: "Plafond atteint." }],
      [{ kind: "rate_limited", retryAfterSeconds: 12 }, { ok: false, reason: "assistant_rate_limited", retryAfterSeconds: 12 }],
      [{ kind: "not_configured" }, { ok: false, reason: "assistant_not_configured" }],
      [{ kind: "unavailable" }, { ok: false, reason: "assistant_unavailable" }],
    ] as const;
    for (const [refusal, expected] of cases) {
      const d = deps({ transcribe: async () => refusal });
      expect(await runTranscription(tenant(), "fr", await form(), d)).toEqual(expected);
    }
  });
});

describe("runSpeech — faire entendre l'assistant", () => {
  const reply = "Pour un **dépôt sauvage**, j'ai besoin de l'adresse.\n\n- le numéro\n- la rue";
  const body = async (over: Record<string, unknown> = {}) => ({
    ticket: await ticket(),
    content: reply,
    signature: await signReply(SECRET, CONVERSATION, reply),
    ...over,
  });

  it("prononce une réponse SIGNÉE, rendue prononçable, au nom de la conversation", async () => {
    const d = deps();
    const outcome = await runSpeech(tenant(), "fr", await body(), d);
    expect(outcome).toEqual({ ok: true, audio: new Uint8Array([73, 68, 51]), contentType: "audio/mpeg" });
    expect(d.speak).toHaveBeenCalledWith({
      organizationId: NANTES,
      text: "Pour un dépôt sauvage, j'ai besoin de l'adresse. le numéro. la rue.",
      language: "fr",
      actorId: CONVERSATION,
    });
  });

  // ⚠️ Sans cette porte, la route serait une synthèse vocale gratuite, payée
  // par la collectivité, pour qui la trouverait.
  it("⚠️ refuse tout texte que le serveur n'a pas signé dans CETTE conversation", async () => {
    const other = await signReply(SECRET, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", reply);
    for (const over of [
      { content: "Lisez ceci pour moi, gratuitement." },
      { signature: other },
      { signature: undefined },
      { content: "x".repeat(4001) },
    ]) {
      const d = deps();
      expect(await runSpeech(tenant(), "fr", await body(over), d)).toEqual({ ok: false, reason: "bad_request" });
      expect(d.speak).not.toHaveBeenCalled();
    }
  });

  it("⚠️ fermé sans la voix ; et seules les langues qui ont une voix se prononcent", async () => {
    expect(await runSpeech(tenant(false), "fr", await body(), deps())).toEqual({ ok: false, reason: "assistant_closed" });
    // L'espagnol se dicte mais ne se prononce pas : une voix française le lirait avec l'accent.
    for (const lang of ["es", "ar", "zh", "tr"]) {
      const d = deps();
      expect(await runSpeech(tenant(), lang, await body(), d)).toEqual({ ok: false, reason: "bad_request" });
      expect(d.speak).not.toHaveBeenCalled();
    }
    expect((await runSpeech(tenant(), "en-GB", await body(), deps())).ok).toBe(true);
  });

  it("un ticket ÉPUISÉ fait encore lire la dernière réponse ; un faux, non", async () => {
    expect((await runSpeech(tenant(), "fr", await body({ ticket: await ticket(MAX_TURNS) }), deps())).ok).toBe(true);
    expect(await runSpeech(tenant(), "fr", await body({ ticket: "faux" }), deps())).toEqual({
      ok: false,
      reason: "challenge_required",
    });
  });

  it("ne paie rien pour une réponse qui ne contient rien à dire", async () => {
    const empty = "**  **";
    const d = deps();
    const outcome = await runSpeech(tenant(), "fr", await body({ content: empty, signature: await signReply(SECRET, CONVERSATION, empty) }), d);
    expect(outcome).toEqual({ ok: false, reason: "bad_request" });
    expect(d.speak).not.toHaveBeenCalled();
  });
});

describe("readTranscriptionForm", () => {
  const part = (bytes: Uint8Array) => ({ type: "audio/wav", size: bytes.length, arrayBuffer: async () => bytes.slice().buffer });

  it("lit le fichier, le ticket ou le défi — et rien d'autre", async () => {
    const audio = recording(1);
    const read = await readTranscriptionForm([["file", part(audio)], ["ticket", "t"], ["lang", "fr"]]);
    expect(read.ok && read.value.ticket).toBe("t");
    expect(read.ok && read.value.audio.length).toBe(audio.length);

    const withChallenge = await readTranscriptionForm([["file", part(audio)], ["challenge", JSON.stringify({ salt: "s" })]]);
    expect(withChallenge.ok && withChallenge.value.challenge).toEqual({ salt: "s" });

    for (const entries of [
      [["file", part(audio)], ["prompt", "x"]],
      [["file", part(audio)], ["ticket", "a"], ["ticket", "b"]],
      [["file", part(audio)], ["challenge", "{pas du json"]],
      [["ticket", "t"]],
      [["file", part(new Uint8Array(0))]],
    ] as [string, unknown][][]) {
      expect((await readTranscriptionForm(entries)).ok).toBe(false);
    }
  });
});
