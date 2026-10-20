/**
 * Changer son mot de passe depuis « Mon compte » : le mot de passe actuel, puis
 * le nouveau (règles en direct). Les champs sont vidés dès l'envoi ; le serveur
 * ferme les AUTRES sessions et prévient le titulaire par courriel.
 */
import { useState } from "react";
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import { changePassword } from "@/services/portal/accountClient.ts";
import { FormFeedbackView, PasswordField, PRIMARY_BUTTON, StatusNote, useFormFeedback, useReveal } from "./form.tsx";
import { NewPasswordFields } from "./NewPasswordFields.tsx";
import { newPasswordErrors } from "./passwordRules.ts";

type FieldName = "current" | "password" | "confirmation";

export function ChangePasswordForm() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);
  const reveal = useReveal();
  const feedback = useFormFeedback<FieldName>();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setChanged(false);
    const errors: Partial<Record<FieldName, StringKey>> = newPasswordErrors(password, confirmation);
    if (current === "") errors.current = "compte.required.currentPassword";
    feedback.reject(errors);
    if (Object.keys(errors).length > 0) return;

    const sent = { current, password };
    setCurrent("");
    setPassword("");
    setConfirmation("");
    setPending(true);
    const result = await changePassword(sent);
    setPending(false);
    if (!result.ok) return feedback.fail(result.reason);
    setChanged(true);
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FormFeedbackView feedback={feedback} messages={{ credentials_invalid: "compte.error.currentPassword" }} />
      {changed && <StatusNote>{t("compte.change.done")}</StatusNote>}
      <PasswordField
        id="changement-current"
        label={t("compte.password.current")}
        value={current}
        error={feedback.errors.current ? t(feedback.errors.current) : null}
        autoComplete="current-password"
        onChange={(value) => {
          setCurrent(value);
          feedback.touch("current");
        }}
        reveal={reveal}
      />
      <NewPasswordFields
        idPrefix="changement"
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
      <div>
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t(pending ? "compte.submitting" : "compte.change.submit")}
        </button>
      </div>
    </form>
  );
}
