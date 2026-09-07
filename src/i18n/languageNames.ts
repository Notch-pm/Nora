/**
 * Le nom d'une langue, ÉCRIT DANS CETTE LANGUE.
 *
 * ⚠️ C'est tout l'enjeu de ce fichier, et la raison pour laquelle on n'utilise
 * pas le catalogue du Socle : il nomme les langues **en français** (« Anglais »,
 * « Arabe »), ce qui est juste pour un agent qui paramètre, et inutile pour la
 * personne à qui l'on propose de changer de langue. Quelqu'un qui ne lit pas le
 * français cherche « English », « العربية », « brezhoneg » — pas leur traduction.
 *
 * `Intl.DisplayNames` couvre les langues mondiales sans table à tenir. Les
 * langues régionales de France en sont largement absentes : elles ont leur
 * table ici, courte et explicite. Repli sur le code lui-même, jamais sur du
 * français : un code est au moins neutre.
 */

/**
 * Les langues de France, dans leur propre nom. Codes du catalogue du Socle
 * (`src/features/languages/languages.ts`) — ISO 639-1 quand il existe, 639-3
 * sinon.
 */
const FRANCE_ENDONYMS: Record<string, string> = {
  br: "brezhoneg",
  co: "corsu",
  eu: "euskara",
  ca: "català",
  oc: "occitan",
  gsw: "Elsàssisch",
  frp: "arpetan",
  nrf: "Nouormand",
  pcd: "Picard",
  gcf: "kréyòl gwadloupéyen",
  gcr: "kriyòl gwiyannen",
  rcf: "kréol rénioné",
  swb: "shimaore",
  mfv: "bushi",
  dhv: "drehu",
  nen: "nengone",
  ty: "reo tahiti",
  aji: "ajië",
  ht: "kreyòl ayisyen",
};

/**
 * Le nom de la langue tel que ses locuteurs l'écrivent.
 *
 * Trois sources, dans l'ordre : le navigateur (qui connaît les langues
 * mondiales et se met à jour tout seul), la table des langues de France, puis
 * le code brut. Un navigateur qui ne connaît pas un code rend souvent le code
 * lui-même — c'est ce qu'on détecte pour passer à la table.
 */
export function languageName(code: string): string {
  const normalized = code.trim().toLowerCase();
  if (normalized === "") return code;
  try {
    const display = new Intl.DisplayNames([normalized], { type: "language" }).of(normalized);
    if (display && display.toLowerCase() !== normalized) return display;
  } catch {
    // Code que le navigateur refuse : la table prend le relais.
  }
  return FRANCE_ENDONYMS[normalized] ?? normalized;
}
