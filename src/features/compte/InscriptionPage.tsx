/**
 * La création d'un compte citoyen — `/compte/inscription`.
 *
 * Adresse de courriel et conditions, RIEN d'autre : le mot de passe se choisit
 * sur la page du lien reçu (`/compte/confirmer`), pour qu'on ne puisse pas
 * pré-inscrire l'adresse d'un autre avec son propre mot de passe.
 *
 * ⚠️ LA RÉPONSE EST LA MÊME POUR TOUTE ADRESSE. L'écran de fin ne dit jamais
 * « adresse acceptée » ni « adresse déjà utilisée » : seul le titulaire de
 * l'adresse l'apprend, par courriel.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { normalizeEmail } from "@fn/_shared/account/accountService.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import type { StringKey } from "@/i18n/strings.ts";
import { registerAccount } from "@/services/portal/accountClient.ts";
import { AccountFrame, LINK_CLASS, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import { CheckboxField, EmailField, FormFeedbackView, PRIMARY_BUTTON, StatusNote, useFormFeedback } from "./form.tsx";

export function InscriptionPage() {
  return <AccountFrame>{() => <InscriptionScreen />}</AccountFrame>;
}

function InscriptionScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const [email, setEmail] = useState("");
  const [cgu, setCgu] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const feedback = useFormFeedback<"email" | "cgu">();

  useScreenTitle(t(done ? "compte.register.doneTitle" : "compte.register.title"));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const errors: Partial<Record<"email" | "cgu", StringKey>> = {};
    if (email.trim() === "") errors.email = "compte.required.email";
    else if (normalizeEmail(email) === null) errors.email = "compte.error.emailInvalid";
    if (!cgu) errors.cgu = "compte.required.cgu";
    feedback.reject(errors);
    if (Object.keys(errors).length > 0) return;

    setPending(true);
    // Résout d'abord le défi anti-robot (quelques dixièmes de seconde), puis envoie.
    const result = await registerAccount({ email: email.trim(), cguAccepted: cgu });
    setPending(false);
    if (!result.ok) return feedback.fail(result.reason);
    setDone(true);
  };

  if (done) {
    return (
      <>
        <StepTitle focusOnMount>{t("compte.register.doneTitle")}</StepTitle>
        <div className="mt-6 flex flex-col gap-4">
          <StatusNote>{t("compte.register.sent")}</StatusNote>
          <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.register.sentHelp")}</p>
          <p className="text-[length:var(--pt-body)]">
            <Link to={localizedPath(lang, "/compte/connexion")} className={LINK_CLASS}>
              {t("compte.register.toLogin")}
            </Link>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <StepTitle>{t("compte.register.title")}</StepTitle>
      <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.register.intro")}</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
        <FormFeedbackView feedback={feedback} />
        <EmailField
          id="inscription-email"
          label={t("compte.email")}
          value={email}
          error={feedback.errors.email ? t(feedback.errors.email) : null}
          onChange={(value) => {
            setEmail(value);
            feedback.touch("email");
          }}
        />
        <CheckboxField
          id="inscription-cgu"
          checked={cgu}
          error={feedback.errors.cgu ? t(feedback.errors.cgu) : null}
          onChange={(checked) => {
            setCgu(checked);
            feedback.touch("cgu");
          }}
        >
          {t("compte.register.cguPrefix")}{" "}
          <a
            href={localizedPath(lang, "/compte/cgu")}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            {t("compte.register.cguLink")}
            <span className="sr-only"> {t("compte.newTab")}</span>
          </a>
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
          <span className="sr-only">{t("form.required")}</span>
        </CheckboxField>

        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("compte.register.identityLater")}</p>

        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t(pending ? "compte.submitting" : "compte.register.submit")}
          </button>
          <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
        </div>
      </form>

      <p className="mt-8 text-[length:var(--pt-body)]">
        {t("compte.register.haveAccount")}{" "}
        <Link to={localizedPath(lang, "/compte/connexion")} className={LINK_CLASS}>
          {t("compte.register.toLogin")}
        </Link>
      </p>
    </>
  );
}
