/**
 * Les règles de mot de passe telles que l'écran les montre : celles du
 * serveur (`unmetPasswordRules`, importé par `@fn`), jamais une copie.
 *
 * Quatre règles sont toujours listées (longueur, lettre, chiffre, caractère
 * spécial), cochées ou non. La cinquième — le plafond de 72 octets — n'est
 * listée que lorsqu'elle est dépassée : la montrer en permanence serait du bruit
 * pour la quasi-totalité des mots de passe.
 */
import { type PasswordRule, unmetPasswordRules } from "@fn/_shared/account/password.ts";
import type { StringKey } from "@/i18n/strings.ts";

export const PASSWORD_RULE_KEYS: Record<PasswordRule, StringKey> = {
  length: "compte.rule.length",
  letter: "compte.rule.letter",
  digit: "compte.rule.digit",
  special: "compte.rule.special",
  too_long: "compte.rule.tooLong",
};

const ALWAYS_LISTED: readonly PasswordRule[] = ["length", "letter", "digit", "special"];

export interface PasswordRuleState {
  rule: PasswordRule;
  met: boolean;
}

export function passwordRuleStates(password: string): PasswordRuleState[] {
  const unmet = new Set(unmetPasswordRules(password));
  const states: PasswordRuleState[] = ALWAYS_LISTED.map((rule) => ({ rule, met: !unmet.has(rule) }));
  if (unmet.has("too_long")) states.push({ rule: "too_long", met: false });
  return states;
}

/** Le mot de passe respecte-t-il toutes les règles ? */
export function passwordAccepted(password: string): boolean {
  return unmetPasswordRules(password).length === 0;
}

/**
 * Les erreurs d'un nouveau mot de passe et de sa confirmation, avant tout envoi.
 * Le serveur re-vérifie les mêmes règles : ceci n'épargne qu'un aller-retour.
 */
export function newPasswordErrors(
  password: string,
  confirmation: string,
): { password?: StringKey; confirmation?: StringKey } {
  const errors: { password?: StringKey; confirmation?: StringKey } = {};
  if (password === "") errors.password = "compte.required.password";
  else if (!passwordAccepted(password)) errors.password = "compte.password.weak";
  if (confirmation === "") errors.confirmation = "compte.required.confirmation";
  else if (confirmation !== password) errors.confirmation = "compte.password.mismatch";
  return errors;
}
