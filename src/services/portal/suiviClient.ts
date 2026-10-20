/**
 * Client HTTP du SUIVI d'une demande (`/suivi`, espace usager L2).
 *
 * ⚠️ MÊME ORIGINE, PAS `VITE_PORTAL_API_URL`. Le suivi repose sur un cookie
 * HttpOnly de première partie, posé par `portal-api` à l'ouverture de l'accès
 * et renvoyé tout seul aux appels suivants. Appelé en direct sur *.supabase.co,
 * ce cookie serait un cookie TIERS : refusé par les navigateurs, et le suivi
 * ne tiendrait jamais. On passe donc par `/api`, relayé par le Worker en
 * production (`worker/proxy.ts`) et par le proxy de Vite en développement
 * (`vite.config.ts`). Le défaut de `credentials` (same-origin) est conservé :
 * il envoie le cookie, et c'est exactement ce qu'on veut.
 *
 * Les écritures portent `x-nora-request: 1` : sans lui le serveur répond
 * `csrf_rejected` (un formulaire d'un autre site ne peut pas poser cet en-tête).
 */
import type { SuiviAccess, SuiviDemande, SuiviFailure, SuiviPiece, SuiviStatus } from "@fn/_shared/domain/suivi.ts";

/** La base du suivi : le relais de même origine, jamais l'adresse directe de l'API. */
export const SUIVI_API_BASE = "/api";

/** En-tête exigé des écritures — voir `sessionService.ts` côté fonctions. */
const REQUEST_HEADER = { "x-nora-request": "1" } as const;

/**
 * Les échecs du suivi, plus ceux de la session et celui que le serveur ne peut
 * pas signaler (`network`).
 */
export type SuiviClientFailure =
  | SuiviFailure
  | "session_required"
  | "csrf_rejected"
  | "session_unavailable"
  | "network";

/** Codes connus, pour ne pas faire confiance à une chaîne arbitraire. */
const KNOWN_FAILURES: readonly SuiviClientFailure[] = [
  "suivi_refused",
  "suivi_too_many_attempts",
  "suivi_unavailable",
  "not_configured",
  "bad_request",
  "session_required",
  "csrf_rejected",
  "session_unavailable",
  "network",
];

/** Un code inconnu (version d'avant, corps illisible) vaut « indisponible » : jamais une chaîne affichée telle quelle. */
export function readFailure(body: unknown): SuiviClientFailure {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return KNOWN_FAILURES.includes(code as SuiviClientFailure)
    ? (code as SuiviClientFailure)
    : "suivi_unavailable";
}

export type SuiviOpen = { ok: true } | { ok: false; reason: SuiviClientFailure };

/**
 * « Code perdu » (L4a) : référence + courriel déclaré. Le serveur répond de la
 * même façon que tout concorde ou non : `ok` veut dire « la demande est
 * partie », pas « un code est parti ».
 */
export async function resendSuiviCode(input: { reference: string; email: string }): Promise<SuiviOpen> {
  let response: Response;
  try {
    response = await fetch(SUIVI_API_BASE + "/v1/suivi/renvoi", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...REQUEST_HEADER },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (response.ok) return { ok: true };
  return { ok: false, reason: readFailure(await response.json().catch(() => null)) };
}

/**
 * Ouvre l'accès : référence + courriel + code. Le serveur pose le cookie ; la
 * réponse n'est lue que pour savoir si c'est ouvert.
 */
export async function openSuivi(access: SuiviAccess): Promise<SuiviOpen> {
  let response: Response;
  try {
    response = await fetch(SUIVI_API_BASE + "/v1/suivi", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...REQUEST_HEADER },
      body: JSON.stringify(access),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };
  if ((body as { authenticated?: unknown } | null)?.authenticated !== true) {
    return { ok: false, reason: "suivi_unavailable" };
  }
  return { ok: true };
}

export type SuiviLoad =
  | { ok: true; demande: SuiviDemande }
  | { ok: false; reason: SuiviClientFailure };

export const STATUSES: readonly SuiviStatus[] = ["envoyee", "en_cours", "en_attente", "traitee", "annulee", "archivee"];

function readPieces(raw: unknown): SuiviPiece[] {
  return Array.isArray(raw)
    ? raw.filter(
        (p): p is SuiviPiece =>
          typeof p === "object" && p !== null &&
          typeof (p as SuiviPiece).id === "string" &&
          typeof (p as SuiviPiece).fileName === "string",
      )
    : [];
}

/**
 * La demande telle que le serveur la rend — la FORME seulement (il a déjà fait
 * la liste blanche, voir `toSuiviDemande`). Les listes absentes sont vides :
 * l'écran n'a aucun cas d'absence à porter.
 */
export function readDemande(body: unknown): SuiviDemande | null {
  const raw = (body as { demande?: Partial<SuiviDemande> } | null)?.demande;
  if (typeof raw !== "object" || raw === null) return null;
  if (typeof raw.reference !== "string" || raw.reference === "") return null;
  if (typeof raw.receivedAt !== "string" || typeof raw.updatedAt !== "string") return null;
  if (!STATUSES.includes(raw.status as SuiviStatus)) return null;
  return {
    reference: raw.reference,
    subject: typeof raw.subject === "string" ? raw.subject : "",
    demarcheName: typeof raw.demarcheName === "string" ? raw.demarcheName : null,
    status: raw.status as SuiviStatus,
    receivedAt: raw.receivedAt,
    updatedAt: raw.updatedAt,
    closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
    closureText: typeof raw.closureText === "string" ? raw.closureText : null,
    pieces: readPieces(raw.pieces),
    messages: Array.isArray(raw.messages)
      ? raw.messages
          .filter((m) => typeof m === "object" && m !== null && typeof m.id === "string" && typeof m.sentAt === "string")
          .map((m) => ({
            id: m.id,
            subject: typeof m.subject === "string" ? m.subject : "",
            body: typeof m.body === "string" ? m.body : "",
            sentAt: m.sentAt,
            pieces: readPieces(m.pieces),
          }))
      : [],
  };
}

/**
 * La demande de la session en cours. `session_required` (401) = pas ou plus
 * d'accès ouvert : l'écran réaffiche le formulaire.
 */
export async function fetchSuiviDemande(): Promise<SuiviLoad> {
  let response: Response;
  try {
    response = await fetch(SUIVI_API_BASE + "/v1/suivi/demande");
  } catch {
    return { ok: false, reason: "network" };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };
  const demande = readDemande(body);
  // 200 mais illisible : une indisponibilité, pas une vue à moitié rendue.
  if (demande === null) return { ok: false, reason: "suivi_unavailable" };
  return { ok: true, demande };
}

/** « Quitter le suivi » : le serveur ferme la session et efface le cookie. */
export async function endSuivi(): Promise<SuiviOpen> {
  let response: Response;
  try {
    response = await fetch(SUIVI_API_BASE + "/v1/session/fin", { method: "POST", headers: REQUEST_HEADER });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (response.ok) return { ok: true };
  return { ok: false, reason: readFailure(await response.json().catch(() => null)) };
}

/**
 * Le lien de téléchargement d'une pièce. Le serveur répond par une redirection
 * vers une URL signée de 60 s ; le cookie part tout seul (même origine), donc un
 * simple `<a href>` suffit.
 */
export function suiviPieceHref(pieceId: string): string {
  return SUIVI_API_BASE + "/v1/suivi/demande/pieces/" + encodeURIComponent(pieceId);
}
