/**
 * Logique pure de la page d'accueil composée — testée sans DOM.
 *
 * Les composants de `sections/` restent minces : ils lisent une section et
 * l'affichent, mais l'ordre des démarches, le filtre de recherche et la
 * résolution des raccourcis vivent ici, pour être vérifiés sans rendu.
 */
import {
  type Demarche,
  demarchesOfOrganization,
  type DemarcheOrganization,
} from "@fn/_shared/domain/demarche.ts";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
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
  // ⚠️ Le filtrage lui-même vit dans le domaine (`demarchesOfOrganization`), et
  // pas ici : le serveur en a besoin pour servir la page d'un organisme, et
  // deux définitions du même « appartient à cet organisme » divergeraient au
  // premier cas limite — sans que personne ne le voie, puisque les deux listes
  // ne s'affichent jamais côte à côte. Ce qui reste ici est propre au filtre :
  // « aucun organisme choisi » ne filtre rien.
  if (organizationId === null) return demarches;
  return demarchesOfOrganization(demarches, organizationId);
}

/**
 * Filtre par public : ne garde que les démarches ouvertes à ce public. `null` —
 * « peu importe » — ne filtre rien.
 *
 * ⚠️ Une démarche **sans public déclaré** ne passe AUCUN choix. C'est voulu :
 * la collectivité n'a pas dit à qui elle s'adresse, et la faire apparaître
 * partout la proposerait à des usagers auxquels elle n'est pas ouverte. Elle
 * reste visible tant qu'on ne filtre pas — c'est là qu'on la voit, et c'est au
 * Socle que ça se corrige.
 */
export function filterDemarchesByAudience(
  demarches: Demarche[],
  audience: Audience | null,
): Demarche[] {
  if (audience === null) return demarches;
  return demarches.filter((demarche) => demarche.audiences.includes(audience));
}

/** Les trois publics, dans l'ordre où le filtre les propose. */
const AUDIENCE_ORDER: readonly Audience[] = ["citoyen", "entreprise", "association"];

/**
 * Les publics visés par au moins une démarche du catalogue, dans l'ordre
 * ci-dessus. C'est la liste du filtre — proposer « Entreprise » quand aucune
 * démarche ne s'y adresse ne mènerait qu'à une liste vide, exactement comme un
 * organisme qui ne propose rien.
 */
export function audiencesOffered(demarches: Demarche[]): Audience[] {
  const present = new Set(demarches.flatMap((demarche) => demarche.audiences));
  return AUDIENCE_ORDER.filter((audience) => present.has(audience));
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
 * récent de l'usager, et c'est lui qu'il faut lui rendre.
 *
 * ⚠️ Avec DEUX filtres posés, on ne nomme ni l'un ni l'autre : dire « cet
 * organisme ne propose rien » alors qu'un public est aussi choisi désignerait
 * un coupable au hasard, et enverrait l'usager défaire le mauvais filtre.
 * Sinon, rien n'est publié — et ce n'est pas une erreur.
 */
export function emptyDemarchesKey(
  searchActive: boolean,
  organizationId: string | null,
  audience: Audience | null = null,
): "empty.search" | "empty.filters" | "empty.organization" | "empty.audience" | "empty.none" {
  if (searchActive) return "empty.search";
  if (organizationId !== null && audience !== null) return "empty.filters";
  if (organizationId !== null) return "empty.organization";
  if (audience !== null) return "empty.audience";
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
 * Le texte se lit-il en clair sur ce fond ? Le pied de page composé le demande
 * ici, avec le reste de la composition.
 *
 * ⚠️ PLUS DE COPIE LOCALE. Ce fichier en avait une, au même seuil faux que
 * `themeStyle.ts` (0,4 — voir `readableInk`) : deux implémentations, c'était
 * deux corrections à ne pas oublier. Il n'y en a plus qu'une.
 */
export { isDarkColor } from "./themeStyle.ts";

/**
 * Au-delà de ce nombre d'organismes, une dalle annonce un COMPTE plutôt que la
 * liste des noms.
 */
export const MAX_ORGANIZATION_CHIPS = 3;

/**
 * Ce qu'une dalle de démarche affiche des organismes qui la proposent : leurs
 * noms, ou leur nombre.
 *
 * ⚠️ AU-DELÀ DE TROIS, C'EST LE NOMBRE QUI RENSEIGNE, pas la liste : quatre
 * noms de communes sur une carte de trois lignes se font tronquer
 * (« Mairie de Saint Martin de Cr… »), et une liste illisible informe moins
 * qu'un chiffre. L'usager qui cherche sa commune a le filtre de l'accueil et
 * le menu « Ma ville » pour cela ; la dalle, elle, dit seulement à quelle
 * échelle la démarche est proposée.
 *
 * Le seuil vaut pour TOUT le portail — la grille de la page composée, la liste
 * de repli, la page d'un organisme : une démarche se présente de la même façon
 * partout.
 */
export function organizationChips(
  organizations: DemarcheOrganization[],
): { kind: "noms"; organizations: DemarcheOrganization[] } | { kind: "compte"; count: number } {
  return organizations.length > MAX_ORGANIZATION_CHIPS
    ? { kind: "compte", count: organizations.length }
    : { kind: "noms", organizations };
}

/**
 * La page commence-t-elle par un bandeau pleine largeur ? Alors il EST le haut
 * de la page : collé à l'en-tête, aucune marge entre les deux.
 *
 * Symétrique d'`endsWithFooter`, et pour la même raison : un fond qui va d'un
 * bord à l'autre de l'écran mais s'arrête à trois pixels sous la barre de
 * navigation ne ressemble à rien — on voit la bande de page qui reste.
 */
export function startsWithFullWidthBanner(
  sections: { kind: string; imageUrl?: string | null; imageFullWidth?: boolean }[],
): boolean {
  const first = sections[0];
  return first !== undefined && first.kind === "recherche" &&
    (first.imageUrl ?? null) !== null && first.imageFullWidth === true;
}
