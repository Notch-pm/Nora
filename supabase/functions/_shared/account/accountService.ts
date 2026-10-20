/**
 * Les parcours du compte citoyen (espace usager, lot L3a) — inscription,
 * confirmation de l'adresse, connexion (avec second facteur facultatif), mot de
 * passe oublié, changement de mot de passe, double authentification.
 *
 * Tout ce qui parle réseau est INJECTÉ (`AccountDeps`) : GoTrue, la base Nora,
 * l'envoi de courriels. Les règles se testent donc sans rien de tout cela
 * (`accountService.test.ts`). La session elle-même est ouverte par portal-api
 * (`session/`) : ce service dit seulement QUI s'est authentifié, et comment.
 *
 * Règles qui tiennent ici, et nulle part ailleurs :
 *   · rien ne révèle si une adresse a un compte — inscription, mot de passe
 *     oublié et échec de connexion répondent pareil ; seul le titulaire de
 *     l'adresse l'apprend, par courriel ;
 *   · 10 échecs en 15 minutes verrouillent l'adresse 15 minutes (CCTP 6.3),
 *     compte ou non ; les mauvais codes TOTP comptent aussi ;
 *   · un mot de passe changé ou réinitialisé ferme les AUTRES sessions, et le
 *     titulaire en est averti par courriel ;
 *   · activer ou retirer la double authentification exige le mot de passe.
 */
import type { RequestTrace } from "../session/sessionStore.ts";
import type { AccountStore } from "./accountStore.ts";
import type { IdentityProvider } from "./identity.ts";
import {
  type AccountMessage,
  alreadyRegisteredMessage,
  confirmationMessage,
  type MessageContext,
  recoveryMessage,
  securityNoticeMessage,
} from "./mail/messages.ts";
import { type PasswordRule, unmetPasswordRules } from "./password.ts";
import { seal, signToken, unseal, verifyToken } from "./secrets.ts";
import { matchTotp, newTotpSecret, otpauthUri } from "./totp.ts";

/** Version des CGU acceptées à l'inscription (`docs/cgu` du portail). */
export const CGU_VERSION = "2026-10";

/** Durée du ticket de second facteur, entre le mot de passe et le code. */
const MFA_TICKET_SECONDS = 5 * 60;
const TOTP_SEAL_LABEL = "totp-secret";
const MFA_TICKET_LABEL = "mfa-ticket";

export type AccountFailure =
  | "bad_request"
  | "email_invalid"
  | "password_weak"
  | "cgu_required"
  | "credentials_invalid"
  | "account_locked"
  | "account_unconfirmed"
  | "link_invalid"
  | "mfa_expired"
  | "totp_invalid"
  | "totp_not_pending"
  | "mail_unavailable"
  | "account_unavailable";

export type AccountResult<T> = { ok: true; value: T } | { ok: false; reason: AccountFailure; rules?: PasswordRule[] };

/** Qui s'est authentifié, et comment — de quoi ouvrir une session. */
export interface Authenticated {
  accountId: string;
  amr: string[];
  remember: boolean;
}

export type LoginOutcome = { kind: "session"; session: Authenticated } | { kind: "mfa"; ticket: string };

export interface AccountMailer {
  /** La collectivité a-t-elle un serveur d'envoi ? (Sinon, rien ne doit commencer.) */
  ready(): Promise<boolean>;
  send(to: string, message: AccountMessage): Promise<boolean>;
}

export interface AccountDeps {
  identity: IdentityProvider;
  store: AccountStore;
  mailer: AccountMailer;
  /** `NORA_AUTH_SECRET` (32 caractères au moins). */
  authSecret: string;
  tenant: { id: string; name: string };
  /** `https://<collectivité>` — racine des liens envoyés. */
  portalUrl: string;
  trace: RequestTrace;
  nowSeconds: () => number;
  /** SHA-256 hexadécimal (`http/rateLimit.ts` → `hashKey`). */
  sha256: (input: string) => Promise<string>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

function fail<T>(reason: AccountFailure, rules?: PasswordRule[]): AccountResult<T> {
  return rules ? { ok: false, reason, rules } : { ok: false, reason };
}

function ok<T>(value: T): AccountResult<T> {
  return { ok: true, value };
}

export function createAccountService(deps: AccountDeps) {
  const { identity, store, mailer, trace } = deps;
  const messageContext: MessageContext = { tenantName: deps.tenant.name, portalUrl: deps.portalUrl };
  const emailHash = (email: string) => deps.sha256(`email:${email}`);

  /** Le mot de passe d'un compte déjà connu (re-authentification). */
  async function passwordMatches(accountId: string, password: string): Promise<AccountResult<string>> {
    const email = await identity.emailOf(accountId);
    if (email === null) return fail("account_unavailable");
    const check = await identity.checkPassword(email, password);
    if (check.kind === "unavailable") return fail("account_unavailable");
    if (check.kind !== "ok" || check.userId !== accountId) {
      await store.loginFailed(await emailHash(email), deps.tenant.id, trace);
      return fail("credentials_invalid");
    }
    return ok(email);
  }

  async function notify(accountId: string, change: "password" | "totp_enabled" | "totp_disabled", email?: string) {
    const to = email ?? (await identity.emailOf(accountId));
    if (to !== null) await mailer.send(to, securityNoticeMessage(messageContext, change));
  }

  async function sendConfirmation(email: string): Promise<boolean> {
    const token = await identity.linkToken("magiclink", email);
    if (token === null || token === "unavailable") return false;
    return mailer.send(email, confirmationMessage(messageContext, token));
  }

  return {
    /**
     * Inscription. Réponse IDENTIQUE que l'adresse soit libre ou non : le
     * titulaire reçoit soit le lien de confirmation, soit « vous avez déjà un
     * compte » (soit, pour un compte jamais confirmé, un nouveau lien).
     */
    async register(input: { email: unknown; password: unknown; cguAccepted: unknown }): Promise<AccountResult<null>> {
      const email = normalizeEmail(input.email);
      if (email === null) return fail("email_invalid");
      if (typeof input.password !== "string") return fail("bad_request");
      const rules = unmetPasswordRules(input.password);
      if (rules.length > 0) return fail("password_weak", rules);
      if (input.cguAccepted !== true) return fail("cgu_required");
      if (!(await mailer.ready())) return fail("mail_unavailable");

      const hash = await emailHash(email);
      const known = await store.byEmail(hash);
      if (!known.ok) return fail("account_unavailable");
      if (known.value !== null) {
        const sent = known.value.confirmed
          ? await mailer.send(email, alreadyRegisteredMessage(messageContext))
          : await sendConfirmation(email);
        return sent ? ok(null) : fail("mail_unavailable");
      }

      const created = await identity.createUser(email, input.password);
      if (created.kind === "unavailable") return fail("account_unavailable");
      if (created.kind === "exists") {
        // GoTrue connaît l'adresse, la base Nora non : une inscription
        // interrompue entre les deux. Le titulaire la reprend par « mot de
        // passe oublié » ; on ne crée rien de plus ici.
        console.error("portal-api : identité GoTrue sans compte citoyen (inscription interrompue)");
        return (await mailer.send(email, alreadyRegisteredMessage(messageContext))) ? ok(null) : fail("mail_unavailable");
      }
      const registered = await store.register(created.userId, hash, deps.tenant.id, CGU_VERSION, trace);
      if (!registered.ok) return fail("account_unavailable");
      return (await sendConfirmation(email)) ? ok(null) : fail("mail_unavailable");
    },

    /** Le lien de confirmation : l'adresse est confirmée, l'usager se connecte ensuite. */
    async confirm(token: unknown): Promise<AccountResult<null>> {
      if (typeof token !== "string" || token.length < 8 || token.length > 200) return fail("link_invalid");
      const verified = await identity.verifyLink("magiclink", token);
      if (verified.kind === "unavailable") return fail("account_unavailable");
      if (verified.kind === "invalid") return fail("link_invalid");
      const confirmed = await store.confirm(verified.userId, deps.tenant.id, trace);
      if (!confirmed.ok) return fail("account_unavailable");
      return confirmed.value ? ok(null) : fail("link_invalid");
    },

    async login(input: { email: unknown; password: unknown; remember: unknown }): Promise<AccountResult<LoginOutcome>> {
      const email = normalizeEmail(input.email);
      if (email === null || typeof input.password !== "string" || input.password === "") {
        return fail("credentials_invalid");
      }
      const remember = input.remember === true;
      const hash = await emailHash(email);
      const locked = await store.loginLocked(hash);
      if (!locked.ok) return fail("account_unavailable");
      if (locked.value) return fail("account_locked");

      const check = await identity.checkPassword(email, input.password);
      if (check.kind === "unavailable") return fail("account_unavailable");
      if (check.kind === "invalid") {
        const nowLocked = await store.loginFailed(hash, deps.tenant.id, trace);
        return fail(nowLocked.ok && nowLocked.value ? "account_locked" : "credentials_invalid");
      }
      // Mot de passe juste, adresse jamais confirmée : on peut le dire, celui
      // qui lit ceci connaît le mot de passe.
      if (check.kind === "unconfirmed") return fail("account_unconfirmed");

      const state = await store.forLogin(check.userId, deps.tenant.id);
      if (!state.ok) return fail("account_unavailable");
      if (state.value === null || !state.value.active) return fail("credentials_invalid");
      if (!state.value.confirmed) return fail("account_unconfirmed");
      await store.loginSucceeded(hash);

      if (state.value.totpEnabled) {
        const ticket = await signToken(deps.authSecret, MFA_TICKET_LABEL, {
          sub: check.userId,
          t: deps.tenant.id,
          h: hash,
          r: remember,
          exp: deps.nowSeconds() + MFA_TICKET_SECONDS,
        });
        return ok({ kind: "mfa", ticket });
      }
      return ok({ kind: "session", session: { accountId: check.userId, amr: ["pwd"], remember } });
    },

    /** Le second facteur, après un mot de passe juste. */
    async loginTotp(input: { ticket: unknown; code: unknown }): Promise<AccountResult<Authenticated>> {
      if (typeof input.ticket !== "string" || typeof input.code !== "string") return fail("mfa_expired");
      const payload = await verifyToken(deps.authSecret, MFA_TICKET_LABEL, input.ticket, deps.nowSeconds());
      if (payload === null || payload.t !== deps.tenant.id || typeof payload.sub !== "string" || typeof payload.h !== "string") {
        return fail("mfa_expired");
      }
      const accountId = payload.sub;
      const locked = await store.loginLocked(payload.h);
      if (!locked.ok) return fail("account_unavailable");
      if (locked.value) return fail("account_locked");

      const state = await store.totp(accountId);
      if (!state.ok) return fail("account_unavailable");
      const secret = state.value.secretEnc && (await unseal(deps.authSecret, TOTP_SEAL_LABEL, state.value.secretEnc));
      if (!secret) return fail("account_unavailable");
      const step = await matchTotp(secret, input.code, deps.nowSeconds());
      const used = step === null ? null : await store.totpUseStep(accountId, step);
      if (used === null || !used.ok || !used.value) {
        await store.event("totp_failed", deps.tenant.id, accountId, trace);
        const nowLocked = await store.loginFailed(payload.h, deps.tenant.id, trace);
        return fail(nowLocked.ok && nowLocked.value ? "account_locked" : "totp_invalid");
      }
      await store.loginSucceeded(payload.h);
      return ok({ accountId, amr: ["pwd", "totp"], remember: payload.r === true });
    },

    /** Renvoyer le lien de confirmation : même réponse pour toute adresse bien formée. */
    async resendConfirmation(input: { email: unknown }): Promise<AccountResult<null>> {
      const email = normalizeEmail(input.email);
      if (email === null) return fail("email_invalid");
      if (!(await mailer.ready())) return fail("mail_unavailable");
      const known = await store.byEmail(await emailHash(email));
      if (!known.ok) return fail("account_unavailable");
      if (known.value !== null && known.value.active && !known.value.confirmed) await sendConfirmation(email);
      return ok(null);
    },

    /** Mot de passe oublié : même réponse pour toute adresse bien formée. */
    async requestReset(input: { email: unknown }): Promise<AccountResult<null>> {
      const email = normalizeEmail(input.email);
      if (email === null) return fail("email_invalid");
      if (!(await mailer.ready())) return fail("mail_unavailable");
      const known = await store.byEmail(await emailHash(email));
      if (!known.ok) return fail("account_unavailable");
      const account = known.value;
      if (account === null || !account.active) return ok(null);
      await store.event("password_reset_requested", deps.tenant.id, account.accountId, trace);
      if (!account.confirmed) {
        await sendConfirmation(email);
        return ok(null);
      }
      const token = await identity.linkToken("recovery", email);
      if (token !== null && token !== "unavailable") await mailer.send(email, recoveryMessage(messageContext, token));
      return ok(null);
    },

    /** Le lien de réinitialisation : nouveau mot de passe, et toutes les sessions fermées. */
    async resetPassword(input: { token: unknown; password: unknown }): Promise<AccountResult<null>> {
      if (typeof input.password !== "string") return fail("bad_request");
      const rules = unmetPasswordRules(input.password);
      if (rules.length > 0) return fail("password_weak", rules);
      if (typeof input.token !== "string" || input.token.length < 8 || input.token.length > 200) return fail("link_invalid");
      const verified = await identity.verifyLink("recovery", input.token);
      if (verified.kind === "unavailable") return fail("account_unavailable");
      if (verified.kind === "invalid") return fail("link_invalid");
      if (!(await identity.setPassword(verified.userId, input.password))) return fail("account_unavailable");
      const changed = await store.passwordChanged(verified.userId, deps.tenant.id, trace, null);
      if (!changed.ok) return fail("account_unavailable");
      await notify(verified.userId, "password");
      return ok(null);
    },

    /** Changer de mot de passe, connecté : l'ancien est exigé ; la session courante reste ouverte. */
    async changePassword(
      accountId: string,
      currentIdHash: string,
      input: { current: unknown; password: unknown },
    ): Promise<AccountResult<null>> {
      if (typeof input.current !== "string" || typeof input.password !== "string") return fail("bad_request");
      const rules = unmetPasswordRules(input.password);
      if (rules.length > 0) return fail("password_weak", rules);
      const matched = await passwordMatches(accountId, input.current);
      if (!matched.ok) return matched;
      if (!(await identity.setPassword(accountId, input.password))) return fail("account_unavailable");
      const changed = await store.passwordChanged(accountId, deps.tenant.id, trace, currentIdHash);
      if (!changed.ok) return fail("account_unavailable");
      await notify(accountId, "password", matched.value);
      return ok(null);
    },

    /** Ce que la page « Mon compte » montre. */
    async profile(accountId: string): Promise<AccountResult<{ email: string; totpEnabled: boolean }>> {
      const [email, totp] = await Promise.all([identity.emailOf(accountId), store.totp(accountId)]);
      if (email === null || !totp.ok) return fail("account_unavailable");
      return ok({ email, totpEnabled: totp.value.enabled });
    },

    /** Étape 1 de l'activation : mot de passe exigé ; rend le secret à scanner. */
    async totpStart(accountId: string, input: { password: unknown }): Promise<AccountResult<{ secret: string; uri: string }>> {
      if (typeof input.password !== "string") return fail("bad_request");
      const matched = await passwordMatches(accountId, input.password);
      if (!matched.ok) return matched;
      const secret = newTotpSecret();
      const pending = await store.totpSetPending(accountId, await seal(deps.authSecret, TOTP_SEAL_LABEL, secret));
      if (!pending.ok) return fail("account_unavailable");
      return ok({ secret, uri: otpauthUri(secret, matched.value, deps.tenant.name) });
    },

    /** Étape 2 : un premier code juste prouve que l'application est réglée. */
    async totpConfirm(accountId: string, input: { code: unknown }): Promise<AccountResult<null>> {
      if (typeof input.code !== "string") return fail("totp_invalid");
      const state = await store.totp(accountId);
      if (!state.ok) return fail("account_unavailable");
      const pending = state.value.pendingEnc && (await unseal(deps.authSecret, TOTP_SEAL_LABEL, state.value.pendingEnc));
      if (!pending) return fail("totp_not_pending");
      const step = await matchTotp(pending, input.code, deps.nowSeconds());
      if (step === null) return fail("totp_invalid");
      const enabled = await store.totpEnable(accountId, step, deps.tenant.id, trace);
      if (!enabled.ok) return fail("account_unavailable");
      if (!enabled.value) return fail("totp_not_pending");
      await notify(accountId, "totp_enabled");
      return ok(null);
    },

    /** Retirer la double authentification : mot de passe ET code exigés. */
    async totpDisable(accountId: string, input: { password: unknown; code: unknown }): Promise<AccountResult<null>> {
      if (typeof input.password !== "string" || typeof input.code !== "string") return fail("bad_request");
      const matched = await passwordMatches(accountId, input.password);
      if (!matched.ok) return matched;
      const state = await store.totp(accountId);
      if (!state.ok) return fail("account_unavailable");
      const secret = state.value.secretEnc && (await unseal(deps.authSecret, TOTP_SEAL_LABEL, state.value.secretEnc));
      if (!secret) return fail("totp_not_pending");
      const step = await matchTotp(secret, input.code, deps.nowSeconds());
      const used = step === null ? null : await store.totpUseStep(accountId, step);
      if (used === null || !used.ok || !used.value) return fail("totp_invalid");
      const disabled = await store.totpDisable(accountId, deps.tenant.id, trace);
      if (!disabled.ok || !disabled.value) return fail("account_unavailable");
      await notify(accountId, "totp_disabled", matched.value);
      return ok(null);
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;

/** Statut HTTP d'un échec du compte. */
export function httpStatusForAccountFailure(failure: AccountFailure): number {
  switch (failure) {
    case "bad_request":
    case "email_invalid":
    case "password_weak":
    case "cgu_required":
    case "totp_invalid":
    case "totp_not_pending":
      return 400;
    case "credentials_invalid":
    case "account_unconfirmed":
    case "mfa_expired":
      return 401;
    case "link_invalid":
      return 410;
    case "account_locked":
      return 429;
    case "mail_unavailable":
    case "account_unavailable":
      return 503;
  }
}

/** Messages en français — l'écran traduit par code ; ceci n'est que le repli. */
export const ACCOUNT_MESSAGES: Record<AccountFailure, string> = {
  bad_request: "Ces informations n'ont pas pu être lues.",
  email_invalid: "Cette adresse de courriel n'est pas valide.",
  password_weak: "Ce mot de passe ne respecte pas les règles indiquées.",
  cgu_required: "Merci d'accepter les conditions générales d'utilisation.",
  credentials_invalid: "Adresse de courriel ou mot de passe incorrect.",
  account_locked: "Trop de tentatives : la connexion est suspendue pendant 15 minutes.",
  account_unconfirmed: "Votre adresse n'est pas encore confirmée : utilisez le lien reçu par courriel.",
  link_invalid: "Ce lien n'est plus valable. Vous pouvez en demander un nouveau.",
  mfa_expired: "La connexion a expiré. Merci de saisir à nouveau votre mot de passe.",
  totp_invalid: "Ce code n'est pas valable.",
  totp_not_pending: "Aucune activation n'est en cours. Merci de recommencer.",
  mail_unavailable: "Le service est momentanément indisponible. Merci de réessayer plus tard.",
  account_unavailable: "Le service est momentanément indisponible. Merci de réessayer dans quelques instants.",
};
