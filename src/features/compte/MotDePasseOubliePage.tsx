/**
 * « Mot de passe oublié » — `/compte/mot-de-passe-oublie`.
 *
 * ⚠️ MÊME RÉPONSE POUR TOUTE ADRESSE : l'écran ne dit jamais si un compte
 * existe. Le défi anti-robot (lié à l'adresse) est résolu par le client.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { normalizeEmail } from "@fn/_shared/account/accountService.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import type { StringKey } from "@/i18n/strings.ts";
import { requestPasswordReset } from "@/services/portal/accountClient.ts";
import { AccountFrame, LINK_CLASS, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import { EmailField, FormFeedbackView, PRIMARY_BUTTON, StatusNote, useFormFeedback } from "./form.tsx";

export function MotDePasseOubliePage() {
  return <AccountFrame>{() => <MotDePasseOublieScreen />}</AccountFrame>;
}

function MotDePasseOublieScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const feedback = useFormFeedback<"email">();

  useScreenTitle(t(done ? "compte.forgot.doneTitle" : "compte.forgot.title"));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const errors: Partial<Record<"email", StringKey>> = {};
    if (email.trim() === "") errors.email = "compte.required.email";
    else if (normalizeEmail(email) === null) errors.email = "compte.error.emailInvalid";
    feedback.reject(errors);
    if (errors.email) return;
    setPending(true);
    const result = await requestPasswordReset(email.trim());
    setPending(false);
    if (!result.ok) return feedback.fail(result.reason);
    setDone(true);
  };

  const toLogin = (
    <p className="mt-8 text-[length:var(--pt-body)]">
      <Link to={localizedPath(lang, "/compte/connexion")} className={LINK_CLASS}>
        {t("compte.forgot.toLogin")}
      </Link>
    </p>
  );

  if (done) {
    return (
      <>
        <StepTitle focusOnMount>{t("compte.forgot.doneTitle")}</StepTitle>
        <div className="mt-6">
          <StatusNote>{t("compte.forgot.sent")}</StatusNote>
        </div>
        {toLogin}
      </>
    );
  }

  return (
    <>
      <StepTitle>{t("compte.forgot.title")}</StepTitle>
      <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.forgot.intro")}</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
        <FormFeedbackView feedback={feedback} />
        <EmailField
          id="oubli-email"
          label={t("compte.email")}
          value={email}
          error={feedback.errors.email ? t(feedback.errors.email) : null}
          onChange={(value) => {
            setEmail(value);
            feedback.touch("email");
          }}
        />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t(pending ? "compte.submitting" : "compte.forgot.submit")}
          </button>
          <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
        </div>
      </form>
      {toLogin}
    </>
  );
}
