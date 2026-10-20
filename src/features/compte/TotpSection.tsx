/**
 * La double authentification de « Mon compte » : activer, changer d'appareil,
 * retirer.
 *
 * Quatre parcours, tous commandés par le serveur :
 *  · activer — le mot de passe, puis le secret à scanner, puis un premier code ;
 *  · changer d'appareil (déjà active) — le mot de passe ET le code actuel, puis
 *    comme activer ;
 *  · retirer — le mot de passe ET un code.
 *
 * ⚠️ Le secret n'est affiché qu'à l'étape de réglage et ne vit que dans l'état
 * du composant : ni stockage du navigateur, ni journal. Il est donné DEUX fois —
 * en QR code et en texte groupé par quatre — parce que le QR code seul exclut
 * qui ne peut pas le scanner (RGAA 1.1) ; et une application peut aussi se régler
 * à la main avec ce texte.
 */
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import {
  type AccountClientFailure,
  confirmTotp,
  disableTotp,
  startTotp,
} from "@/services/portal/accountClient.ts";
import {
  CodeField,
  FormFeedbackView,
  PasswordField,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StatusNote,
  useFormFeedback,
  useReveal,
} from "./form.tsx";
import { QrCode } from "./QrCode.tsx";

/** « JBSWY3DPEHPK3PXP » → « JBSW Y3DP EHPK 3PXP ». */
export function groupSecret(secret: string): string {
  return (secret.replace(/\s/g, "").match(/.{1,4}/g) ?? []).join(" ");
}

type Mode = "idle" | "enable" | "replace" | "disable";
type Notice = "enabled" | "replaced" | "disabled" | null;

const H3 = "text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)] focus:outline-none";

/** Un intertitre qui reçoit le focus à son apparition : l'étape a changé. */
function FocusHeading({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h4 ref={ref} tabIndex={-1} className={H3}>
      {children}
    </h4>
  );
}

const ASK_MESSAGES: Partial<Record<AccountClientFailure, StringKey>> = {
  credentials_invalid: "compte.error.currentPassword",
};

/** Le mot de passe (et, quand il est exigé, un code) avant d'engager l'opération. */
function AskForm({
  idPrefix,
  title,
  withCode,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  title: string;
  withCode: boolean;
  submitLabel: StringKey;
  /** Rend l'échec à afficher, ou `null` quand c'est fait. */
  onSubmit: (password: string, code: string) => Promise<AccountClientFailure | null>;
  onCancel: () => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const reveal = useReveal();
  const feedback = useFormFeedback<"password" | "code">();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const errors: Partial<Record<"password" | "code", StringKey>> = {};
    if (password === "") errors.password = "compte.required.currentPassword";
    if (withCode && !/^\d{6}$/.test(code)) errors.code = "compte.required.code";
    feedback.reject(errors);
    if (Object.keys(errors).length > 0) return;
    const sent = { password, code };
    setPassword("");
    setCode("");
    setPending(true);
    const failure = await onSubmit(sent.password, sent.code);
    // Réussi : le parent change d'étape et démonte ce formulaire.
    if (failure === null) return;
    setPending(false);
    feedback.fail(failure);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FocusHeading>{title}</FocusHeading>
      <FormFeedbackView feedback={feedback} messages={ASK_MESSAGES} />
      <PasswordField
        id={idPrefix + "-password"}
        label={t("compte.password.current")}
        value={password}
        error={feedback.errors.password ? t(feedback.errors.password) : null}
        autoComplete="current-password"
        onChange={(value) => {
          setPassword(value);
          feedback.touch("password");
        }}
        reveal={reveal}
      />
      {withCode && (
        <CodeField
          id={idPrefix + "-code"}
          label={t("compte.totp.currentCode")}
          value={code}
          error={feedback.errors.code ? t(feedback.errors.code) : null}
          onChange={(value) => {
            setCode(value);
            feedback.touch("code");
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t(pending ? "compte.submitting" : submitLabel)}
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          {t("compte.cancel")}
        </button>
      </div>
    </form>
  );
}

/** Le réglage de l'application : QR code, secret en texte, premier code. */
function ScanStep({
  secret,
  uri,
  onDone,
  onCancel,
}: {
  secret: string;
  uri: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const feedback = useFormFeedback<"code">();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!/^\d{6}$/.test(code)) return feedback.reject({ code: "compte.required.code" });
    feedback.reject({});
    const sent = code;
    setCode("");
    setPending(true);
    const result = await confirmTotp(sent);
    setPending(false);
    if (result.ok) return onDone();
    feedback.fail(result.reason);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FocusHeading>{t("compte.totp.scanTitle")}</FocusHeading>
      <ol className="flex list-decimal flex-col gap-4 pl-5 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
        <li>
          {t("compte.totp.scanStep1")}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
            <QrCode value={uri} label={t("compte.totp.qrLabel")} className="h-44 w-44 shrink-0 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)]" />
            <div>
              <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("compte.totp.secretIntro")}</p>
              <p className="mt-1 break-words rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-3 py-2 font-mono text-[length:var(--pt-body)] font-semibold tracking-wider">
                <span className="sr-only">{t("compte.totp.secretLabel")} </span>
                <span translate="no">{groupSecret(secret)}</span>
              </p>
            </div>
          </div>
        </li>
        <li>{t("compte.totp.scanStep2")}</li>
      </ol>
      <FormFeedbackView feedback={feedback} />
      <CodeField
        id="totp-confirm-code"
        label={t("compte.totp.code")}
        value={code}
        error={feedback.errors.code ? t(feedback.errors.code) : null}
        onChange={(value) => {
          setCode(value);
          feedback.touch("code");
        }}
      />
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t(pending ? "compte.submitting" : "compte.totp.confirm")}
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          {t("compte.cancel")}
        </button>
      </div>
    </form>
  );
}

export function TotpSection({ enabled, onChanged }: { enabled: boolean; onChanged: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("idle");
  const [pairing, setPairing] = useState<{ secret: string; uri: string } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const reset = () => {
    setMode("idle");
    setPairing(null);
  };

  const begin = (next: Mode) => {
    setNotice(null);
    setMode(next);
  };

  const start = async (password: string, code: string): Promise<AccountClientFailure | null> => {
    const result = await startTotp(mode === "replace" ? { password, code } : { password });
    if (!result.ok) return result.reason;
    setPairing(result.value);
    return null;
  };

  const disable = async (password: string, code: string): Promise<AccountClientFailure | null> => {
    const result = await disableTotp({ password, code });
    if (!result.ok) return result.reason;
    reset();
    setNotice("disabled");
    onChanged();
    return null;
  };

  if (pairing !== null) {
    return (
      <ScanStep
        secret={pairing.secret}
        uri={pairing.uri}
        onCancel={reset}
        onDone={() => {
          setNotice(mode === "replace" ? "replaced" : "enabled");
          reset();
          onChanged();
        }}
      />
    );
  }

  if (mode === "enable" || mode === "replace") {
    return (
      <AskForm
        key={mode}
        idPrefix={"totp-" + mode}
        title={t(mode === "enable" ? "compte.totp.enableTitle" : "compte.totp.replaceTitle")}
        withCode={mode === "replace"}
        submitLabel="compte.totp.continue"
        onSubmit={start}
        onCancel={reset}
      />
    );
  }

  if (mode === "disable") {
    return (
      <AskForm
        idPrefix="totp-disable"
        title={t("compte.totp.disableTitle")}
        withCode
        submitLabel="compte.totp.disableSubmit"
        onSubmit={disable}
        onCancel={reset}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {notice !== null && (
        <StatusNote>
          {t(notice === "enabled" ? "compte.totp.enabledDone" : notice === "replaced" ? "compte.totp.replacedDone" : "compte.totp.disabledDone")}
        </StatusNote>
      )}
      <p className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
        {t(enabled ? "compte.totp.statusOn" : "compte.totp.statusOff")}
      </p>
      {!enabled && <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("compte.totp.help")}</p>}
      <div className="flex flex-wrap gap-3">
        {enabled ? (
          <>
            <button type="button" onClick={() => begin("replace")} className={SECONDARY_BUTTON}>
              {t("compte.totp.replace")}
            </button>
            <button type="button" onClick={() => begin("disable")} className={SECONDARY_BUTTON}>
              {t("compte.totp.disable")}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => begin("enable")} className={PRIMARY_BUTTON}>
            {t("compte.totp.enable")}
          </button>
        )}
      </div>
    </div>
  );
}
