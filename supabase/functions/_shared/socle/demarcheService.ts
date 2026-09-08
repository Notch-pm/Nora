/**
 * Démarches publiques d'une collectivité.
 *
 * Le portail ne décide PAS ce qui est publié. Les quatre règles — paramétrage
 * en `production`, démarche `externe`, visibilité et période du bloc
 * communication, activation par au moins un organisme de l'arbre de la
 * collectivité — appartiennent au Socle, qui les applique dans
 * `GET /v1/portal/procedures` et dit, pour chaque démarche, quels organismes
 * la proposent. Les recopier ici les ferait diverger le jour où le paramétrage
 * évolue, et un portail qui diverge publie ce qui ne devait pas l'être.
 *
 * Même raison pour le choix de la route : `GET /v1/procedures` sert la
 * configuration INTÉGRALE d'une démarche (`form_schema`, `knowledge_base`,
 * `agent_description`, `requester_config`). Filtrer ces champs ici les aurait
 * déjà fait transiter par un serveur public. Ils ne quittent pas le Socle.
 *
 * Avec `tenantService`, ce fichier est le seul à connaître la forme des
 * réponses du Socle : il traduit vers le modèle du portail (`domain/demarche`).
 */
import type {
  Demarche,
  DemarcheCategory,
  DemarcheDetail,
  DemarcheOrganization,
} from "../domain/demarche.ts";
import type { Audience } from "../domain/requesterConfig.ts";
import type { PortalFailure } from "../domain/failure.ts";
import { parseFormSchema } from "../domain/formSchema.ts";
import { parseRequesterConfig } from "../domain/requesterConfig.ts";
import { localizedText } from "../domain/languages.ts";
import type { SocleClient } from "./socleClient.ts";

export type DemarchesResult =
  | { ok: true; demarches: Demarche[] }
  | { ok: false; reason: PortalFailure };

export type DemarcheResult =
  | { ok: true; demarche: DemarcheDetail }
  | { ok: false; reason: PortalFailure };

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Les organismes qui proposent la démarche, dans l'ordre où le Socle les sert
 * (celui de l'arbre). Une entrée sans identifiant ou sans nom est écartée —
 * une puce vide sur une carte ne nomme personne — et une liste absente vaut
 * « aucun » : le portail affiche la démarche, il ne décide pas qui la porte.
 */
function toOrganizations(raw: unknown): DemarcheOrganization[] {
  if (!Array.isArray(raw)) return [];
  const organizations: DemarcheOrganization[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const org = candidate as Record<string, unknown>;
    const id = text(org.id);
    const name = text(org.name);
    if (id !== null && name !== null) organizations.push({ id, name });
  }
  return organizations;
}

/** Les trois publics du Socle, dans l'ordre où le filtre les propose. */
const KNOWN_AUDIENCES: readonly Audience[] = ["citoyen", "entreprise", "association"];

/**
 * Les publics auxquels la démarche est ouverte. Un public que ce portail ne
 * connaît pas est écarté — même règle que pour les sections de page : on ne
 * rend pas à moitié ce qu'on ne sait pas nommer, et le Socle peut apprendre un
 * public avant ce portail.
 *
 * ⚠️ Une liste absente ou vide reste **vide**, jamais « tous publics » : la
 * démarche ne répond alors à aucun choix du filtre, ce qui est exactement ce
 * que veut dire « la collectivité n'a pas rempli ses publics ».
 */
function toAudiences(raw: unknown): Audience[] {
  if (!Array.isArray(raw)) return [];
  return KNOWN_AUDIENCES.filter((audience) => raw.includes(audience));
}

/**
 * Traduction d'une démarche du Socle vers le modèle du portail. Une entrée sans
 * identifiant ou sans intitulé est ÉCARTÉE plutôt que rendue vide : une carte
 * anonyme dans une liste de démarches n'apprend rien à l'usager.
 *
 * `description` : le résumé court d'abord, le descriptif usager à défaut. Aucun
 * des deux n'est obligatoire au paramétrage — la collectivité qui n'a rempli
 * que le second doit tout de même avoir quelque chose à afficher.
 *
 * ⚠️ LA LANGUE EST RÉSOLUE ICI, à la frontière, et pas dans les écrans : plus
 * loin, `name` est un intitulé à afficher, pas un français dont il faudrait
 * chercher la traduction. C'est ce qui fait que la recherche du portail
 * (`filterDemarchesByQuery`) cherche dans ce que l'usager LIT, sans une ligne
 * de plus. Le repli se fait champ par champ : un intitulé traduit sans son
 * résumé reste un intitulé traduit.
 */
function toDemarche(raw: unknown, lang: string): Demarche | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const name = localizedText(text(row.name), row.translations, lang, "name");
  if (id === null || name === null) return null;
  return {
    id,
    name,
    description: localizedText(text(row.short_description), row.translations, lang, "short_description")
      ?? localizedText(text(row.user_description), row.translations, lang, "user_description"),
    estimatedMinutes:
      typeof row.input_duration_minutes === "number" && Number.isFinite(row.input_duration_minutes)
        ? row.input_duration_minutes
        : null,
    organizations: toOrganizations(row.organizations),
    audiences: toAudiences(row.audiences),
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
  lang: string,
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
    .map((raw) => toDemarche(raw, lang))
    .filter((demarche): demarche is Demarche => demarche !== null);
  return { ok: true, demarches };
}

/** Catégorie de la démarche, ou `null`. Un libellé de plus, jamais bloquant. */
function toCategory(raw: unknown, lang: string): DemarcheCategory | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  const name = localizedText(text(row.name), row.translations, lang, "name");
  return id !== null && name !== null ? { id, name } : null;
}

/**
 * Une démarche PUBLIÉE, avec de quoi la remplir : le détail servi par
 * `GET /v1/portal/procedures/{id}`.
 *
 * Le Socle applique les mêmes quatre règles de publication que pour la liste,
 * et rend **404** pour tout le reste — démarche inconnue, en brouillon, hors
 * période, ou qu'aucun organisme n'active. Le portail n'a donc rien à
 * revérifier, et rien à révéler : `demarche_unavailable` dit « pas ici », pas
 * « existe mais fermée ».
 *
 * Les deux schémas sont parsés ICI, à la frontière : les écrans reçoivent un
 * `FormSchema` déjà nettoyé et un `RequesterConfig` complet, jamais du JSON
 * dont il faudrait douter.
 */
export async function getPublicDemarche(
  tenantId: string,
  demarcheId: string,
  socle: SocleClient,
  lang: string,
): Promise<DemarcheResult> {
  const reply = await socle.get(
    "/v1/portal/procedures/" +
      encodeURIComponent(demarcheId) +
      "?tenant_id=" +
      encodeURIComponent(tenantId),
  );
  switch (reply.kind) {
    case "not_found":
      return { ok: false, reason: "demarche_unavailable" };
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "socle_unavailable" };
  }

  const demarche = toDemarche(reply.body, lang);
  // Sans identifiant ni intitulé, il n'y a rien à afficher : c'est le même
  // écart que dans la liste, avec la même conséquence — la démarche n'existe
  // pas pour ce portail.
  if (demarche === null) return { ok: false, reason: "demarche_unavailable" };

  const row = reply.body as Record<string, unknown>;
  return {
    ok: true,
    demarche: {
      ...demarche,
      category: toCategory(row.category, lang),
      userDescription: localizedText(
        text(row.user_description),
        row.translations,
        lang,
        "user_description",
      ),
      form: parseFormSchema(row.form_schema),
      requester: parseRequesterConfig(row.requester_config),
    },
  };
}
