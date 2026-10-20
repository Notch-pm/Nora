/**
 * Client HTTP du COMPTE citoyen (`/compte/*`, espace usager L3a).
 *
 * Même motif que le suivi (`suiviClient.ts`), pour la même raison : le compte
 * repose sur un cookie de session HttpOnly de première partie, posé par
 * `portal-api` à la connexion. Il faut donc passer par le relais de MÊME
 * ORIGINE (`/api`), jamais par `VITE_PORTAL_API_URL`. Seule exception, le défi
 * anti-robot de l'inscription : il est sans état et sans cookie, comme celui
 * d'un dépôt (`fetchDepositChallenge`).
 *
 * Les écritures portent `x-nora-request: 1` (sinon `csrf_rejected`).
 *
 * ⚠️ Rien de ce qui transite ici n'est gardé : ni mot de passe, ni jeton de
 * lien, ni ticket de double authentification. Ce module ne mémorise rien ; les
 * écrans tiennent ces valeurs en mémoire de composant, le temps d'un envoi.
 */
import type { AccountFailure } from "@fn/_shared/account/accountService.ts";
import { normalizeEmail } from "@fn/_shared/account/accountService.ts";
import type { PasswordRule } from "@fn/_shared/account/password.ts";
import type { SolvedChallenge } from "@fn/_shared/domain/assistantTurn.ts";
import { solveChallenge } from "@fn/_shared/ai/challenge.ts";
import { fetchDepositChallenge } from "./portalClient.ts";
import { challengeToSolve } from "./depositChallenge.ts";

/** La base du compte : le relais de même origine, jamais l'adresse directe de l'API. */
export const ACCOUNT_API_BASE = "/api";

const REQUEST_HEADER = { "x-nora-request": "1" } as const;

/**
 * Les échecs du compte, plus ceux de la session, le défi manquant et celui que
 * le serveur ne peut pas signaler (`network`).
 */
export type AccountClientFailure =
  | AccountFailure
  | "challenge_required"
  | "too_many_emails"
  | "session_required"
  | "csrf_rejected"
  | "session_unavailable"
  | "network";

const KNOWN_FAILURES: readonly AccountClientFailure[] = [
  "bad_request",
  "email_invalid",
  "password_weak",
  "cgu_required",
  "credentials_invalid",
  "account_locked",
  "account_unconfirmed",
  "link_invalid",
  "mfa_expired",
  "totp_invalid",
  "totp_not_pending",
  "mail_unavailable",
  "account_unavailable",
  "challenge_required",
  "too_many_emails",
  "session_required",
  "csrf_rejected",
  "session_unavailable",
  "network",
];

const RULES: readonly PasswordRule[] = ["length", "letter", "digit", "special", "too_long"];

export type AccountCall<T = null> =
  | { ok: true; value: T }
  | { ok: false; reason: AccountClientFailure; rules?: PasswordRule[] };

/** Un code inconnu (version d'avant, corps illisible) vaut « indisponible » : jamais une chaîne affichée telle quelle. */
function readFailure(body: unknown): { reason: AccountClientFailure; rules?: PasswordRule[] } {
  const error = (body as { error?: { code?: unknown; rules?: unknown } } | null)?.error;
  const reason = KNOWN_FAILURES.includes(error?.code as AccountClientFailure)
    ? (error?.code as AccountClientFailure)
    : "account_unavailable";
  const rules = Array.isArray(error?.rules)
    ? error.rules.filter((rule): rule is PasswordRule => RULES.includes(rule as PasswordRule))
    : [];
  return rules.length > 0 ? { reason, rules } : { reason };
}

/**
 * Un appel du compte. `read` extrait la valeur du corps ; `null` = corps
 * illisible, qui vaut une indisponibilité plutôt qu'un écran à moitié rendu.
 */
async function call<T>(
  method: "GET" | "POST",
  path: string,
  body: Record<string, unknown> | null,
  read: (reply: unknown) => T | null,
): Promise<AccountCall<T>> {
  let response: Response;
  try {
    response = await fetch(
      ACCOUNT_API_BASE + path,
      method === "GET"
        ? undefined
        : { method, headers: { "Content-Type": "application/json", ...REQUEST_HEADER }, body: JSON.stringify(body ?? {}) },
    );
  } catch {
    return { ok: false, reason: "network" };
  }
  const reply = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, ...readFailure(reply) };
  const value = read(reply);
  return value === null ? { ok: false, reason: "account_unavailable" } : { ok: true, value };
}

const acknowledged = (reply: unknown): null | true =>
  (reply as { ok?: unknown } | null)?.ok === true ? true : null;

/** Les écritures qui ne rendent que « c'est fait ». */
async function post(path: string, body: Record<string, unknown>): Promise<AccountCall<null>> {
  const result = await call("POST", path, body, acknowledged);
  return result.ok ? { ok: true, value: null } : result;
}

// ── Inscription et liens envoyés par courriel ────────────────────────────────

/**
 * Le défi anti-robot, demandé puis résolu ici, LIÉ à l'adresse normalisée
 * (comme celui d'un dépôt l'est à son identifiant de demande). Sans défi
 * disponible on tente quand même : c'est le serveur qui l'exige, ou non.
 * Rend `{}` ou `{ challenge }`, à étaler dans le corps.
 */
async function challengeFor(email: string): Promise<{ challenge?: SolvedChallenge }> {
  const toSolve = challengeToSolve(await fetchDepositChallenge());
  return toSolve === null ? {} : { challenge: await solveChallenge(toSolve, 2000, email) };
}

/**
 * Demande la création du compte : adresse et conditions, RIEN d'autre. Le mot
 * de passe se choisit sur la page du lien reçu (`confirmAccount`) — sinon
 * quelqu'un pourrait pré-inscrire l'adresse d'un autre avec SON mot de passe.
 * La réponse est la MÊME que l'adresse soit libre ou non : ne jamais en
 * déduire « adresse acceptée ».
 */
export async function registerAccount(input: { email: string; cguAccepted: boolean }): Promise<AccountCall<null>> {
  if (!input.cguAccepted) return { ok: false, reason: "cgu_required" };
  const email = normalizeEmail(input.email);
  if (email === null) return { ok: false, reason: "email_invalid" };
  return post("/v1/compte/inscription", { email: input.email, cguAccepted: true, ...(await challengeFor(email)) });
}

/** Active le compte avec le jeton du lien et le mot de passe choisi (`link_invalid` si périmé ou déjà utilisé). */
export function confirmAccount(jeton: string, password: string): Promise<AccountCall<null>> {
  return post("/v1/compte/confirmation", { jeton, password });
}

/** Renvoie le lien de confirmation. Réponse identique pour toute adresse. */
export async function resendConfirmation(email: string): Promise<AccountCall<null>> {
  const normalized = normalizeEmail(email);
  if (normalized === null) return { ok: false, reason: "email_invalid" };
  return post("/v1/compte/confirmation/renvoi", { email, ...(await challengeFor(normalized)) });
}

/** Demande le lien de réinitialisation. Réponse identique pour toute adresse. */
export async function requestPasswordReset(email: string): Promise<AccountCall<null>> {
  const normalized = normalizeEmail(email);
  if (normalized === null) return { ok: false, reason: "email_invalid" };
  return post("/v1/compte/mot-de-passe-oublie", { email, ...(await challengeFor(normalized)) });
}

/** Pose le nouveau mot de passe avec le jeton du lien ; le serveur ferme alors toutes les sessions. */
export function resetPassword(jeton: string, password: string): Promise<AccountCall<null>> {
  return post("/v1/compte/mot-de-passe", { jeton, password });
}

// ── Connexion ────────────────────────────────────────────────────────────────

/** Session ouverte (cookie posé), ou second facteur à fournir avec ce ticket. */
export type LoginOutcome = { kind: "session" } | { kind: "mfa"; ticket: string };

function readLogin(reply: unknown): LoginOutcome | null {
  const body = reply as { authenticated?: unknown; kind?: unknown; mfaRequired?: unknown; ticket?: unknown } | null;
  if (body?.authenticated === true && body.kind === "account") return { kind: "session" };
  if (body?.mfaRequired === true && typeof body.ticket === "string" && body.ticket !== "") {
    return { kind: "mfa", ticket: body.ticket };
  }
  return null;
}

export function login(input: { email: string; password: string; remember: boolean }): Promise<AccountCall<LoginOutcome>> {
  return call("POST", "/v1/compte/connexion", input, readLogin);
}

/** Second facteur : le ticket de `login` et le code à six chiffres. */
export async function loginTotp(input: { ticket: string; code: string }): Promise<AccountCall<null>> {
  const result = await call("POST", "/v1/compte/connexion/totp", input, (reply) =>
    (reply as { authenticated?: unknown } | null)?.authenticated === true ? true : null,
  );
  return result.ok ? { ok: true, value: null } : result;
}

// ── Compte connecté ──────────────────────────────────────────────────────────

export interface AccountProfile {
  email: string;
  totpEnabled: boolean;
}

/** Le compte de la session ; `session_required` = pas (ou plus) connecté. */
export function fetchAccount(): Promise<AccountCall<AccountProfile>> {
  return call("GET", "/v1/compte", null, (reply) => {
    const compte = (reply as { compte?: Partial<AccountProfile> } | null)?.compte;
    if (typeof compte?.email !== "string" || typeof compte.totpEnabled !== "boolean") return null;
    return { email: compte.email, totpEnabled: compte.totpEnabled };
  });
}

export function changePassword(input: { current: string; password: string }): Promise<AccountCall<null>> {
  return post("/v1/compte/mot-de-passe/changement", input);
}

/**
 * Étape 1 de l'activation (mot de passe exigé) : le secret à scanner, et son URI
 * `otpauth://`. Si la double authentification est DÉJÀ active (changement
 * d'appareil), le code actuel est exigé aussi.
 */
export function startTotp(input: { password: string; code?: string }): Promise<AccountCall<{ secret: string; uri: string }>> {
  return call("POST", "/v1/compte/totp/activation", input.code ? { password: input.password, code: input.code } : { password: input.password }, (reply) => {
    const body = reply as { secret?: unknown; uri?: unknown } | null;
    return typeof body?.secret === "string" && typeof body.uri === "string" && body.uri.startsWith("otpauth://")
      ? { secret: body.secret, uri: body.uri }
      : null;
  });
}

/** Étape 2 : un premier code juste prouve que l'application est réglée. */
export function confirmTotp(code: string): Promise<AccountCall<null>> {
  return post("/v1/compte/totp/confirmation", { code });
}

export function disableTotp(input: { password: string; code: string }): Promise<AccountCall<null>> {
  return post("/v1/compte/totp/desactivation", input);
}

/** « Me déconnecter » : le serveur ferme la session et efface le cookie. */
export async function endAccountSession(): Promise<AccountCall<null>> {
  // Ce point d'accès répond `{ authenticated: false }`, pas `{ ok: true }` : seul le statut compte.
  const result = await call("POST", "/v1/session/fin", {}, () => true);
  return result.ok ? { ok: true, value: null } : result;
}

// ── Qui est là ───────────────────────────────────────────────────────────────

/** `none` : personne, ou impossible à dire — l'écran retombe sur la connexion. */
export type SessionKind = "account" | "guest" | "none";

export async function fetchSessionKind(): Promise<SessionKind> {
  try {
    const response = await fetch(ACCOUNT_API_BASE + "/v1/session");
    if (!response.ok) return "none";
    const body = (await response.json().catch(() => null)) as { authenticated?: unknown; kind?: unknown } | null;
    if (body?.authenticated !== true) return "none";
    return body.kind === "account" ? "account" : body.kind === "guest" ? "guest" : "none";
  } catch {
    return "none";
  }
}
