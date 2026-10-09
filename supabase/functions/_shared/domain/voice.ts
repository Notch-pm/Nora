/**
 * Le MODE DIALOGUE de l'assistant — ce qui se dit de vive voix, et dans quelles
 * langues. Écrit une fois ici, lu par le serveur (`portal-api`) comme par
 * l'écran : les deux doivent proposer et accepter la même chose.
 *
 * La voix ne passe pas par le portail plus qu'il ne faut : le navigateur
 * enregistre, `portal-api` relaie au guichet IA du Socle (`ai-api` 1.4.0 :
 * `/v1/transcriptions`, `/v1/speech`), qui détient la clé du fournisseur et
 * compte la dépense. Rien n'est conservé, nulle part.
 *
 * ⚠️ **Deux listes, pas une.** Le fournisseur sait TRANSCRIRE treize langues,
 * mais n'a de VOIX qu'en français et en anglais (essai du 2026-10-09 : une voix
 * française lit l'espagnol avec l'accent, l'arabe, le russe et le chinois en
 * charabia). D'où trois cas :
 *  - `dialogue` — l'usager parle, l'assistant répond à voix haute ;
 *  - `dictation` — l'usager parle, l'assistant répond par écrit ;
 *  - `off` — texte seul (turc, ukrainien… ou voix fermée par la collectivité).
 */
import type { PortalAssistant } from "./assistant.ts";

/** Langues prononcées — celles qui ont une voix au Socle (`SPEECH_LANGUAGES`). */
export const VOICE_OUTPUT_LANGUAGES = ["fr", "en"] as const;

/**
 * Langues dictées — celles que la transcription accepte, parmi celles du
 * portail. ⚠️ L'arabe, le russe et le chinois n'ont été vérifiés qu'en
 * synthèse (ratée), pas avec de vraies voix : à confirmer à l'oreille.
 */
export const VOICE_INPUT_LANGUAGES = ["fr", "en", "es", "de", "it", "pt", "ar", "ru", "zh"] as const;

/**
 * Durée maximale d'une prise de parole. Une réponse à l'assistant tient en
 * quelques phrases ; au-delà, c'est un micro resté ouvert. Le navigateur coupe
 * de lui-même à cette borne, le serveur la refait respecter.
 */
export const MAX_RECORDING_SECONDS = 30;

/**
 * Le format unique que le navigateur envoie : WAV PCM 16 bits, 16 kHz, mono.
 * Un seul format pour tous les navigateurs (Safari n'enregistre pas en Opus),
 * dont la durée se lit dans l'en-tête — c'est ce qui permet de refuser un
 * enregistrement trop long sans le décoder. ≈ 32 Ko par seconde.
 */
export const RECORDING_SAMPLE_RATE = 16_000;
export const RECORDING_MIME_TYPE = "audio/wav";
/** En-tête canonique + 30 s de PCM 16 bits mono. */
export const MAX_RECORDING_BYTES = 44 + MAX_RECORDING_SECONDS * RECORDING_SAMPLE_RATE * 2;

export type VoiceMode = "dialogue" | "dictation" | "off";

/** `fr-CA` → `fr` : le Socle et le fournisseur raisonnent en langue de base. */
export function baseLanguage(lang: string): string {
  return lang.trim().toLowerCase().split("-")[0];
}

export function speaksLanguage(lang: string): boolean {
  return (VOICE_OUTPUT_LANGUAGES as readonly string[]).includes(baseLanguage(lang));
}

export function hearsLanguage(lang: string): boolean {
  return (VOICE_INPUT_LANGUAGES as readonly string[]).includes(baseLanguage(lang));
}

/**
 * Ce que la voix permet ici, maintenant. ⚠️ Au doute, `off` : la voix dépense
 * le crédit de la collectivité, et seul son interrupteur au Socle l'ouvre.
 */
export function voiceModeFor(assistant: PortalAssistant, lang: string): VoiceMode {
  if (!assistant.enabled || !assistant.voiceEnabled) return "off";
  if (speaksLanguage(lang)) return "dialogue";
  if (hearsLanguage(lang)) return "dictation";
  return "off";
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Durée des données réellement présentes, en secondes. */
  seconds: number;
}

/**
 * Lit l'en-tête d'un WAV PCM. `null` pour tout ce qui n'en est pas un — le
 * serveur refuse alors l'enregistrement, sans l'envoyer à personne.
 */
export function readWav(bytes: Uint8Array): WavInfo | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let format: Omit<WavInfo, "seconds"> & { audioFormat: number; byteRate: number } | null = null;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 24 <= bytes.length) {
      format = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        byteRate: view.getUint32(offset + 16, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    }
    if (id === "data") {
      if (format === null || format.audioFormat !== 1 || format.byteRate === 0) return null;
      const available = Math.min(size, bytes.length - offset - 8);
      return {
        sampleRate: format.sampleRate,
        channels: format.channels,
        bitsPerSample: format.bitsPerSample,
        seconds: available / format.byteRate,
      };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/** Le format attendu, exactement — ce que le navigateur du portail produit. */
export function isExpectedRecording(info: WavInfo | null): info is WavInfo {
  return (
    info !== null &&
    info.sampleRate === RECORDING_SAMPLE_RATE &&
    info.channels === 1 &&
    info.bitsPerSample === 16 &&
    info.seconds > 0 &&
    // Une demi-seconde de tolérance : le navigateur coupe à la borne, à un
    // tampon près.
    info.seconds <= MAX_RECORDING_SECONDS + 0.5
  );
}

/**
 * Écrit un WAV PCM 16 bits mono à partir d'échantillons flottants (−1…1) —
 * côté navigateur. Le pendant exact de `readWav`, testé avec lui.
 */
export function encodeWav(samples: Float32Array, sampleRate = RECORDING_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/**
 * Ramène des échantillons à `RECORDING_SAMPLE_RATE` — côté navigateur.
 *
 * ⚠️ On ne demande PAS au navigateur un `AudioContext` à 16 kHz : Firefox
 * refuse de brancher le micro (à sa fréquence propre, 44,1 ou 48 kHz) sur un
 * contexte d'une autre fréquence. On capte à la fréquence native, et on réduit
 * ici : chaque échantillon de sortie est la MOYENNE de ceux qu'il recouvre —
 * un filtre passe-bas grossier, suffisant pour la voix, qui évite le
 * repliement qu'une simple décimation ferait entendre.
 */
export function downsample(input: Float32Array, fromRate: number, toRate = RECORDING_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  if (fromRate < toRate || fromRate <= 0) throw new Error("downsample : fréquence d'entrée inattendue.");
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}
