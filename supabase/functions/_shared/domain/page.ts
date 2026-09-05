/**
 * La page d'accueil composée par la collectivité — modèle du PORTAIL.
 *
 * Le Socle sert la composition publiée (`GET /v1/portal/page`) ; ce type est
 * ce qu'il en reste une fois traduit dans le vocabulaire du portail, par
 * `socle/pageService.ts`. Deux règles de traduction, toutes deux voulues :
 *
 *   - **on ne garde que ce qu'on sait rendre.** Le Socle peut servir des
 *     sections que ce portail n'affiche pas encore (les actualités) ou n'aura
 *     jamais entendu parler (une section ajoutée après lui). Elles sont
 *     ignorées, pas rendues à moitié — une composition qui évolue au Socle ne
 *     casse pas le portail déployé.
 *   - **les références sont déjà résolues.** `shortcuts` et `pinned` ne
 *     contiennent que des identifiants de démarches publiées : le Socle a
 *     écarté les autres, le rendu n'a pas de cas mort à gérer.
 *
 * `page === null` n'est pas une erreur : la collectivité n'a encore rien
 * publié, et le portail rend sa mise en page par défaut.
 */

export type GridColumns = 2 | 3 | 4;

export interface RechercheSection {
  id: string;
  kind: "recherche";
  title: string;
  subtitle: string;
  placeholder: string;
  /** Démarches en raccourci sous le champ (`Demarche.id`). Vide = pas de raccourcis. */
  shortcuts: string[];
}

export interface DemarchesSection {
  id: string;
  kind: "demarches";
  title: string;
  columns: GridColumns;
  /** Les démarches à la une remontent en tête de grille. */
  pinnedFirst: boolean;
  /** Démarches à la une (`Demarche.id`). */
  pinned: string[];
}

export interface CompteSection {
  id: string;
  kind: "compte";
  title: string;
  subtitle: string;
}

export interface TexteSection {
  id: string;
  kind: "texte";
  title: string;
  body: string;
  align: "left" | "center";
}

export type FooterColumns = 1 | 2 | 3;

/**
 * Pied de page : pleine largeur, couleur de fond choisie, sous-blocs texte
 * répartis sur une à trois colonnes dans l'ordre. Rendu hors du conteneur
 * centré de la page.
 */
export interface FooterSection {
  id: string;
  kind: "footer";
  /** En-tête facultatif, souvent vide. */
  title: string;
  /** `#rrggbb` minuscule, validé à la traduction. */
  background: string;
  columns: FooterColumns;
  children: TexteSection[];
}

export type HomeSection =
  | RechercheSection
  | DemarchesSection
  | CompteSection
  | TexteSection
  | FooterSection;

export interface HomePage {
  /** Date de la publication servie (ISO 8601). */
  publishedAt: string;
  sections: HomeSection[];
}
