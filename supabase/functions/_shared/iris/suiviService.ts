/**
 * Le suivi d'une demande sans compte, côté Iris (contrat 2.6.0, scope
 * `requests:citizen`). Seul fichier du portail à connaître ces routes.
 *
 *   · `verifyAccess` : courriel + référence + code → l'identifiant de la
 *     demande, que `portal-api` range dans une session invitée et ne rend
 *     JAMAIS au navigateur ;
 *   · `readDemande` / `pieceUrl` : lus pour l'identifiant tenu par la session.
 *
 * Iris revérifie elle-même le tenant (en-tête de la clé plateforme), la source
 * et que l'accès est ouvert et non expiré : un identifiant forgé de ce côté-ci
 * ne lirait rien. Tout refus est un « non » unique (`suivi_refused`).
 */
import { type SuiviAccess, type SuiviDemande, type SuiviFailure, toSuiviDemande } from "../domain/suivi.ts";
import type { IrisClient, IrisReply } from "./irisClient.ts";

export type SuiviResult<T> = { ok: true; value: T } | { ok: false; reason: SuiviFailure };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function failureOf(reply: Exclude<IrisReply, { kind: "ok" }>): SuiviFailure {
  switch (reply.kind) {
    case "not_found":
      return "suivi_refused";
    case "rejected":
      // 400 d'Iris sur une saisie qu'il juge mal formée : même « non ».
      return reply.status === 429 ? "suivi_too_many_attempts" : "suivi_refused";
    case "auth_failed":
      // La clé du portail n'a pas le scope `requests:citizen` : panne de
      // configuration, pas un refus de l'usager.
      console.error("portal-api : accès invité refusé à la clé du portail (scope requests:citizen ?)");
      return "suivi_unavailable";
    case "unreachable":
    case "unexpected":
      return "suivi_unavailable";
  }
}

export async function verifyAccess(access: SuiviAccess, iris: IrisClient): Promise<SuiviResult<string>> {
  const reply = await iris.post("/v1/citizen/access", access);
  if (reply.kind !== "ok") return { ok: false, reason: failureOf(reply) };
  const body = reply.body as Record<string, unknown> | null;
  const id = body && typeof body.request_id === "string" ? body.request_id : "";
  if (!UUID_RE.test(id)) {
    console.error("portal-api : réponse d'accès invité sans identifiant de demande.");
    return { ok: false, reason: "suivi_unavailable" };
  }
  return { ok: true, value: id };
}

export async function readDemande(requestId: string, iris: IrisClient): Promise<SuiviResult<SuiviDemande>> {
  if (!UUID_RE.test(requestId)) return { ok: false, reason: "suivi_refused" };
  const reply = await iris.get(`/v1/citizen/requests/${requestId}`);
  if (reply.kind !== "ok") return { ok: false, reason: failureOf(reply) };
  const demande = toSuiviDemande(reply.body);
  if (demande === null) {
    console.error("portal-api : vue usager d'Iris illisible.");
    return { ok: false, reason: "suivi_unavailable" };
  }
  return { ok: true, value: demande };
}

/** URL signée (60 s) d'une pièce visible par l'usager. */
export async function pieceUrl(
  requestId: string,
  pieceId: string,
  iris: IrisClient,
): Promise<SuiviResult<string>> {
  if (!UUID_RE.test(requestId) || !UUID_RE.test(pieceId)) return { ok: false, reason: "suivi_refused" };
  const reply = await iris.get(`/v1/citizen/requests/${requestId}/attachments/${pieceId}`);
  if (reply.kind !== "ok") return { ok: false, reason: failureOf(reply) };
  const body = reply.body as Record<string, unknown> | null;
  const url = body && typeof body.url === "string" ? body.url : "";
  if (!url.startsWith("https://")) {
    console.error("portal-api : URL de pièce invalide renvoyée par Iris.");
    return { ok: false, reason: "suivi_unavailable" };
  }
  return { ok: true, value: url };
}
