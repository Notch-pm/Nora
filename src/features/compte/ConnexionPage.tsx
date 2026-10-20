/**
 * La connexion au compte citoyen — `/compte/connexion`.
 *
 * Deux étapes : adresse + mot de passe, puis — si le compte a la double
 * authentification — le code de l'application. Le serveur dit laquelle (réponse
 * `mfaRequired`) ; l'écran ne devine rien.
 *
 * ⚠️ Mot de passe, ticket et code restent en MÉMOIRE DU COMPOSANT : jamais dans
 * `localStorage`/`sessionStorage`. Le mot de passe et le code sont vidés dès
 * l'envoi ; le ticket (valable 5 minutes côté serveur) est une `ref`, détruite
 * avec l'étape.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { normalizeEmail } from "@fn/_shared/account/accountService.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import type { StringKey } from "@/i18n/strings.ts";
import { login, loginTotp, resendConfirmation } from "@/services/portal/accountClient.ts";
import { AccountFrame, LINK_CLASS, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import {
  CheckboxField,
  CodeField,
  EmailField,
  FormFeedbackView,
  PasswordField,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  StatusNote,
  useFormFeedback,
  useReveal,
} from "./form.tsx";
import { forgetSessionKind, useSessionKind } from "./sessionKind.ts";

type Step = "credentials" | "totp";

export function ConnexionPage() {
  return <AccountFrame>{() => <ConnexionScreen />}</AccountFrame>;
}

function ConnexionScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("credentials");
  // Vrai dès qu'on est revenu à la saisie depuis l'étape du code : le titre reprend le focus.
  const [cameBack, setCameBack] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  const ticket = useRef<string | null>(null);
  const reveal = useReveal();
  const feedback = useFormFeedback<"email" | "password" | "code">();

  useScreenTitle(t(step === "credentials" ? "compte.login.title" : "compte.login.totpTitle"));

  // Déjà connecté : la connexion n'a rien à offrir.
  const kind = useSessionKind();
  useEffect(() => {
    if (kind === "account") navigate(localizedPath(lang, "/compte"), { replace: true });
  }, [kind, lang, navigate]);

  const opened = () => {
    forgetSessionKind();
    navigate(localizedPath(lang, "/compte"));
  };

  const backToCredentials = () => {
    ticket.current = null;
    setCode("");
    setStep("credentials");
    setCameBack(true);
  };

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setResent(false);
    const errors: Partial<Record<"email" | "password", StringKey>> = {};
    if (email.trim() === "") errors.email = "compte.required.email";
    else if (normalizeEmail(email) === null) errors.email = "compte.error.emailInvalid";
    if (password === "") errors.password = "compte.required.password";
    feedback.reject(errors);
    if (Object.keys(errors).length > 0) return;

    const sent = password;
    setPassword("");
    setPending(true);
    const result = await login({ email: email.trim(), password: sent, remember });
    setPending(false);
    if (!result.ok) return feedback.fail(result.reason);
    if (result.value.kind === "mfa") {
      ticket.current = result.value.ticket;
      feedback.reject({});
      setStep("totp");
      return;
    }
    opened();
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || ticket.current === null) return;
    if (!/^\d{6}$/.test(code)) {
      feedback.reject({ code: "compte.required.code" });
      return;
    }
    const sent = code;
    setCode("");
    setPending(true);
    const result = await loginTotp({ ticket: ticket.current, code: sent });
    setPending(false);
    if (result.ok) return opened();
    if (result.reason === "mfa_expired" || result.reason === "session_required") {
      backToCredentials();
    }
    feedback.fail(result.reason);
  };

  const resend = async () => {
    setPending(true);
    const result = await resendConfirmation(email.trim());
    setPending(false);
    if (!result.ok) return feedback.fail(result.reason);
    feedback.fail(null);
    setResent(true);
  };

  if (step === "totp") {
    return (
      <>
        <StepTitle focusOnMount>{t("compte.login.totpTitle")}</StepTitle>
        <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.login.totpIntro")}</p>
        <form onSubmit={submitCode} noValidate className="mt-6 flex flex-col gap-5">
          <FormFeedbackView feedback={feedback} />
          <CodeField
            id="connexion-code"
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
              {t(pending ? "compte.submitting" : "compte.login.totpSubmit")}
            </button>
            <button type="button" onClick={() => { feedback.reject({}); backToCredentials(); }} className={SECONDARY_BUTTON}>
              {t("compte.back")}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <StepTitle focusOnMount={cameBack}>{t("compte.login.title")}</StepTitle>
      <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.login.intro")}</p>
      <form onSubmit={submitCredentials} noValidate className="mt-6 flex flex-col gap-5">
        <FormFeedbackView feedback={feedback}>
          {feedback.failure === "account_unconfirmed" && (
            <div>
              <button type="button" onClick={resend} disabled={pending} className={SECONDARY_BUTTON}>
                {t("compte.login.resend")}
              </button>
            </div>
          )}
        </FormFeedbackView>
        {resent && <StatusNote>{t("compte.resend.sent")}</StatusNote>}

        <EmailField
          id="connexion-email"
          label={t("compte.email")}
          value={email}
          error={feedback.errors.email ? t(feedback.errors.email) : null}
          onChange={(value) => {
            setEmail(value);
            feedback.touch("email");
          }}
        />
        <PasswordField
          id="connexion-password"
          label={t("compte.password")}
          value={password}
          error={feedback.errors.password ? t(feedback.errors.password) : null}
          autoComplete="current-password"
          onChange={(value) => {
            setPassword(value);
            feedback.touch("password");
          }}
          reveal={reveal}
        />
        <CheckboxField
          id="connexion-remember"
          checked={remember}
          onChange={setRemember}
          help={t("compte.login.rememberHelp")}
        >
          {t("compte.login.remember")}
        </CheckboxField>

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t(pending ? "compte.submitting" : "compte.login.submit")}
          </button>
          <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
        </div>
      </form>

      <ul className="mt-8 flex flex-col gap-2 text-[length:var(--pt-body)]">
        <li>
          <Link to={localizedPath(lang, "/compte/mot-de-passe-oublie")} className={LINK_CLASS}>
            {t("compte.login.forgot")}
          </Link>
        </li>
        <li>
          {t("compte.login.noAccount")}{" "}
          <Link to={localizedPath(lang, "/compte/inscription")} className={LINK_CLASS}>
            {t("compte.login.register")}
          </Link>
        </li>
      </ul>
    </>
  );
}
