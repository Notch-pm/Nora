/**
 * Supabase Auth (GoTrue) du projet Nora, vu par le compte citoyen — le SEUL
 * fichier qui en connaît les routes.
 *
 * GoTrue garde l'adresse et le mot de passe (haché bcrypt), et produit les
 * jetons des liens envoyés par courriel. Il ne garde PAS la session : ses
 * jetons ne vont jamais au navigateur (la session est celle du lot L1,
 * `session/`), et chaque session GoTrue ouverte pour vérifier un mot de passe
 * ou un lien est aussitôt révoquée.
 *
 * Aucun courriel ne part d'ici : `generate_link` rend le jeton sans rien
 * envoyer, et c'est portal-api qui écrit à l'usager, depuis le serveur d'envoi
 * de SA collectivité (`mail/`) — un projet GoTrue n'a qu'une adresse
 * d'expéditeur et qu'une URL de site, le portail en a une par collectivité.
 *
 * Tout passe par la clé service_role, côté serveur seulement.
 */

export type CreateUserResult =
  | { kind: "created"; userId: string }
  | { kind: "exists" }
  | { kind: "unavailable" };

export type PasswordCheck =
  | { kind: "ok"; userId: string }
  | { kind: "invalid" }
  | { kind: "unconfirmed" }
  | { kind: "unavailable" };

export type LinkCheck = { kind: "ok"; userId: string } | { kind: "invalid" } | { kind: "unavailable" };

export type LinkType = "magiclink" | "recovery";

export interface IdentityProvider {
  /** Crée l'identité, adresse NON confirmée. Aucun courriel ne part. */
  createUser(email: string, password: string): Promise<CreateUserResult>;
  /** Jeton (haché) d'un lien de confirmation ou de réinitialisation ; `null` si l'adresse est inconnue. */
  linkToken(type: LinkType, email: string): Promise<string | null | "unavailable">;
  /** Consomme le jeton d'un lien. Un lien de connexion confirme l'adresse au passage. */
  verifyLink(type: LinkType, tokenHash: string): Promise<LinkCheck>;
  checkPassword(email: string, password: string): Promise<PasswordCheck>;
  setPassword(userId: string, password: string): Promise<boolean>;
  emailOf(userId: string): Promise<string | null>;
}

export interface IdentityConfig {
  /** `SUPABASE_URL` du projet Nora. */
  url: string;
  /** `SUPABASE_SERVICE_ROLE_KEY`. */
  serviceKey: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Le code d'erreur de GoTrue, quelle que soit sa génération (`error_code`, `error`, `msg`). */
export function goTrueError(body: unknown): string {
  const r = record(body);
  if (r === null) return "";
  for (const key of ["error_code", "code", "error", "msg", "message", "error_description"]) {
    const v = r[key];
    if (typeof v === "string" && v !== "") return v.toLowerCase();
  }
  return "";
}

function userIdOf(body: unknown): string | null {
  const r = record(body);
  if (r === null) return null;
  const user = record(r.user) ?? r;
  return typeof user.id === "string" ? user.id : null;
}

export function createIdentityProvider(config: IdentityConfig): IdentityProvider {
  const base = config.url.replace(/\/+$/, "") + "/auth/v1";
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const adminHeaders = {
    apikey: config.serviceKey,
    Authorization: "Bearer " + config.serviceKey,
    "Content-Type": "application/json",
  };

  async function call(
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> },
  ): Promise<{ status: number; body: unknown } | null> {
    try {
      const response = await fetch(base + path, {
        method: init.method,
        headers: init.headers ?? adminHeaders,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    } catch {
      return null;
    }
  }

  /** Une session GoTrue ouverte pour vérifier quelque chose ne doit pas survivre. */
  async function revoke(body: unknown): Promise<void> {
    const token = record(body)?.access_token;
    if (typeof token !== "string") return;
    await call("/logout?scope=local", {
      method: "POST",
      headers: { apikey: config.serviceKey, Authorization: "Bearer " + token },
    });
  }

  return {
    async createUser(email, password) {
      const reply = await call("/admin/users", { method: "POST", body: { email, password, email_confirm: false } });
      if (reply === null || reply.status >= 500) return { kind: "unavailable" };
      if (reply.status === 200 || reply.status === 201) {
        const id = userIdOf(reply.body);
        return id === null ? { kind: "unavailable" } : { kind: "created", userId: id };
      }
      const code = goTrueError(reply.body);
      // Seule « adresse déjà prise » vaut `exists` : un 422 pour une autre raison
      // (adresse ou mot de passe refusés par GoTrue) est une panne à journaliser.
      if (code.includes("exists") || code.includes("already")) return { kind: "exists" };
      console.error("portal-api : création d'identité refusée par GoTrue", reply.status, code);
      return { kind: "unavailable" };
    },

    async linkToken(type, email) {
      const reply = await call("/admin/generate_link", { method: "POST", body: { type, email } });
      if (reply === null || reply.status >= 500) return "unavailable";
      if (reply.status === 404 || reply.status === 422 || reply.status === 400) return null;
      const r = record(reply.body);
      const props = record(r?.properties);
      const hashed = props?.hashed_token ?? r?.hashed_token;
      return typeof hashed === "string" && hashed !== "" ? hashed : "unavailable";
    },

    async verifyLink(type, tokenHash) {
      // `email` pour un lien de connexion : c'est le type qu'attend la
      // vérification par empreinte (`magiclink` répond « otp_expired »).
      const reply = await call("/verify", {
        method: "POST",
        body: { type: type === "magiclink" ? "email" : "recovery", token_hash: tokenHash },
        headers: { apikey: config.serviceKey, "Content-Type": "application/json" },
      });
      if (reply === null || reply.status >= 500) return { kind: "unavailable" };
      if (reply.status !== 200) return { kind: "invalid" };
      await revoke(reply.body);
      const id = userIdOf(reply.body);
      return id === null ? { kind: "unavailable" } : { kind: "ok", userId: id };
    },

    async checkPassword(email, password) {
      const reply = await call("/token?grant_type=password", {
        method: "POST",
        body: { email, password },
        headers: { apikey: config.serviceKey, "Content-Type": "application/json" },
      });
      if (reply === null || reply.status >= 500) return { kind: "unavailable" };
      if (reply.status === 200) {
        await revoke(reply.body);
        const id = userIdOf(reply.body);
        return id === null ? { kind: "unavailable" } : { kind: "ok", userId: id };
      }
      if (reply.status === 429) {
        // ⚠️ Le frein de GoTrue est PAR ADRESSE IP, et toutes nos vérifications
        // partent des quelques adresses des edge functions : à surveiller en
        // charge (lot L8), relever dans les réglages Auth si besoin.
        console.error("portal-api : GoTrue limite les connexions (429)");
        return { kind: "unavailable" };
      }
      const code = goTrueError(reply.body);
      if (code.includes("not_confirmed") || code.includes("not confirmed")) return { kind: "unconfirmed" };
      return { kind: "invalid" };
    },

    async setPassword(userId, password) {
      const reply = await call(`/admin/users/${encodeURIComponent(userId)}`, { method: "PUT", body: { password } });
      return reply !== null && reply.status === 200;
    },

    async emailOf(userId) {
      const reply = await call(`/admin/users/${encodeURIComponent(userId)}`, { method: "GET" });
      if (reply === null || reply.status !== 200) return null;
      const email = record(reply.body)?.email;
      return typeof email === "string" ? email : null;
    },
  };
}
