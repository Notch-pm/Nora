/**
 * Les commandes du MODE DIALOGUE, sous la zone de saisie. N'AFFICHE QUE : la
 * règle est dans `dialogue.ts`, l'orchestration dans `useVoiceDialogue.ts`.
 *
 * Accessibilité :
 *  - le fil écrit reste le SOUS-TITRAGE de tout ce qui est dit, des deux
 *    côtés — un usager sourd ou malentendant ne perd rien ;
 *  - l'état (« je vous écoute », « je réfléchis »…) est annoncé dans une
 *    région `status`, un message à la fois ;
 *  - tout se fait aussi au clavier, et Espace coupe la parole ;
 *  - l'indicateur de niveau est un signe pour l'œil (`aria-hidden`), immobile
 *    sous `prefers-reduced-motion`.
 */
import type { VoiceMode } from "@fn/_shared/domain/voice.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";
import { BUTTON_CLASS, CARD_CLASS, SECONDARY_BUTTON_CLASS } from "../cardStyles.ts";
import type { DialogueState } from "./dialogue.ts";
import type { UseVoiceDialogue } from "./useVoiceDialogue.ts";

function MicrophoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
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

export function VoiceControls({ mode, voice }: { mode: VoiceMode; voice: UseVoiceDialogue }) {
  const t = useT();
  const { state } = voice;
  if (mode === "off" || !voice.supported) return null;

  if (state.phase === "off") {
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

  const status = statusKey(state);
  const pauseText = state.pause !== null ? t(`assistant.voice.pause.${state.pause}` as const) : "";

  return (
    <section aria-label={t("assistant.voice.region")} className={CARD_CLASS + " flex flex-col gap-3"}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
            (state.phase === "listening"
              ? "bg-[color:var(--brand-primary)] text-white"
              : "bg-[color:var(--pt-primary-soft)] text-[color:var(--pt-ink)]")
          }
        >
          <MicrophoneIcon />
        </span>
        <p role="status" aria-live="polite" className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
          {status !== null ? t(status) : pauseText}
        </p>
      </div>

      {state.phase === "listening" && (
        <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--pt-border)]">
          <div
            className="h-full rounded-full bg-[color:var(--brand-primary)] motion-safe:transition-[width] motion-safe:duration-100"
            style={{ width: `${Math.round(Math.max(0.04, voice.level) * 100)}%` }}
          />
        </div>
      )}

      {state.phase === "review" && state.heard !== null && (
        <div className="flex flex-col gap-2">
          <blockquote className="rounded-[var(--pt-radius-sm)] bg-[color:var(--pt-primary-soft)] px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            {state.heard}
          </blockquote>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={voice.sendNow} className={BUTTON_CLASS}>
              {t("assistant.voice.sendNow")}
            </button>
            <button type="button" onClick={voice.correct} className={SECONDARY_BUTTON_CLASS}>
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("assistant.voice.notice")}</p>
        <button
          type="button"
          onClick={voice.stop}
          className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
        >
          {t("assistant.voice.stop")}
        </button>
      </div>
    </section>
  );
}
