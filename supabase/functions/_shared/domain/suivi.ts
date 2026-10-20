/**
 * Le suivi d'une demande SANS COMPTE — le modèle du PORTAIL (espace usager,
 * lot L2 ; analyse dans Notch/Sceaux/02-espace-usager.md).
 *
 * L'usager qui l'a accepté au dépôt reçoit un code d'accès (tiré par Iris,
 * affiché une fois et cité dans l'accusé de réception). Sur `/suivi`, son
 * adresse, la référence et ce code ouvrent une SESSION INVITÉE limitée à
 * cette seule demande (`session/`, kind `guest`) : le navigateur ne désigne
 * ensuite plus jamais la demande, c'est la session qui la porte.
 *
 * Logique pure, partagée avec l'interface par `@fn` : la forme de la vue et
 * les libellés de statut sont écrits une fois, ici.
 */

/** Statuts tels que l'usager les lit (CCTP Sceaux 4.1) — la liste d'Iris est plus fine. */
export type SuiviStatus = "envoyee" | "en_cours" | "en_attente" | "traitee" | "annulee" | "archivee";

/**
 * Statut Iris → statut usager. Un statut inconnu (Iris en ajoute un) se lit
 * « en cours » : c'est vrai d'une demande qui n'est ni close ni nouvelle, et
 * jamais une promesse de réponse.
 */
export function suiviStatusOf(irisStatus: string): SuiviStatus {
  switch (irisStatus) {
    case "a_traiter":
      return "envoyee";
    case "en_attente":
      return "en_attente";
    case "resolue_positive":
    case "resolue_negative":
      return "traitee";
    case "annulee":
      return "annulee";
    case "archivee":
      return "archivee";
    default:
      return "en_cours";
  }
}

export interface SuiviPiece {
  id: string;
  fileName: string;
  mimeType: string | null;
  size: number | null;
}

export interface SuiviMessage {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
  pieces: SuiviPiece[];
}

/** Ce que l'usager voit de SA demande. Ni identifiant interne, ni motif de clôture, ni agent. */
export interface SuiviDemande {
  reference: string;
  subject: string;
  demarcheName: string | null;
  status: SuiviStatus;
  receivedAt: string;
  updatedAt: string;
  closedAt: string | null;
  /** Rédigé par la collectivité POUR l'usager ; présent une fois la demande close. */
  closureText: string | null;
  pieces: SuiviPiece[];
  messages: SuiviMessage[];
}

/** Ce que saisit l'usager sur `/suivi`. */
export interface SuiviAccess {
  reference: string;
  email: string;
  code: string;
}

/** Échecs propres au suivi (les échecs de session ont leur propre liste). */
export type SuiviFailure =
  /** Une seule réponse pour tout refus : inconnue, faux code, verrouillée, expirée. */
  | "suivi_refused"
  /** Trop d'essais depuis ce visiteur. */
  | "suivi_too_many_attempts"
  /** Iris injoignable ou réponse incompréhensible. */
  | "suivi_unavailable"
  /** Le portail n'a pas sa configuration. */
  | "not_configured"
  /** Corps illisible. */
  | "bad_request";

export const SUIVI_MESSAGES: Record<SuiviFailure, string> = {
  suivi_refused:
    "Ces informations ne permettent pas d'accéder à une demande. Vérifiez-les ; après plusieurs essais, l'accès est suspendu une heure.",
  suivi_too_many_attempts: "Trop d'essais en peu de temps : patientez quelques minutes.",
  suivi_unavailable: "Le suivi est momentanément indisponible. Merci de réessayer dans quelques instants.",
  not_configured: "Le suivi n'est pas disponible sur ce site.",
  bad_request: "Ces informations n'ont pas pu être lues.",
};

export function httpStatusForSuiviFailure(failure: SuiviFailure): number {
  switch (failure) {
    case "suivi_refused":
      return 404;
    case "suivi_too_many_attempts":
      return 429;
    case "suivi_unavailable":
      return 502;
    case "not_configured":
      return 503;
    case "bad_request":
      return 400;
  }
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.length > max ? null : trimmed;
}

/** La saisie de `/suivi`, bornée — la vérification de fond appartient à Iris. */
export function parseSuiviAccess(body: unknown): SuiviAccess | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const reference = text(record.reference, 40);
  const email = text(record.email, 320);
  const code = text(record.code, 20);
  if (reference === null || email === null || code === null || !email.includes("@")) return null;
  return { reference, email, code };
}

/** « Code perdu » (lot L4a) : la référence et l'adresse déclarée au dépôt, bornées. */
export function parseSuiviRenvoi(body: unknown): { reference: string; email: string } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const reference = text(record.reference, 40);
  const email = text(record.email, 320);
  if (reference === null || email === null || !email.includes("@")) return null;
  return { reference, email };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toPiece(value: unknown): SuiviPiece | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.file_name !== "string") return null;
  return {
    id: value.id,
    fileName: value.file_name,
    mimeType: stringOrNull(value.mime_type),
    size: typeof value.size === "number" ? value.size : null,
  };
}

function pieces(value: unknown): SuiviPiece[] {
  return Array.isArray(value) ? value.map(toPiece).filter((p): p is SuiviPiece => p !== null) : [];
}

/**
 * La vue usager d'Iris → celle du portail. Liste blanche À NOUVEAU, champ par
 * champ : Iris ne sert déjà que la vue usager, mais un champ ajouté demain de
 * son côté ne doit pas apparaître ici sans qu'on l'ait décidé. `null` si la
 * réponse n'a pas la forme attendue.
 */
export function toSuiviDemande(body: unknown): SuiviDemande | null {
  if (!isRecord(body) || !isRecord(body.request)) return null;
  const r = body.request;
  if (typeof r.reference !== "string" || typeof r.status !== "string") return null;
  if (typeof r.received_at !== "string" || typeof r.updated_at !== "string") return null;
  return {
    reference: r.reference,
    subject: typeof r.subject === "string" ? r.subject : "",
    demarcheName: stringOrNull(r.procedure_name),
    status: suiviStatusOf(r.status),
    receivedAt: r.received_at,
    updatedAt: r.updated_at,
    closedAt: stringOrNull(r.closed_at),
    closureText: stringOrNull(r.closure_text),
    pieces: pieces(r.attachments),
    messages: Array.isArray(r.messages)
      ? r.messages
          .filter(isRecord)
          .filter((m) => typeof m.id === "string" && typeof m.sent_at === "string")
          .map((m) => ({
            id: m.id as string,
            subject: typeof m.subject === "string" ? m.subject : "",
            body: typeof m.body === "string" ? m.body : "",
            sentAt: m.sent_at as string,
            pieces: pieces(m.attachments),
          }))
      : [],
  };
}
