/**
 * Orchestre le MODE DIALOGUE : micro, fin de parole, transcription, relecture,
 * voix de l'assistant. Toute la RÈGLE est dans `dialogue.ts` (l'automate) et
 * `endpointer.ts` (la fin de parole), purs et testés ; ici, seulement la
 * plomberie — non testée, comme `useAssistantConversation.ts`.
 *
 * Le dialogue ne parle pas au serveur de conversation lui-même : il passe par
 * les mêmes gestes que le clavier (`send`), et ÉCOUTE l'état de la
 * conversation pour savoir qu'une réponse est arrivée — qu'elle suive une
 * phrase dite, tapée, ou une carte validée.
 *
 * ⚠️ RIEN N'EST GARDÉ. L'enregistrement d'une phrase vit en mémoire le temps
 * de l'envoyer, puis est oublié ; ni `sessionStorage`, ni journal.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { solveChallenge } from "@fn/_shared/ai/challenge.ts";
import type { SolvedChallenge } from "@fn/_shared/domain/assistantTurn.ts";
import { downsample, encodeWav, MAX_RECORDING_SECONDS, type VoiceMode } from "@fn/_shared/domain/voice.ts";
import { fetchAssistantChallenge, fetchAssistantSpeech, transcribeRecording } from "@/services/portal/portalClient.ts";
import type { ConversationState } from "../conversation.ts";
import { createEndpointer, rms, type Endpointer } from "./endpointer.ts";
import { holdsMicrophone, initialDialogue, reduceDialogue, REVIEW_MS, type DialogueState } from "./dialogue.ts";
import { createSpeaker, openMicrophone, voiceSupported, type Microphone, type Speaker } from "./devices.ts";

/** Ce qu'on garde avant le début détecté de la parole : la première syllabe n'est pas coupée. */
const PREROLL_MS = 400;
/** Un défi qui expire dans moins de ceci ne sert plus : on en refait un. */
const CHALLENGE_MARGIN_SECONDS = 15;

/**
 * Le défi de la toute première phrase, résolu PENDANT que l'usager parle —
 * plutôt qu'après, où il s'ajoutait à l'attente de la réponse.
 */
async function freshChallenge(): Promise<SolvedChallenge | null> {
  const load = await fetchAssistantChallenge();
  return load.ok ? solveChallenge(load.challenge) : null;
}

function stillValid(challenge: SolvedChallenge | null): challenge is SolvedChallenge {
  return challenge !== null && challenge.expires - Date.now() / 1000 > CHALLENGE_MARGIN_SECONDS;
}

export interface UseVoiceDialogue {
  state: DialogueState;
  /** Niveau du micro (0…1), pour l'indicateur — rafraîchi au dixième de seconde. */
  level: number;
  /** Le navigateur sait-il écouter et parler ? Sinon, le bouton n'est pas proposé. */
  supported: boolean;
  /** À appeler DANS le clic de l'usager : c'est ce qui autorise le son sur Safari. */
  start: () => void;
  stop: () => void;
  resume: () => void;
  interrupt: () => void;
  /** Envoie tout de suite ce qui a été entendu, sans attendre la fin de la relecture. */
  sendNow: () => void;
  /** Rend ce qui a été entendu à la zone de saisie, pour le corriger au clavier. */
  correct: () => void;
}

export function useVoiceDialogue(params: {
  mode: VoiceMode;
  lang: string;
  conversation: ConversationState;
  /** Une carte attend un geste à l'écran (date, pièce, organisme, identité, récapitulatif). */
  cardWaiting: boolean;
  /** Envoie ce que l'usager a dit, comme s'il l'avait tapé. */
  send: (text: string, challenge: SolvedChallenge | null) => boolean;
  /** Met ce que l'usager a dit dans la zone de saisie. */
  onCorrect: (text: string) => void;
}): UseVoiceDialogue {
  const { mode, lang, conversation, cardWaiting, send, onCorrect } = params;
  const [state, dispatch] = useReducer(reduceDialogue, undefined, initialDialogue);
  const [level, setLevel] = useState(0);
  const supported = voiceSupported();

  const contextRef = useRef<AudioContext | null>(null);
  const microphoneRef = useRef<Microphone | null>(null);
  const speakerRef = useRef<Speaker | null>(null);
  // Le défi résolu pour la toute première transcription : il ouvrira aussi la conversation.
  const solvedRef = useRef<SolvedChallenge | null>(null);
  const solvingRef = useRef<Promise<SolvedChallenge | null> | null>(null);
  // Incrémenté à chaque arrêt : une réponse réseau tardive ne touche plus rien.
  const generationRef = useRef(0);
  // Valeurs lues par des fonctions asynchrones : toujours les plus récentes.
  const live = useRef({ conversation, cardWaiting, lang, send, onCorrect, heard: state.heard });
  live.current = { conversation, cardWaiting, lang, send, onCorrect, heard: state.heard };

  const closeMicrophone = useCallback(() => {
    microphoneRef.current?.close();
    microphoneRef.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(() => {
    if (mode === "off" || !supported) return;
    generationRef.current += 1;
    // ⚠️ DANS LE GESTE : Safari ne démarre un contexte audio, et n'accepte de
    // jouer un son plus tard, que si le premier pas a été fait par l'usager.
    if (contextRef.current === null) contextRef.current = new AudioContext();
    void contextRef.current.resume().catch(() => {});
    if (speakerRef.current === null) speakerRef.current = createSpeaker();
    speakerRef.current.unlock(new Blob([encodeWav(new Float32Array(800))], { type: "audio/wav" }));
    solvedRef.current = null;
    // Pas encore de conversation : le défi qui l'ouvrira se résout pendant que
    // l'usager parle.
    solvingRef.current = live.current.conversation.ticket === null ? freshChallenge() : null;
    dispatch({ type: "start", mode });
  }, [mode, supported]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    speakerRef.current?.stop();
    closeMicrophone();
    solvedRef.current = null;
    solvingRef.current = null;
    dispatch({ type: "stop" });
  }, [closeMicrophone]);

  // Le mode n'est plus possible (langue changée, voix fermée) : on revient au texte.
  useEffect(() => {
    if (mode === "off" && state.phase !== "off") stop();
  }, [mode, state.phase, stop]);

  // Démontage : rien ne doit rester ouvert — ni micro, ni contexte, ni son.
  useEffect(
    () => () => {
      generationRef.current += 1;
      speakerRef.current?.stop();
      microphoneRef.current?.close();
      void contextRef.current?.close().catch(() => {});
    },
    [],
  );

  // Le micro se ferme dès qu'on est en pause : le témoin du navigateur s'éteint.
  useEffect(() => {
    if (!holdsMicrophone(state.phase)) closeMicrophone();
  }, [state.phase, closeMicrophone]);

  // ── Ouvrir le micro ────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "opening") return;
    if (microphoneRef.current !== null) {
      dispatch({ type: "micReady" });
      return;
    }
    const generation = generationRef.current;
    const context = contextRef.current;
    if (context === null) {
      dispatch({ type: "micFailed", denied: false });
      return;
    }
    void openMicrophone(context).then((opening) => {
      if (generationRef.current !== generation) {
        if (opening.ok) opening.microphone.close();
        return;
      }
      if (!opening.ok) {
        dispatch({ type: "micFailed", denied: opening.denied });
        return;
      }
      microphoneRef.current = opening.microphone;
      dispatch({ type: "micReady" });
    });
  }, [state.phase]);

  // ── Écouter une phrase, puis la faire transcrire ───────────────────────────
  useEffect(() => {
    const microphone = microphoneRef.current;
    if (state.phase !== "listening" || microphone === null) return;
    const generation = generationRef.current;
    const frameMs = 20;
    const endpointer: Endpointer = createEndpointer({ frameMs, maxSpeechMs: MAX_RECORDING_SECONDS * 1000 - 500 });
    let frames: Float32Array[] = [];
    let speaking = false;
    let lastLevelAt = 0;

    microphone.onFrame = (frame) => {
      const energy = rms(frame);
      frames.push(frame);
      const now = performance.now();
      if (now - lastLevelAt > 100) {
        lastLevelAt = now;
        setLevel(Math.min(1, energy * 6));
      }
      if (!speaking) {
        // Avant la parole, on ne garde que le pré-enregistrement.
        const keep = Math.ceil(PREROLL_MS / frameMs);
        if (frames.length > keep) frames = frames.slice(-keep);
      }
      const event = endpointer.push(energy);
      if (event === "speechStart") speaking = true;
      if (event === "noSpeech") {
        microphone.onFrame = null;
        dispatch({ type: "noSpeech" });
      }
      if (event === "speechEnd" || event === "maxLength") {
        microphone.onFrame = null;
        setLevel(0);
        dispatch({ type: "speechEnded" });
        void transcribe(frames, microphone.sampleRate, generation);
      }
    };
    return () => {
      microphone.onFrame = null;
    };
  }, [state.phase]);

  async function transcribe(frames: Float32Array[], sampleRate: number, generation: number): Promise<void> {
    const total = frames.reduce((sum, frame) => sum + frame.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const frame of frames) {
      samples.set(frame, offset);
      offset += frame.length;
    }
    const wav = new Blob([encodeWav(downsample(samples, sampleRate))], { type: "audio/wav" });

    // La conversation en cours, ou — à la toute première phrase — le défi qui l'ouvrira.
    const ticket = live.current.conversation.ticket;
    let auth: { ticket: string } | { challenge: SolvedChallenge };
    if (ticket !== null) {
      auth = { ticket };
    } else {
      if (!stillValid(solvedRef.current)) {
        const pending = solvingRef.current;
        solvingRef.current = null;
        const prepared = pending !== null ? await pending : null;
        solvedRef.current = stillValid(prepared) ? prepared : await freshChallenge();
        if (generationRef.current !== generation) return;
        if (solvedRef.current === null) {
          dispatch({ type: "transcribeFailed" });
          return;
        }
      }
      auth = { challenge: solvedRef.current };
    }
    const result = await transcribeRecording({ wav, auth, lang: live.current.lang });
    if (generationRef.current !== generation) return;
    if (!result.ok) {
      // Un défi périmé (plus de deux minutes) se refait à la prochaine phrase.
      if (result.reason === "challenge_required") solvedRef.current = null;
      dispatch({ type: "transcribeFailed" });
      return;
    }
    dispatch({ type: "transcribed", text: result.text });
  }

  // ── Relire, puis envoyer ───────────────────────────────────────────────────
  const sendNow = useCallback(() => {
    const heard = live.current.heard;
    if (heard === null) return;
    const challenge = live.current.conversation.ticket === null ? solvedRef.current : null;
    if (live.current.send(heard, challenge)) solvedRef.current = null;
  }, []);

  useEffect(() => {
    if (state.phase !== "review") return;
    const id = setTimeout(sendNow, REVIEW_MS);
    return () => clearTimeout(id);
  }, [state.phase, sendNow]);

  const correct = useCallback(() => {
    const heard = live.current.heard;
    if (heard === null) return;
    live.current.onCorrect(heard);
    dispatch({ type: "correct" });
  }, []);

  // ── Suivre la conversation : un tour part, une réponse arrive ──────────────
  const previousStatus = useRef(conversation.status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = conversation.status;
    if (state.phase === "off" || previous === conversation.status) return;
    if (conversation.status === "sending") dispatch({ type: "sent" });
    else if (conversation.status === "ended") stop();
    else if (previous === "sending") {
      dispatch(conversation.failure !== null ? { type: "turnFailed" } : { type: "replied" });
    }
  }, [conversation.status, conversation.failure, state.phase, stop]);

  // ── Dire la réponse ────────────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "speaking") return;
    const generation = generationRef.current;
    const { conversation: current } = live.current;
    const last = current.messages[current.messages.length - 1];
    const finish = (failed: boolean) => {
      if (generationRef.current !== generation) return;
      dispatch({ type: "spoken", cardWaiting: live.current.cardWaiting, failed });
    };
    if (last === undefined || last.role !== "assistant" || last.signature === undefined || current.ticket === null) {
      finish(true);
      return;
    }
    void (async () => {
      const speech = await fetchAssistantSpeech({
        ticket: current.ticket!,
        content: last.content,
        signature: last.signature!,
        lang: live.current.lang,
      });
      if (generationRef.current !== generation) return;
      if (!speech.ok || speakerRef.current === null) {
        finish(true);
        return;
      }
      const outcome = await speakerRef.current.play(speech.audio);
      // « Coupé » : c'est `interrupt` qui a déjà fait avancer l'automate.
      if (outcome !== "stopped") finish(outcome === "failed");
    })();
  }, [state.phase]);

  const interrupt = useCallback(() => {
    speakerRef.current?.stop();
    dispatch({ type: "interrupt" });
  }, []);

  // ⚠️ Espace coupe la parole — mais jamais dans un champ de saisie ni sur un
  // bouton, où la touche a déjà son sens.
  useEffect(() => {
    if (state.phase !== "speaking") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== " " && event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      event.preventDefault();
      interrupt();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.phase, interrupt]);

  const resume = useCallback(() => {
    generationRef.current += 1;
    // Le geste de reprendre déverrouille de nouveau le son (Safari).
    void contextRef.current?.resume().catch(() => {});
    dispatch({ type: "resume" });
  }, []);

  return { state, level, supported, start, stop, resume, interrupt, sendNow, correct };
}
