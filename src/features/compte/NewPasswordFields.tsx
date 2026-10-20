/**
 * Un nouveau mot de passe et sa confirmation : règles en direct sous le premier
 * champ, un seul bouton afficher/masquer pour les deux. Partagé par le choix du
 * mot de passe (confirmation de l'adresse), sa réinitialisation et son
 * changement.
 */
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import { PasswordField, useReveal } from "./form.tsx";
import type { newPasswordErrors } from "./passwordRules.ts";

export function NewPasswordFields({
  idPrefix,
  password,
  confirmation,
  errors,
  label = "compte.password.new",
  onPassword,
  onConfirmation,
}: {
  idPrefix: string;
  password: string;
  confirmation: string;
  errors: ReturnType<typeof newPasswordErrors>;
  label?: StringKey;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
}) {
  const t = useT();
  const reveal = useReveal();
  return (
    <>
      <PasswordField
        id={idPrefix + "-password"}
        label={t(label)}
        value={password}
        error={errors.password ? t(errors.password) : null}
        autoComplete="new-password"
        onChange={onPassword}
        showRules
        reveal={reveal}
      />
      <PasswordField
        id={idPrefix + "-confirmation"}
        label={t("compte.password.confirmation")}
        value={confirmation}
        error={errors.confirmation ? t(errors.confirmation) : null}
        autoComplete="new-password"
        onChange={onConfirmation}
        reveal={reveal}
      />
    </>
  );
}
