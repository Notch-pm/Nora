/**
 * Ce que l'usager lit quand une opération du compte échoue — une table, pas des
 * phrases en dur.
 *
 * ⚠️ `credentials_invalid` reste GÉNÉRIQUE (« adresse ou mot de passe
 * incorrect ») : l'écran ne dit jamais qu'une adresse est inconnue, le serveur
 * non plus. Et les écrans « courriel envoyé » (inscription, lien perdu, mot de
 * passe oublié) affichent la même phrase que l'adresse ait un compte ou non.
 */
import type { StringKey } from "@/i18n/strings.ts";
import type { AccountClientFailure } from "@/services/portal/accountClient.ts";

const KEYS: Record<AccountClientFailure, StringKey> = {
  bad_request: "compte.error.badRequest",
  email_invalid: "compte.error.emailInvalid",
  password_weak: "compte.error.passwordWeak",
  cgu_required: "compte.error.cguRequired",
  credentials_invalid: "compte.error.credentials",
  account_locked: "compte.error.locked",
  account_unconfirmed: "compte.error.unconfirmed",
  link_invalid: "compte.error.linkInvalid",
  mfa_expired: "compte.error.mfaExpired",
  totp_invalid: "compte.error.totpInvalid",
  totp_not_pending: "compte.error.totpNotPending",
  mail_unavailable: "compte.error.mailUnavailable",
  account_unavailable: "compte.error.unavailable",
  challenge_required: "compte.error.challenge",
  too_many_emails: "compte.error.tooManyEmails",
  session_required: "compte.error.sessionRequired",
  // Un refus de forme qui n'est pas la faute de l'usager : indisponibilité.
  csrf_rejected: "compte.error.unavailable",
  session_unavailable: "compte.error.unavailable",
  network: "compte.error.network",
};

export function accountFailureKey(failure: AccountClientFailure): StringKey {
  return KEYS[failure];
}
