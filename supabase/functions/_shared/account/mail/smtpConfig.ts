/**
 * Le serveur d'envoi de la collectivité, lu au Socle
 * (`GET /v1/organizations/{id}/smtp`, scope `smtp` sur la clé de Nora) —
 * comme Clara, Iris et les courriels d'authentification du Socle lui-même.
 * Logique pure : la réponse du Socle → une configuration, ou `null`.
 *
 * Pas de relais de repli : un courriel du compte part du domaine de la
 * collectivité, ou ne part pas (l'écran dit alors « momentanément
 * indisponible »). Le mot de passe du relais ne quitte pas portal-api.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  fromEmail: string;
  fromName: string | null;
  /** STARTTLS exigé (587) ; le port 465 est en TLS implicite. */
  useTls: boolean;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function smtpFromSocle(body: unknown): SmtpConfig | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as Record<string, unknown>;
  if (r.configured !== true) return null;
  const host = text(r.host);
  const fromEmail = text(r.from_email);
  if (host === null || fromEmail === null) return null;
  const port = typeof r.port === "number" && Number.isInteger(r.port) && r.port >= 1 && r.port <= 65535 ? r.port : 587;
  return {
    host,
    port,
    username: text(r.username),
    password: typeof r.password === "string" && r.password !== "" ? r.password : null,
    fromEmail: fromEmail.toLowerCase(),
    fromName: text(r.from_name),
    // Absent = chiffré : une configuration incomplète ne dégrade pas vers du clair.
    useTls: r.use_tls !== false,
  };
}

/** `"Nom" <adresse>` — guillemets du nom échappés. */
export function senderHeader(config: SmtpConfig): string {
  if (config.fromName === null) return config.fromEmail;
  return `"${config.fromName.replace(/["\\]/g, "\\$&")}" <${config.fromEmail}>`;
}
