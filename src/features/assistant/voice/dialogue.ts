/**
 * L'AUTOMATE du mode dialogue — qui parle, quand, et ce qui se passe ensuite.
 *
 * Module PUR : il décide, `useVoiceDialogue.ts` exécute (micro, réseau, haut-
 * parleur). Testé sans navigateur.
 *
 *   écoute → transcription → relecture → réflexion → parole → écoute …
 *
 * ⚠️ **Semi-duplex** : le micro n'écoute jamais pendant que l'assistant parle.
 * Pas d'écho à filtrer, pas de voix de l'assistant transcrite comme si
 * l'usager l'avait dite. Pour reprendre la parole, l'usager COUPE (bouton ou
 * touche Espace).
 *
 * ⚠️ **Une carte arrête la boucle.** Un calendrier, une pièce, une identité ne
 * se remplissent pas à la voix (décision PO) : l'assistant l'annonce, puis le
 * micro se tait jusqu'à ce que la carte soit remplie — c'est la carte validée
 * qui relance l'assistant (motif existant), et la boucle reprend avec sa
 * réponse.
 *
 * ⚠️ **Dictée** (langue transcrite mais sans voix) : pas de boucle. L'usager
 * appuie pour parler, l'assistant répond PAR ÉCRIT, le micro attend le geste
 * suivant.
 */

export type DialogueMode = "dialogue" | "dictation";

export type DialoguePhase =
  /** Mode texte : rien n'écoute, rien ne parle. */
  | "off"
  /** Le micro s'ouvre (autorisation, étalonnage). */
  | "opening"
  | "listening"
  | "transcribing"
  /** La transcription est affichée, et partira seule dans un instant — sauf « Corriger ». */
  | "review"
  /** Le tour est parti : l'assistant prépare sa réponse. */
  | "thinking"
  | "speaking"
  /** En attente d'un geste : reprendre, ou remplir une carte. */
  | "paused";

/** Pourquoi la boucle s'est arrêtée — c'est ce que l'écran dit sous le bouton « Reprendre ». */
export type PauseReason =
  | "user"
  | "card"
  | "dictation"
  | "noSpeech"
  | "heardNothing"
  | "micDenied"
  | "micUnavailable"
  | "transcribeFailed"
  | "turnFailed";

export interface DialogueState {
  phase: DialoguePhase;
  mode: DialogueMode;
  pause: PauseReason | null;
  /** Ce que l'usager a dit — affiché pendant la relecture. */
  heard: string | null;
  /** La voix de la dernière réponse n'a pas pu être jouée : on continue, en le disant. */
  speechFailed: boolean;
}

export type DialogueEvent =
  | { type: "start"; mode: DialogueMode }
  | { type: "micReady" }
  | { type: "micFailed"; denied: boolean }
  | { type: "noSpeech" }
  | { type: "speechEnded" }
  | { type: "transcribed"; text: string }
  | { type: "transcribeFailed" }
  /** L'usager reprend la main sur le texte entendu : il part dans la zone de saisie. */
  | { type: "correct" }
  /** Un tour vient de partir — par la voix, le clavier, ou une carte validée. */
  | { type: "sent" }
  /** La réponse est arrivée. */
  | { type: "replied" }
  /** La réponse a été dite (ou n'a pas pu l'être). */
  | { type: "spoken"; cardWaiting: boolean; failed: boolean }
  /** Couper la parole à l'assistant, ou reprendre l'écoute. */
  | { type: "interrupt" }
  | { type: "resume" }
  | { type: "turnFailed" }
  | { type: "stop" };

export function initialDialogue(): DialogueState {
  return { phase: "off", mode: "dialogue", pause: null, heard: null, speechFailed: false };
}

const paused = (state: DialogueState, pause: PauseReason): DialogueState => ({
  ...state,
  phase: "paused",
  pause,
  heard: null,
});

export function reduceDialogue(state: DialogueState, event: DialogueEvent): DialogueState {
  if (event.type === "stop") return initialDialogue();
  if (event.type === "start") {
    return { phase: "opening", mode: event.mode, pause: null, heard: null, speechFailed: false };
  }
  if (state.phase === "off") return state;

  switch (event.type) {
    case "micReady":
      return state.phase === "opening" ? { ...state, phase: "listening", pause: null } : state;
    case "micFailed":
      return paused(state, event.denied ? "micDenied" : "micUnavailable");
    case "noSpeech":
      return state.phase === "listening" ? paused(state, "noSpeech") : state;
    case "speechEnded":
      return state.phase === "listening" ? { ...state, phase: "transcribing" } : state;
    case "transcribed": {
      if (state.phase !== "transcribing") return state;
      const text = event.text.trim();
      // Rien d'intelligible : on n'envoie pas un message vide à l'assistant.
      if (text === "") return paused(state, "heardNothing");
      return { ...state, phase: "review", heard: text };
    }
    case "transcribeFailed":
      return state.phase === "transcribing" ? paused(state, "transcribeFailed") : state;
    case "correct":
      return state.phase === "review" ? paused(state, "user") : state;
    case "sent":
      // Quel que soit le chemin du tour (voix, clavier, carte), le micro se tait
      // pendant que l'assistant réfléchit.
      return { ...state, phase: "thinking", pause: null, heard: null, speechFailed: false };
    case "replied":
      if (state.phase !== "thinking") return state;
      return state.mode === "dialogue" ? { ...state, phase: "speaking" } : paused(state, "dictation");
    case "spoken": {
      if (state.phase !== "speaking") return state;
      const next = { ...state, speechFailed: event.failed };
      return event.cardWaiting ? paused(next, "card") : { ...next, phase: "opening", pause: null };
    }
    case "interrupt":
      return state.phase === "speaking" ? { ...state, phase: "opening", pause: null } : state;
    case "resume":
      return state.phase === "paused" ? { ...state, phase: "opening", pause: null, speechFailed: false } : state;
    case "turnFailed":
      return paused(state, "turnFailed");
  }
}

/** Le micro doit-il être OUVERT dans cette phase ? (Il se ferme en pause : le témoin du navigateur s'éteint.) */
export function holdsMicrophone(phase: DialoguePhase): boolean {
  return phase === "opening" || phase === "listening" || phase === "transcribing" || phase === "review" ||
    phase === "thinking" || phase === "speaking";
}

/** Durée de la relecture avant envoi automatique — assez pour lire une phrase, et l'arrêter. */
export const REVIEW_MS = 2500;
