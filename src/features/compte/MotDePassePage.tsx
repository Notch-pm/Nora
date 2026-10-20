/**
 * Le choix d'un nouveau mot de passe, après « mot de passe oublié » —
 * `/compte/mot-de-passe#jeton=…`.
 *
 * Même gestion du jeton que `ConfirmerPage` : lu dans le fragment, effacé de
 * l'adresse avant tout appel, gardé dans une `ref`. Une fois le mot de passe
 * changé, le serveur a fermé TOUTES les sessions : l'usager se reconnecte.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import { resetPassword } from "@/services/portal/accountClient.ts";
import { AccountFrame, LINK_CLASS, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import { FormFeedbackView, PRIMARY_BUTTON, StatusNote, useFormFeedback } from "./form.tsx";
import { takeFragmentToken } from "./fragmentToken.ts";
import { NewPasswordFields } from "./NewPasswordFields.tsx";
import { newPasswordErrors } from "./passwordRules.ts";

type Phase = "reading" | "form" | "done" | "invalid";

export function MotDePassePage() {
  return <AccountFrame>{() => <MotDePasseScreen />}</AccountFrame>;
}

function MotDePasseScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const token = useRef<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("reading");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const feedback = useFormFeedback<"password" | "confirmation">();

  useScreenTitle(
    t(
      phase === "done"
        ? "compte.reset.doneTitle"
        : phase === "invalid"
          ? "compte.reset.invalidTitle"
          : "compte.reset.title",
    ),
  );

  useEffect(() => {
    if (token.current === undefined) token.current = takeFragmentToken();
    setPhase(token.current === null ? "invalid" : "form");
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || token.current == null) return;
    const errors = newPasswordErrors(password, confirmation);
    feedback.reject(errors);
    if (Object.keys(errors).length > 0) return;

    const sent = password;
    setPassword("");
    setConfirmation("");
    setPending(true);
    const result = await resetPassword(token.current, sent);
    setPending(false);
    if (result.ok) {
      token.current = null;
      setPhase("done");
    } else if (result.reason === "link_invalid") {
      token.current = null;
      setPhase("invalid");
    } else {
      feedback.fail(result.reason);
    }
  };

  if (phase === "reading") return <StepTitle>{t("compte.reset.title")}</StepTitle>;

  if (phase === "done") {
    return (
      <>
        <StepTitle focusOnMount>{t("compte.reset.doneTitle")}</StepTitle>
        <div className="mt-6 flex flex-col gap-5">
          <StatusNote>{t("compte.reset.done")}</StatusNote>
          <div>
            <Link to={localizedPath(lang, "/compte/connexion")} className={PRIMARY_BUTTON + " inline-block"}>
              {t("compte.confirm.toLogin")}
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (phase === "invalid") {
    return (
      <>
        <StepTitle focusOnMount>{t("compte.reset.invalidTitle")}</StepTitle>
        <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.reset.invalid")}</p>
        <p className="mt-6 text-[length:var(--pt-body)]">
          <Link to={localizedPath(lang, "/compte/mot-de-passe-oublie")} className={LINK_CLASS}>
            {t("compte.reset.again")}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <StepTitle>{t("compte.reset.title")}</StepTitle>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
        <FormFeedbackView feedback={feedback} />
        <NewPasswordFields
          idPrefix="reset"
          password={password}
          confirmation={confirmation}
          errors={feedback.errors}
          onPassword={(value) => {
            setPassword(value);
            feedback.touch("password");
          }}
          onConfirmation={(value) => {
            setConfirmation(value);
            feedback.touch("confirmation");
          }}
        />
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {t(pending ? "compte.submitting" : "compte.reset.submit")}
          </button>
          <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
        </div>
      </form>
    </>
  );
}
