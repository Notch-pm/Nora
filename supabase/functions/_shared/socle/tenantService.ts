/**
 * Résolution du tenant — `hostname → collectivité`.
 *
 * C'est LA frontière du portail multi-tenant. En dehors de ce fichier, rien
 * dans l'application ne sait qu'un domaine existe : le reste manipule un
 * `Tenant` déjà résolu. Ajouter une collectivité ne touche donc aucun code —
 * c'est une ligne dans les domaines du Socle.
 *
 * Le portail ne décide RIEN : il met le nom d'hôte en forme et demande au Socle
 * à qui il appartient. Un identifiant de tenant ne peut pas ENTRER par le
 * navigateur ; il ne peut que SORTIR d'ici.
 *
 * Ce fichier est aussi le seul, avec `demarcheService`, à connaître la forme
 * des réponses du Socle. Il traduit vers le modèle du portail (`domain/tenant`).
 */
import { parseAssistant } from "../domain/assistant.ts";
import type { Tenant } from "../domain/tenant.ts";
import type { PortalFailure } from "../domain/failure.ts";
import { parseLanguages } from "../domain/languages.ts";
import { parseTheme } from "../domain/theme.ts";
import { normalizeHostname } from "../http/hostname.ts";
import type { SocleClient } from "./socleClient.ts";

export type TenantResolution =
  | { ok: true; tenant: Tenant }
  | { ok: false; reason: PortalFailure };

/**
 * Lecture DÉFENSIVE de la réponse. Un tenant sans identifiant ou sans nom n'est
 * pas affichable : le rendre à moitié produirait une page au titre vide, là où
 * un message d'indisponibilité dit la vérité.
 */
function toTenant(body: unknown, hostname: string): Tenant | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (typeof raw.name !== "string" || raw.name === "") return null;
  return {
    id: raw.id,
    name: raw.name,
    slug: typeof raw.slug === "string" && raw.slug !== "" ? raw.slug : null,
    // Le domaine servi par le Socle fait foi ; le nôtre n'était qu'une entrée.
    hostname: typeof raw.hostname === "string" && raw.hostname !== "" ? raw.hostname : hostname,
    // Les langues de la collectivité (héritage déjà résolu par le Socle). Un
    // Socle d'avant le contrat 1.11.0, ou une réponse abîmée, rendent `["fr"]` :
    // un portail monolingue, jamais un portail sans langue.
    languages: parseLanguages(raw.languages),
    // Le thème du site (contrat 1.17.0). Un Socle plus ancien ne sert pas ce
    // champ : `parseTheme` rend alors les défauts, jamais `null` — le portail
    // a toujours de quoi peindre.
    theme: parseTheme(raw.theme),
    // L'assistant du portail (contrat 1.28.0). Un Socle plus ancien ne sert pas
    // ce champ : `parseAssistant` rend alors un assistant FERMÉ — au doute, le
    // portail ne dépense pas le crédit IA d'une collectivité.
    assistant: parseAssistant(raw.assistant),
  };
}

/**
 * Quelle collectivité se trouve derrière ce nom d'hôte ?
 *
 * `rawHostname` est une donnée non fiable : elle est normalisée, puis
 * simplement présentée au Socle. Un domaine inconnu ne résout rien — c'est le
 * seul verrou, et il est du bon côté.
 */
export async function resolveTenant(
  rawHostname: string | null | undefined,
  socle: SocleClient,
): Promise<TenantResolution> {
  const hostname = normalizeHostname(rawHostname);
  if (hostname === null) return { ok: false, reason: "invalid_hostname" };

  const reply = await socle.get("/v1/portal/tenant?hostname=" + encodeURIComponent(hostname));
  switch (reply.kind) {
    case "not_found":
      // Le Socle répond le même 404 pour « domaine inconnu », « hors périmètre
      // de la clé » et « collectivité obsolète » : il ne renseigne pas sur
      // l'existence des collectivités de son référentiel. Le portail hérite de
      // cette discrétion, et n'a de toute façon rien de plus à dire au
      // visiteur, dont l'adresse ne mène nulle part.
      return { ok: false, reason: "unknown_domain" };
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "socle_unavailable" };
  }

  const tenant = toTenant(reply.body, hostname);
  if (tenant === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, tenant };
}
