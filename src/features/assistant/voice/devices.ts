/**
 * Le micro et le haut-parleur du mode dialogue — la plomberie du navigateur.
 * Non testé (aucun micro en CI) : la RÈGLE est dans `dialogue.ts` et
 * `endpointer.ts`, testés ; ici, seulement les API du navigateur.
 *
 * ⚠️ RIEN N'EST GARDÉ NI ENVOYÉ D'ICI. Le micro rend des trames au fil
 * principal ; c'est `useVoiceDialogue.ts` qui, une phrase finie, en fait UN
 * fichier WAV et l'envoie à `portal-api` — puis l'oublie.
 */

/** Le micro tel qu'on le tient pendant le dialogue. */
export interface Microphone {
  /** Fréquence native du contexte — les trames sont à cette fréquence. */
  sampleRate: number;
  /** Reçoit chaque trame de ~20 ms ; `null` = on n'écoute pas (l'assistant parle, ou on réfléchit). */
  onFrame: ((frame: Float32Array) => void) | null;
  close(): void;
}

export type MicrophoneOpening =
  | { ok: true; microphone: Microphone }
  /** `denied` : l'usager (ou le site) a refusé ; sinon pas de micro, ou navigateur trop ancien. */
  | { ok: false; denied: boolean };

/** Le navigateur sait-il faire tout ce qu'il faut ? Sinon, le bouton n'est même pas proposé. */
export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof window.AudioContext === "function" &&
    typeof window.AudioWorkletNode === "function" &&
    typeof window.Audio === "function"
  );
}

import { RECORDER_PROCESSOR, RECORDER_WORKLET_SOURCE } from "./recorderWorklet.ts";

/**
 * Les contextes où le processeur est déjà chargé : l'enregistrer deux fois
 * dans le même contexte est une erreur (« already registered »).
 */
const workletLoaded = new WeakSet<AudioContext>();

/**
 * Ouvre le micro. ⚠️ À appeler dans le GESTE de l'usager (un clic) la
 * première fois : c'est ce qui permet à Safari de démarrer l'`AudioContext`.
 */
export async function openMicrophone(context: AudioContext): Promise<MicrophoneOpening> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // L'annulation d'écho et la réduction de bruit du navigateur : précieuses
      // pour un usager sur haut-parleur, dans la rue, ou dans une mairie.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    return { ok: false, denied: name === "NotAllowedError" || name === "SecurityError" };
  }
  try {
    if (context.state === "suspended") await context.resume();
    if (!workletLoaded.has(context)) {
      const url = URL.createObjectURL(new Blob([RECORDER_WORKLET_SOURCE], { type: "application/javascript" }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      workletLoaded.add(context);
    }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, RECORDER_PROCESSOR);
    const microphone: Microphone = {
      sampleRate: context.sampleRate,
      onFrame: null,
      close() {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        // Couper les pistes ÉTEINT le témoin du micro du navigateur : l'usager
        // voit qu'on n'écoute plus.
        stream.getTracks().forEach((track) => track.stop());
      },
    };
    node.port.onmessage = (event: MessageEvent<Float32Array>) => microphone.onFrame?.(event.data);
    source.connect(node);
    return { ok: true, microphone };
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    return { ok: false, denied: false };
  }
}

/**
 * Le haut-parleur : un seul élément `<audio>`, réutilisé.
 *
 * ⚠️ Safari (iOS) refuse de jouer un son qui n'est pas déclenché par un geste
 * de l'usager — or la réponse arrive des secondes après son clic. On
 * « déverrouille » donc l'élément PENDANT le geste qui ouvre le dialogue, en y
 * jouant un silence ; ensuite, il accepte de jouer ce qu'on lui donne.
 */
export interface Speaker {
  unlock(silence: Blob): void;
  /** Joue l'audio ; rend `ended` (fini), `stopped` (coupé) ou `failed`. */
  play(audio: Blob): Promise<"ended" | "stopped" | "failed">;
  stop(): void;
}

export function createSpeaker(): Speaker {
  const element = new Audio();
  element.preload = "auto";
  let settle: ((outcome: "ended" | "stopped" | "failed") => void) | null = null;
  let url: string | null = null;

  const release = () => {
    if (url !== null) URL.revokeObjectURL(url);
    url = null;
  };
  const finish = (outcome: "ended" | "stopped" | "failed") => {
    const done = settle;
    settle = null;
    release();
    done?.(outcome);
  };
  element.onended = () => finish("ended");
  element.onerror = () => finish("failed");

  return {
    unlock(silence) {
      release();
      url = URL.createObjectURL(silence);
      element.src = url;
      void element.play().catch(() => {});
    },
    play(audio) {
      finish("stopped");
      url = URL.createObjectURL(audio);
      element.src = url;
      return new Promise((resolve) => {
        settle = resolve;
        element.play().catch(() => finish("failed"));
      });
    },
    stop() {
      element.pause();
      finish("stopped");
    },
  };
}
