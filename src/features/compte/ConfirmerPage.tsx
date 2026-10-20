/**
 * La confirmation de l'adresse et le choix du mot de passe —
 * `/compte/confirmer#jeton=…`.
 *
 * Le lien reçu par courriel porte un jeton dans son FRAGMENT. Il est lu puis
 * EFFACÉ de la barre d'adresse avant tout appel (`takeFragmentToken`), et ne vit
 * ensuite que dans une `ref`. Le mot de passe se choisit ici (et non à
 * l'inscription) : celui qui reçoit le lien est, par construction, le titulaire
 * de l'adresse.
 *
 * ⚠️ UN JETON NE SERT QU'UNE FOIS. Aucun appel n'est donc émis tant que
 * l'usager n'a pas validé un mot de passe accepté, et un échec qui n'est pas
 * `link_invalid` laisse le jeton en mémoire pour qu'il puisse réessayer.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { normalizeEmail } from "@fn/_shared/account/accountService.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import type { StringKey } from "@/i18n/strings.ts";
import { confirmAccount, resendConfirmation } from "@/services/portal/accountClient.ts";
import { AccountFrame, LINK_CLASS, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import { EmailField, FormFeedbackView, PRIMARY_BUTTON, StatusNote, useFormFeedback } from "./form.tsx";
import { takeFragmentToken } from "./fragmentToken.ts";
import { NewPasswordFields } from "./NewPasswordFields.tsx";
import { newPasswordErrors } from "./passwordRules.ts";

type Phase = "reading" | "form" | "done" | "invalid";

export function ConfirmerPage() {
  return <AccountFrame>{() => <ConfirmerScreen />}</AccountFrame>;
}

function ConfirmerScreen() {
  const t = useT();
  const { lang } = useLanguage();
  // `undefined` = pas encore lu. Une `ref`, pas un état : le jeton ne doit ni
  // s'afficher ni survivre à l'écran, et la lecture ne doit se faire QU'UNE
  // fois (le mode strict rejoue les effets, et le fragment est déjà effacé).
  const token = useRef<string | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("reading");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const feedback = useFormFeedback<"password" | "confirmation">();

  useScreenTitle(
    t(
      phase === "done"
        ? "compte.confirm.doneTitle"
        : phase === "invalid"
          ? "compte.confirm.invalidTitle"
          : "compte.confirm.title",
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
    const result = await confirmAccount(token.current, sent);
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

  if (phase === "reading") return <StepTitle>{t("compte.confirm.title")}</StepTitle>;

  if (phase === "done") {
    return (
      <>
        <StepTitle focusOnMount>{t("compte.confirm.doneTitle")}</StepTitle>
        <div className="mt-6 flex flex-col gap-5">
          <StatusNote>{t("compte.confirm.done")}</StatusNote>
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
        <StepTitle focusOnMount>{t("compte.confirm.invalidTitle")}</StepTitle>
        <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.confirm.invalid")}</p>
        <ResendForm />
      </>
    );
  }

  return (
    <>
      <StepTitle>{t("compte.confirm.title")}</StepTitle>
      <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.confirm.intro")}</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
        <FormFeedbackView feedback={feedback} />
        <NewPasswordFields
          idPrefix="confirmer"
          password={password}
          confirmation={confirmation}
          errors={feedback.errors}
          label="compte.password.choose"
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
            {t(pending ? "compte.submitting" : "compte.confirm.submit")}
          </button>
          <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
        </div>
      </form>
    </>
  );
}

/** « Recevoir un nouveau lien » : l'adresse, puis la même réponse pour toute adresse. */
function ResendForm() {
  const t = useT();
  const { lang } = useLanguage();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const feedback = useFormFeedback<"email">();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setSent(false);
    const errors: Partial<Record<"email", StringKey>> = {};
    if (email.trim() === "") errors.email = "compte.required.email";
    else if (normalizeEmail(email) === null) errors.email = "compte.error.emailInvalid";
    feedback.reject(errors);
    if (errors.email) return;
    setPending(true);
    const result = await resendConfirmation(email.trim());
    setPending(false);
    if (!result.ok) return feedback.fail(result.reason);
    setSent(true);
  };

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
      <h2 className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">{t("compte.resend.title")}</h2>
      <FormFeedbackView feedback={feedback} />
      {sent && <StatusNote>{t("compte.resend.sent")}</StatusNote>}
      <EmailField
        id="renvoi-email"
        label={t("compte.email")}
        value={email}
        error={feedback.errors.email ? t(feedback.errors.email) : null}
        onChange={(value) => {
          setEmail(value);
          feedback.touch("email");
        }}
      />
      <div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t(pending ? "compte.submitting" : "compte.resend.submit")}
        </button>
      </div>
      <p>
        <Link to={localizedPath(lang, "/compte/connexion")} className={LINK_CLASS}>
          {t("compte.confirm.toLogin")}
        </Link>
      </p>
    </form>
  );
}
