/**
 * Adresse assistée — la logique PURE (ni DOM ni réseau), testée.
 *
 * Le référentiel est la Base Adresse Nationale, servie par la Géoplateforme
 * (IGN) : publique, sans clé ni compte. Même service et même lecture tolérante
 * qu'Iris (`src/lib/adresse.ts`), réduits à ce que le portail consomme : une
 * ligne à proposer pendant la frappe. Ni coordonnées, ni code INSEE, ni score :
 * le portail n'en ferait rien, et ce qu'on ne lit pas ne peut pas fuir.
 *
 * ⚠️ L'appel part DU NAVIGATEUR de l'usager (décision du 2026-09-22) : c'est
 * le seul appel de l'écran hors de `portal-api`. Ce qui transite : le fragment
 * d'adresse tapé dès trois caractères, et l'adresse IP du visiteur — comme
 * pour tout site qui interroge ce service. Jamais un nom, jamais une démarche.
 * Rien de la réponse n'est gardé : seule la ligne choisie (ou tapée) part
 * avec la demande, dans la clé `adresse` du Socle.
 */

/** `api-adresse.data.gouv.fr` a été décommissionné début 2026 : c'est ici que la BAN se sert. */
export const DEFAULT_GEOCODE_URL = "https://data.geopf.fr/geocodage/search/";

/** En deçà, la BAN rend du bruit : on ne l'interroge pas. */
export const MIN_QUERY_LENGTH = 3;
/** Au-delà, la liste ne se lit plus d'un coup d'œil. */
export const SUGGESTION_LIMIT = 5;
/** Le délai entre la dernière touche et la requête : une frappe fluide ne fait pas une requête par lettre. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * La finesse d'une proposition, du plus précis au plus large. La BAN propose
 * aussi des voies et des communes seules : l'usager doit le voir avant de
 * choisir « Nantes » en croyant avoir donné son adresse.
 */
export type AddressPrecision = "adresse" | "voie" | "lieu_dit" | "commune";

export interface AddressSuggestion {
  /** Identifiant BAN — clé de liste, jamais stockée. */
  id: string;
  /** L'adresse complète telle que la BAN l'écrit : « 10 Avenue de Frémeur 44000 Nantes ». C'est elle qui est retenue. */
  label: string;
  /** La voie seule : « 10 Avenue de Frémeur », ou le nom de la commune sur une commune seule. */
  name: string;
  postcode: string;
  city: string;
  /** « 44, Loire-Atlantique, Pays de la Loire ». */
  context: string;
  precision: AddressPrecision;
}

/**
 * Le service à interroger : celui de la Géoplateforme, sauf substitution par
 * `VITE_GEOCODE_URL` (recette, ou service remplacé un jour). Une valeur vide
 * vaut absence.
 */
export function geocodeUrl(env: { VITE_GEOCODE_URL?: string } = import.meta.env): string {
  const raw = env.VITE_GEOCODE_URL;
  return raw === undefined || raw.trim() === "" ? DEFAULT_GEOCODE_URL : raw.trim();
}

// ---- URL --------------------------------------------------------------------

/** Recherche pendant la frappe — `null` si la saisie est trop courte pour être posée. */
export function addressSearchUrl(query: string, base: string): string | null {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    // Une base mal configurée ne doit pas jeter au premier caractère tapé :
    // sans URL, pas de requête, et la saisie libre reste entière.
    return null;
  }
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(SUGGESTION_LIMIT));
  // La saisie est en cours : la BAN doit compléter, pas résoudre.
  url.searchParams.set("autocomplete", "1");
  return url.toString();
}

// ---- Lecture de la réponse --------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Le `type` BAN, traduit en finesse ; l'inconnu vers la plus large, pour ne jamais surestimer. */
export function precisionOf(type: unknown): AddressPrecision {
  switch (type) {
    case "housenumber":
      return "adresse";
    case "street":
      return "voie";
    case "locality":
      return "lieu_dit";
    default:
      return "commune";
  }
}

/**
 * Lecture TOLÉRANTE du GeoJSON BAN : les champs inconnus sont ignorés, une
 * entrée illisible est sautée, une réponse informe rend une liste vide. Jamais
 * d'exception — l'assistance est un confort, sa panne ne doit pas empêcher de
 * saisir.
 */
export function parseAddressSuggestions(raw: unknown): AddressSuggestion[] {
  if (!isRecord(raw) || !Array.isArray(raw.features)) return [];
  const out: AddressSuggestion[] = [];
  for (const feature of raw.features) {
    if (!isRecord(feature)) continue;
    const p = isRecord(feature.properties) ? feature.properties : {};
    const label = text(p.label);
    if (label === "") continue; // sans libellé, la proposition n'est pas choisissable
    out.push({
      id: text(p.id) || label,
      label,
      name: text(p.name) || label,
      postcode: text(p.postcode),
      city: text(p.city),
      context: text(p.context),
      precision: precisionOf(p.type),
    });
  }
  return out;
}

/** Seconde ligne d'une proposition : le contexte départemental, à défaut la commune. */
export function suggestionContext(s: AddressSuggestion): string {
  return s.context || [s.postcode, s.city].filter((v) => v !== "").join(" ");
}
