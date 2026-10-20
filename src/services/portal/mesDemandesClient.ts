/**
 * Client HTTP de « Mes demandes » (`/v1/compte/demandes`, espace usager L3b).
 *
 * Même origine (`/api`), cookie de session de compte — voir `accountClient.ts`.
 * Les échecs sont ceux du suivi (`suivi_refused`, `suivi_unavailable`,
 * `not_configured`…), plus `session_required` : l'écran renvoie alors à la
 * connexion. Le détail d'une demande a la forme du suivi (`SuiviDemande`).
 */
import type { SuiviDemande, SuiviStatus } from "@fn/_shared/domain/suivi.ts";
import { ACCOUNT_API_BASE } from "./accountClient.ts";
import { readDemande, readFailure, STATUSES, type SuiviClientFailure } from "./suiviClient.ts";
export { postMaDemandeMessage } from "./suiviClient.ts";

/** Une demande dans la liste. `id` sert à ouvrir le détail. */
export interface DemandeResume {
  id: string;
  reference: string;
  subject: string;
  demarcheName: string | null;
  status: SuiviStatus;
  receivedAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface MesDemandesPage {
  demandes: DemandeResume[];
  /** Curseur de la page suivante (`avant`), ou `null`. */
  suivante: string | null;
  /** Profil pas rempli : aucune fiche, donc aucune demande — inviter à compléter « Mes informations ». */
  profilRequis: boolean;
}

export type MesDemandesCall<T> = { ok: true; value: T } | { ok: false; reason: SuiviClientFailure };

function readResume(raw: unknown): DemandeResume | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id === "" || typeof r.reference !== "string" || r.reference === "") return null;
  if (typeof r.receivedAt !== "string" || typeof r.updatedAt !== "string") return null;
  if (!STATUSES.includes(r.status as SuiviStatus)) return null;
  return {
    id: r.id,
    reference: r.reference,
    subject: typeof r.subject === "string" ? r.subject : "",
    demarcheName: typeof r.demarcheName === "string" ? r.demarcheName : null,
    status: r.status as SuiviStatus,
    receivedAt: r.receivedAt,
    updatedAt: r.updatedAt,
    closedAt: typeof r.closedAt === "string" ? r.closedAt : null,
  };
}

async function get<T>(path: string, read: (body: unknown) => T | null): Promise<MesDemandesCall<T>> {
  let response: Response;
  try {
    response = await fetch(ACCOUNT_API_BASE + path);
  } catch {
    return { ok: false, reason: "network" };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };
  const value = read(body);
  // 200 mais illisible : une indisponibilité, pas un écran à moitié rendu.
  return value === null ? { ok: false, reason: "suivi_unavailable" } : { ok: true, value };
}

/** Une page de demandes, la plus récente d'abord ; `avant` = le curseur `suivante` de la page précédente. */
export function fetchMesDemandes(avant: string | null = null): Promise<MesDemandesCall<MesDemandesPage>> {
  const query = avant === null ? "" : "?avant=" + encodeURIComponent(avant);
  return get("/v1/compte/demandes" + query, (body) => {
    const raw = body as { demandes?: unknown; suivante?: unknown; profilRequis?: unknown } | null;
    if (!Array.isArray(raw?.demandes)) return null;
    return {
      demandes: raw.demandes.map(readResume).filter((d): d is DemandeResume => d !== null),
      suivante: typeof raw.suivante === "string" && raw.suivante !== "" ? raw.suivante : null,
      profilRequis: raw.profilRequis === true,
    };
  });
}

/** Le détail d'une demande de SA fiche (`suivi_refused` si elle n'en est pas, ou n'existe pas). */
export function fetchMaDemande(id: string): Promise<MesDemandesCall<SuiviDemande>> {
  return get("/v1/compte/demandes/" + encodeURIComponent(id), readDemande);
}

/** Le lien d'une pièce : redirection vers une URL signée de 60 s, le cookie part tout seul. */
export function maDemandePieceHref(requestId: string, pieceId: string): string {
  return (
    ACCOUNT_API_BASE + "/v1/compte/demandes/" + encodeURIComponent(requestId) + "/pieces/" + encodeURIComponent(pieceId)
  );
}
