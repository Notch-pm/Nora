/**
 * Démarches publiques d'une collectivité.
 *
 * Le portail ne décide PAS ce qui est publié. Les trois règles — paramétrage en
 * `production`, démarche `externe`, visibilité et période du bloc communication
 * — appartiennent au Socle, qui les applique dans `GET /v1/portal/procedures`.
 * Les recopier ici les ferait diverger le jour où le paramétrage évolue, et un
 * portail qui diverge publie ce qui ne devait pas l'être.
 *
 * Même raison pour le choix de la route : `GET /v1/procedures` sert la
 * configuration INTÉGRALE d'une démarche (`form_schema`, `knowledge_base`,
 * `agent_description`, `requester_config`). Filtrer ces champs ici les aurait
 * déjà fait transiter par un serveur public. Ils ne quittent pas le Socle.
 *
 * Avec `tenantService`, ce fichier est le seul à connaître la forme des
 * réponses du Socle : il traduit vers le modèle du portail (`domain/demarche`).
 */
import type { Demarche } from "../domain/demarche.ts";
import type { PortalFailure } from "../domain/failure.ts";
import type { SocleClient } from "./socleClient.ts";

export type DemarchesResult =
  | { ok: true; demarches: Demarche[] }
  | { ok: false; reason: PortalFailure };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Traduction d'une démarche du Socle vers le modèle du portail. Une entrée sans
 * identifiant ou sans intitulé est ÉCARTÉE plutôt que rendue vide : une carte
 * anonyme dans une liste de démarches n'apprend rien à l'usager.
 *
 * `description` : le résumé court d'abord, le descriptif usager à défaut. Aucun
 * des deux n'est obligatoire au paramétrage — la collectivité qui n'a rempli
 * que le second doit tout de même avoir quelque chose à afficher.
 */
function toDemarche(raw: unknown): Demarche | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const name = text(row.name);
  if (id === null || name === null) return null;
  return {
    id,
    name,
    description: text(row.short_description) ?? text(row.user_description),
    estimatedMinutes:
      typeof row.input_duration_minutes === "number" && Number.isFinite(row.input_duration_minutes)
        ? row.input_duration_minutes
        : null,
  };
}

/**
 * Démarches publiées de la collectivité, dans l'ordre d'affichage qu'elle a
 * défini au Socle (le portail ne retrie pas : cet ordre est une décision de la
 * collectivité).
 *
 * `tenantId` vient TOUJOURS d'un `resolveTenant`, jamais du navigateur — qui
 * n'a aucun moyen d'en fournir un. Le Socle revérifie de son côté qu'il est
 * dans le périmètre de la clé.
 *
 * Une liste **vide** est un succès, pas une erreur : c'est une collectivité qui
 * n'a encore rien publié, et c'est à l'interface de le dire.
 */
export async function getPublicDemarches(
  tenantId: string,
  socle: SocleClient,
): Promise<DemarchesResult> {
  const reply = await socle.get(
    "/v1/portal/procedures?tenant_id=" + encodeURIComponent(tenantId),
  );
  switch (reply.kind) {
    case "not_found":
      // Le domaine résolvait il y a un instant : si la collectivité n'est plus
      // lisible, c'est qu'elle a quitté le périmètre entre les deux appels.
      // Distinct de `unknown_domain` — l'adresse, elle, était bonne.
      return { ok: false, reason: "tenant_unavailable" };
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "socle_unavailable" };
  }

  if (!Array.isArray(reply.body)) return { ok: false, reason: "socle_unavailable" };
  const demarches = reply.body
    .map(toDemarche)
    .filter((demarche): demarche is Demarche => demarche !== null);
  return { ok: true, demarches };
}
