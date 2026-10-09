/**
 * Le MODE DIALOGUE à l'écran. N'AFFICHE QUE : la règle est dans `dialogue.ts`,
 * l'orchestration dans `useVoiceDialogue.ts`.
 *
 * Deux composants, deux modes qu'on ne doit pas pouvoir confondre (retour PO du
 * 2026-10-09) :
 *  - `VoiceStartButton`, sous la zone de saisie du mode texte : l'entrée.
 *  - `DialoguePanel`, qui REMPLACE la zone de saisie tant que le dialogue dure :
 *    bandeau « Mode dialogue », grand micro, état en gros caractères — et, en
 *    haut, toujours visible, « Revenir au mode texte ».
 *
 * Accessibilité :
 *  - le fil écrit reste le SOUS-TITRAGE de tout ce qui est dit, des deux côtés ;
 *  - l'état est annoncé dans une région `status`, un message à la fois ;
 *  - le panneau reçoit le focus à son ouverture, la zone de saisie au retour ;
 *  - tout se fait au clavier, et Espace coupe la parole ;
 *  - le grand micro est un signe pour l'œil (`aria-hidden`), immobile sous
 *    `prefers-reduced-motion`.
 */
import { useEffect, useRef } from "react";
import type { VoiceMode } from "@fn/_shared/domain/voice.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";
import { BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "../cardStyles.ts";
import type { DialogueState } from "./dialogue.ts";
import type { UseVoiceDialogue } from "./useVoiceDialogue.ts";

function MicrophoneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function KeyboardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" strokeLinecap="round" />
    </svg>
  );
}

type StatusKey =
  | "assistant.voice.status.opening"
  | "assistant.voice.status.listening"
  | "assistant.voice.status.transcribing"
  | "assistant.voice.status.review"
  | "assistant.voice.status.thinking"
  | "assistant.voice.status.speaking";

function statusKey(state: DialogueState): StatusKey | null {
  switch (state.phase) {
    case "opening":
      return "assistant.voice.status.opening";
    case "listening":
      return "assistant.voice.status.listening";
    case "transcribing":
      return "assistant.voice.status.transcribing";
    case "review":
      return "assistant.voice.status.review";
    case "thinking":
      return "assistant.voice.status.thinking";
    case "speaking":
      return "assistant.voice.status.speaking";
    default:
      return null;
  }
}

/** L'entrée dans le mode dialogue, sous la zone de saisie. Rien si la voix n'est pas proposée ici. */
export function VoiceStartButton({ mode, voice }: { mode: VoiceMode; voice: UseVoiceDialogue }) {
  const t = useT();
  if (mode === "off" || !voice.supported || voice.state.phase !== "off") return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={voice.start} className={SECONDARY_BUTTON_CLASS + " inline-flex items-center gap-2"}>
        <MicrophoneIcon />
        {t(mode === "dialogue" ? "assistant.voice.startDialogue" : "assistant.voice.startDictation")}
      </button>
      <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {mode === "dictation" ? t("assistant.voice.dictationHint") + " " : ""}
        {t("assistant.voice.notice")}
      </p>
    </div>
  );
}

/** Le grand micro : il « respire » avec la voix de l'usager, pulse quand l'assistant parle. */
function BigMicrophone({ state, level }: { state: DialogueState; level: number }) {
  const listening = state.phase === "listening";
  const speaking = state.phase === "speaking";
  const busy = state.phase === "transcribing" || state.phase === "thinking" || state.phase === "opening";
  return (
    <div aria-hidden="true" className="relative flex h-20 w-20 shrink-0 items-center justify-center">
      {listening && (
        <span
          className="absolute inset-0 rounded-full bg-[color:var(--brand-primary)] opacity-25 motion-safe:transition-transform motion-safe:duration-100"
          style={{ transform: `scale(${1 + Math.min(level, 1) * 0.45})` }}
        />
      )}
      {speaking && (
        <span className="absolute inset-0 rounded-full bg-[color:var(--brand-primary)] opacity-20 motion-safe:animate-ping" />
      )}
      <span
        className={
          "relative flex h-16 w-16 items-center justify-center rounded-full shadow-sm " +
          (listening || speaking
            ? "bg-[color:var(--brand-primary)] text-white"
            : "border-2 border-[color:var(--brand-primary)] bg-white text-[color:var(--brand-primary)]") +
          (busy ? " motion-safe:animate-pulse" : "")
        }
      >
        <MicrophoneIcon className="h-8 w-8" />
      </span>
    </div>
  );
}

/**
 * Le panneau du dialogue — À LA PLACE de la zone de saisie. `onNewConversation`
 * reste atteignable : on ne doit pas avoir à quitter la voix pour recommencer.
 */
export function DialoguePanel({
  voice,
  onNewConversation,
}: {
  voice: UseVoiceDialogue;
  onNewConversation: (() => void) | null;
}) {
  const t = useT();
  const { state } = voice;
  const panelRef = useRef<HTMLElement>(null);
  const titleId = "assistant-dialogue-title";

  // Le focus entre dans le panneau à son ouverture : la zone de saisie qu'il
  // remplace vient de disparaître, et le focus ne doit pas se perdre (RGAA 12.8).
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  if (state.phase === "off") return null;
  const status = statusKey(state);
  const pauseText = state.pause !== null ? t(`assistant.voice.pause.${state.pause}` as const) : "";

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-[var(--pt-radius)] border-2 border-[color:var(--brand-primary)] p-[var(--pt-pad)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]/40"
      style={{ background: "var(--pt-primary-soft)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={titleId} className="inline-flex items-center gap-2 text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-[color:var(--brand-primary)] motion-safe:animate-pulse" />
          {t("assistant.voice.region")}
        </p>
        <button
          type="button"
          onClick={voice.stop}
          className={SECONDARY_BUTTON_CLASS + " inline-flex items-center gap-2 bg-white"}
        >
          <KeyboardIcon />
          {t("assistant.voice.stop")}
        </button>
      </div>

      <div className="flex items-center gap-4">
        <BigMicrophone state={state} level={voice.level} />
        <p
          role="status"
          aria-live="polite"
          className="text-[length:var(--pt-h2)] font-semibold leading-snug text-[color:var(--pt-ink)]"
        >
          {status !== null ? t(status) : pauseText}
        </p>
      </div>

      {state.phase === "review" && state.heard !== null && (
        <div className="flex flex-col gap-2">
          <blockquote className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-4 py-3 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            {state.heard}
          </blockquote>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={voice.sendNow} className={BUTTON_CLASS}>
              {t("assistant.voice.sendNow")}
            </button>
            <button type="button" onClick={voice.correct} className={SECONDARY_BUTTON_CLASS + " bg-white"}>
              {t("assistant.voice.correct")}
            </button>
            <span className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("assistant.voice.autoSend")}</span>
          </div>
        </div>
      )}

      {state.phase === "speaking" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={voice.interrupt} className={BUTTON_CLASS}>
            {t("assistant.voice.interrupt")}
          </button>
          <span className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("assistant.voice.interruptHint")}</span>
        </div>
      )}

      {state.phase === "paused" && (
        <button type="button" onClick={voice.resume} className={BUTTON_CLASS + " inline-flex w-fit items-center gap-2"}>
          <MicrophoneIcon />
          {t(state.pause === "dictation" ? "assistant.voice.speak" : "assistant.voice.resume")}
        </button>
      )}

      {state.speechFailed && (
        <p className="text-[length:var(--pt-small)] text-amber-800">{t("assistant.voice.speechFailed")}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--pt-border)] pt-3">
        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("assistant.voice.notice")}</p>
        {onNewConversation !== null && (
          <button
            type="button"
            onClick={onNewConversation}
            className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
          >
            {t("assistant.newConversation")}
          </button>
        )}
      </div>
    </section>
  );
}
