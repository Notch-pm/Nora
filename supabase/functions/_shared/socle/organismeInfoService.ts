/**
 * Les informations usagers des organismes de la collectivité, traduites dans
 * le modèle du portail.
 *
 * Même règle que la déclaration d'accessibilité : **absence n'est pas panne**.
 * Rien d'écrit, c'est `200 []` au Socle, donc une liste vide ici. Seules une
 * clé refusée ou un Socle injoignable sont des échecs — et l'assistant, qui est
 * aujourd'hui le seul lecteur, s'en passe (voir `TurnDeps.loadOrganismes`).
 */
import { type OrganismeInfo, parseOrganismesInfo } from "../domain/organismeInfo.ts";
import { type CourrierOrganisme, parseCourrierOrganismes } from "../domain/courrier.ts";
import type { PortalFailure } from "../domain/failure.ts";
import type { SocleClient } from "./socleClient.ts";

export type OrganismesInfoResult =
  | { ok: true; organismes: OrganismeInfo[] }
  | { ok: false; reason: PortalFailure };

export async function getOrganismesInfo(tenantId: string, socle: SocleClient): Promise<OrganismesInfoResult> {
  const reply = await socle.get("/v1/portal/organizations?tenant_id=" + encodeURIComponent(tenantId));
  switch (reply.kind) {
    case "ok":
      return { ok: true, organismes: parseOrganismesInfo(reply.body) };
    // Un Socle d'avant 1.30.0 ne connaît pas la route : rien d'écrit, pas une panne.
    case "not_found":
      return { ok: true, organismes: [] };
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "socle_unavailable" };
  }
}

export type CourrierOrganismesResult =
  | { ok: true; organismes: CourrierOrganisme[] }
  | { ok: false; reason: PortalFailure };

/**
 * Les organismes de la collectivité, vus du COURRIER LIBRE : qui reçoit du
 * courrier (`free_mail`, contrat 1.38.0), sous quel libellé, à quelle adresse.
 *
 * ⚠️ LA MÊME LECTURE que `getOrganismesInfo` — même chemin, donc même entrée
 * du cache : le courrier libre ne coûte pas un appel de plus au Socle quand
 * l'assistant l'a déjà réchauffée. Seule la lecture diffère : l'assistant
 * écarte un organisme qui n'a rien écrit, le courrier libre le garde — on peut
 * écrire à un organisme qui n'a pas publié ses horaires.
 *
 * Mêmes règles d'absence : un Socle d'avant la route (404) ou d'avant
 * `free_mail` donne des organismes FERMÉS — personne ne reçoit de courrier,
 * rien n'est en panne.
 */
export async function getCourrierOrganismes(
  tenantId: string,
  socle: SocleClient,
): Promise<CourrierOrganismesResult> {
  const reply = await socle.get("/v1/portal/organizations?tenant_id=" + encodeURIComponent(tenantId));
  switch (reply.kind) {
    case "ok":
      return { ok: true, organismes: parseCourrierOrganismes(reply.body) };
    case "not_found":
      return { ok: true, organismes: [] };
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "socle_unavailable" };
  }
}
