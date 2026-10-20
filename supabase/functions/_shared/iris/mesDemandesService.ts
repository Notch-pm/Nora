/**
 * « Mes demandes » d'un compte connecté (espace usager, lot L3b) : les
 * demandes rattachées à SA fiche du Socle, quel que soit le canal (décision PO
 * du 2026-10-19), lues chez Iris (contrat 2.7.0, scope `requests:citizen`) avec
 * le jeton court `contact:<fiche>` — la clé du portail seule n'y suffit pas.
 *
 * Iris revérifie tout : la fiche, la collectivité, qu'aucun agent n'a soustrait
 * la demande à l'espace usager. Ici, une liste blanche À NOUVEAU (motif de
 * `domain/suivi.ts`).
 */
import { type SuiviFailure, type SuiviStatus, suiviStatusOf } from "../domain/suivi.ts";
import type { IrisClient } from "./irisClient.ts";

export interface DemandeResume {
  /** Identifiant Iris : le navigateur le renvoie pour ouvrir la demande, Iris revérifie qu'elle est de SA fiche. */
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
}

export type MesDemandesResult = { ok: true; value: MesDemandesPage } | { ok: false; reason: SuiviFailure };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toResume(value: unknown): DemandeResume | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.id !== "string" || !UUID_RE.test(r.id) || typeof r.reference !== "string" || typeof r.status !== "string") {
    return null;
  }
  if (typeof r.received_at !== "string" || typeof r.updated_at !== "string") return null;
  return {
    id: r.id,
    reference: r.reference,
    subject: typeof r.subject === "string" ? r.subject : "",
    demarcheName: typeof r.procedure_name === "string" ? r.procedure_name : null,
    status: suiviStatusOf(r.status),
    receivedAt: r.received_at,
    updatedAt: r.updated_at,
    closedAt: typeof r.closed_at === "string" ? r.closed_at : null,
  };
}

export async function listMesDemandes(
  contactId: string,
  iris: IrisClient,
  headers: Record<string, string>,
  avant: string | null,
): Promise<MesDemandesResult> {
  if (!UUID_RE.test(contactId)) return { ok: false, reason: "suivi_refused" };
  const query = new URLSearchParams({ limit: "20" });
  if (avant !== null) {
    if (Number.isNaN(Date.parse(avant))) return { ok: false, reason: "bad_request" };
    query.set("before", avant);
  }
  const reply = await iris.get(`/v1/citizen/contacts/${contactId}/requests?${query.toString()}`, headers);
  if (reply.kind === "not_found") return { ok: false, reason: "suivi_refused" };
  if (reply.kind !== "ok") return { ok: false, reason: "suivi_unavailable" };
  const body = reply.body as Record<string, unknown> | null;
  if (body === null || !Array.isArray(body.requests)) return { ok: false, reason: "suivi_unavailable" };
  return {
    ok: true,
    value: {
      demandes: body.requests.map(toResume).filter((d): d is DemandeResume => d !== null),
      suivante: typeof body.next_before === "string" ? body.next_before : null,
    },
  };
}
