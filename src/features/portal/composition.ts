/**
 * Logique pure de la page d'accueil composée — testée sans DOM.
 *
 * Les composants de `sections/` restent minces : ils lisent une section et
 * l'affichent, mais l'ordre des démarches, le filtre de recherche et la
 * résolution des raccourcis vivent ici, pour être vérifiés sans rendu.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { GridColumns } from "@fn/_shared/domain/page.ts";

/**
 * Le Socle limite déjà les raccourcis à ce nombre au moment de la
 * publication ; l'affichage le respecte aussi, en filet de sécurité.
 */
export const MAX_SHORTCUTS = 4;

/**
 * Normalise un texte pour une comparaison de recherche : minuscules et sans
 * diacritiques, si bien que « éclairage » et « ECLAIRAGE » se retrouvent.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Filtre des démarches par nom et description, insensible à la casse et aux
 * accents. Une requête vide ne filtre rien — c'est l'état initial du champ.
 */
export function filterDemarchesByQuery(demarches: Demarche[], query: string): Demarche[] {
  const needle = normalizeSearchText(query);
  if (needle === "") return demarches;
  return demarches.filter((demarche) => {
    const haystack = normalizeSearchText(`${demarche.name} ${demarche.description ?? ""}`);
    return haystack.includes(needle);
  });
}

/**
 * Ordonne les démarches d'une section « démarches » : épinglées en tête si
 * `pinnedFirst`, sinon l'ordre reçu (celui publié par le Socle) est conservé
 * tel quel.
 */
export function orderDemarchesForSection(
  demarches: Demarche[],
  pinned: string[],
  pinnedFirst: boolean,
): Demarche[] {
  if (!pinnedFirst) return demarches;
  const pinnedSet = new Set(pinned);
  return [...demarches].sort((a, b) => Number(pinnedSet.has(b.id)) - Number(pinnedSet.has(a.id)));
}

/**
 * Résout des ids de raccourcis vers les démarches correspondantes. Un id
 * absent du catalogue (démarche dépubliée depuis la composition) est écarté
 * silencieusement — ce n'est pas une erreur de rendu, `page.ts` documente déjà
 * que ces références sont résolues côté Socle au moment de la publication,
 * mais le catalogue reçu ici peut avoir bougé depuis.
 */
export function resolveShortcuts(shortcuts: string[], demarches: Demarche[]): Demarche[] {
  const byId = new Map(demarches.map((demarche) => [demarche.id, demarche]));
  const resolved: Demarche[] = [];
  for (const id of shortcuts) {
    const demarche = byId.get(id);
    if (demarche) resolved.push(demarche);
  }
  return resolved.slice(0, MAX_SHORTCUTS);
}

/**
 * Classe de grille par nombre de colonnes : 1 colonne sous `sm`, 2 jusqu'à
 * `lg`, `columns` au-delà. Tailwind ne compile que les classes présentes
 * littéralement dans les sources — d'où cette table plutôt qu'un gabarit
 * construit par interpolation.
 */
const LG_COLUMNS_CLASS: Record<GridColumns, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

export function gridColumnsClass(columns: GridColumns): string {
  return `grid-cols-1 sm:grid-cols-2 ${LG_COLUMNS_CLASS[columns]}`;
}
