/**
 * Quand l'usager a-t-il FINI de parler ? — la détection qui rend le dialogue
 * « mains libres » (décision PO du 2026-10-09).
 *
 * ⚠️ Un seuil d'énergie, pas un modèle de détection de la voix. Un modèle
 * (Silero, en WebAssembly) pèse plusieurs mégaoctets et demanderait d'héberger
 * son moteur ; Nora n'a que React pour dépendance. Le seuil SUIT le bruit
 * ambiant (plancher adaptatif) : une rue passante relève la barre, une pièce
 * calme l'abaisse. Ses limites sont connues : une télévision allumée passe pour
 * de la parole. C'est pourquoi la transcription se RELIT avant de partir, et
 * pourquoi l'usager peut toujours couper.
 *
 * Module PUR : on lui donne l'énergie de chaque trame, il dit ce qui se passe.
 * Testé sans micro.
 */

export type EndpointEvent = "none" | "speechStart" | "speechEnd" | "noSpeech" | "maxLength";

export interface EndpointerOptions {
  /** Durée d'une trame, en millisecondes. */
  frameMs: number;
  /** Silence qui clôt une prise de parole. Une pause pour respirer est plus courte. */
  silenceMs?: number;
  /** Parole continue exigée pour croire qu'on parle — un claquement de porte n'est pas une phrase. */
  minSpeechMs?: number;
  /** Personne ne parle depuis l'ouverture du micro : on rend la main. */
  noSpeechMs?: number;
  /** Longueur maximale d'une prise de parole, depuis son début. */
  maxSpeechMs?: number;
}

/** Énergie (RMS) d'une trame — de 0 (silence) à 1. */
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Plancher absolu sous lequel rien n'est de la parole, même dans le silence le
 * plus complet (≈ −36 dBFS) : sans lui, le souffle d'un micro très calme
 * passerait pour une voix.
 */
const MIN_THRESHOLD = 0.015;
/** La parole doit dépasser le bruit ambiant d'autant. */
const SPEECH_RATIO = 3;
/**
 * Hystérésis : on cesse de croire qu'on parle sous 70 % du seuil d'entrée. Sans
 * elle, une voix qui faiblit en fin de phrase basculerait à chaque syllabe.
 */
const RELEASE_RATIO = 0.7;
/**
 * Étalonnage : les premières trames après l'ouverture du micro MESURENT le
 * bruit ambiant au lieu d'y chercher une voix. Sans lui, une rue passante
 * au-dessus du plancher absolu passerait pour une phrase interminable. Le coût :
 * un mot prononcé dans le premier quart de seconde est perdu — l'écran dit
 * « je vous écoute » une fois l'étalonnage fait.
 */
export const CALIBRATION_MS = 250;
/**
 * …mais l'étalonnage ne relève pas le plancher au-delà de ceci : un usager qui
 * parle DÈS l'ouverture du micro ferait sinon de sa propre voix le « bruit
 * ambiant », et ne serait plus jamais entendu.
 */
const MAX_CALIBRATED_FLOOR = 2 * MIN_THRESHOLD;

export function createEndpointer(options: EndpointerOptions) {
  const frameMs = options.frameMs;
  const silenceMs = options.silenceMs ?? 1200;
  const minSpeechMs = options.minSpeechMs ?? 250;
  const noSpeechMs = options.noSpeechMs ?? 8000;
  const maxSpeechMs = options.maxSpeechMs ?? 30_000;

  // Plancher de bruit : démarre bas, et suit l'ambiance — vite quand elle
  // baisse, lentement quand elle monte (une voix ne doit pas s'y fondre).
  let floor = MIN_THRESHOLD / SPEECH_RATIO;
  let state: "waiting" | "speaking" | "done" = "waiting";
  let elapsed = 0;
  let voicedRun = 0;
  let speechElapsed = 0;
  let silence = 0;
  let calibrationSum = 0;
  let calibrationFrames = 0;

  const threshold = () => Math.max(floor * SPEECH_RATIO, MIN_THRESHOLD);

  return {
    /** Le seuil courant — pour un indicateur de niveau, rien d'autre. */
    threshold,
    /** Une trame de plus ; rend l'événement qu'elle déclenche, s'il y en a un. */
    push(level: number): EndpointEvent {
      if (state === "done") return "none";
      elapsed += frameMs;

      if (state === "waiting") {
        if (elapsed <= CALIBRATION_MS) {
          calibrationSum += level;
          calibrationFrames += 1;
          floor = Math.min(Math.max(floor, calibrationSum / calibrationFrames), MAX_CALIBRATED_FLOOR);
          return "none";
        }
        if (level > threshold()) {
          voicedRun += frameMs;
          if (voicedRun >= minSpeechMs) {
            state = "speaking";
            speechElapsed = voicedRun;
            silence = 0;
            return "speechStart";
          }
        } else {
          voicedRun = 0;
          floor = level < floor ? floor * 0.8 + level * 0.2 : floor * 0.995 + level * 0.005;
        }
        if (elapsed >= noSpeechMs) {
          state = "done";
          return "noSpeech";
        }
        return "none";
      }

      // En train de parler.
      speechElapsed += frameMs;
      if (level < threshold() * RELEASE_RATIO) silence += frameMs;
      else silence = 0;
      if (silence >= silenceMs) {
        state = "done";
        return "speechEnd";
      }
      if (speechElapsed >= maxSpeechMs) {
        state = "done";
        return "maxLength";
      }
      return "none";
    },
  };
}

export type Endpointer = ReturnType<typeof createEndpointer>;
