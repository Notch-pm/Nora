/**
 * Logique pure de la page d'accueil composée — testée sans DOM.
 *
 * Les composants de `sections/` restent minces : ils lisent une section et
 * l'affichent, mais l'ordre des démarches, le filtre de recherche et la
 * résolution des raccourcis vivent ici, pour être vérifiés sans rendu.
 */
import type { Demarche, DemarcheOrganization } from "@fn/_shared/domain/demarche.ts";
import type { FooterColumns, GridColumns } from "@fn/_shared/domain/page.ts";

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
 * Filtre par organisme : ne garde que les démarches que cet organisme
 * propose. `null` — aucun organisme choisi — ne filtre rien.
 */
export function filterDemarchesByOrganization(
  demarches: Demarche[],
  organizationId: string | null,
): Demarche[] {
  if (organizationId === null) return demarches;
  return demarches.filter((demarche) =>
    demarche.organizations.some((org) => org.id === organizationId),
  );
}

const organizationCollator = new Intl.Collator("fr", { sensitivity: "base" });

/**
 * Les organismes qui proposent au moins une démarche du catalogue,
 * dédoublonnés : la collectivité visitée d'abord, puis les autres par nom.
 * C'est la liste du filtre — un organisme qui ne propose rien n'y figure pas,
 * l'usager n'y choisirait que du vide.
 */
export function organizationsOffering(
  demarches: Demarche[],
  tenantId: string,
): DemarcheOrganization[] {
  const byId = new Map<string, DemarcheOrganization>();
  for (const demarche of demarches) {
    for (const org of demarche.organizations) {
      if (!byId.has(org.id)) byId.set(org.id, org);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.id === tenantId) return -1;
    if (b.id === tenantId) return 1;
    return organizationCollator.compare(a.name, b.name);
  });
}

/**
 * Ce que dit une grille vide. La recherche prime : c'est le geste le plus
 * récent de l'usager, et c'est lui qu'il faut lui rendre. Puis l'organisme
 * choisi ; sinon, rien n'est publié — et ce n'est pas une erreur.
 */
export function emptyDemarchesKey(
  searchActive: boolean,
  organizationId: string | null,
): "empty.search" | "empty.organization" | "empty.none" {
  if (searchActive) return "empty.search";
  if (organizationId !== null) return "empty.organization";
  return "empty.none";
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

/**
 * Classes de grille d'un pied de page : une colonne sur mobile, puis les
 * colonnes choisies. Table littérale — Tailwind ne compile que les classes
 * qu'il lit telles quelles.
 */
const FOOTER_COLUMNS_CLASS: Record<FooterColumns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

export function footerColumnsClass(columns: FooterColumns): string {
  return FOOTER_COLUMNS_CLASS[columns];
}

/**
 * La page se termine-t-elle par un pied de page ? Alors il EST le bas de la
 * page : collé au bord, aucune marge sous lui.
 */
export function endsWithFooter(sections: { kind: string }[]): boolean {
  return sections[sections.length - 1]?.kind === "footer";
}

/**
 * Le texte se lit-il en clair sur ce fond ? Luminance relative (sRGB, WCAG) :
 * sous 0,4 le fond est sombre. Une couleur illisible est traitée comme sombre
 * — le défaut du pied de page l'est.
 */
export function isDarkColor(hex: string): boolean {
  if (!/^#[0-9a-f]{6}$/.test(hex)) return true;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance < 0.4;
}
