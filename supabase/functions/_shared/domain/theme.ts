/**
 * Le thème du site — modèle du PORTAIL.
 *
 * La collectivité règle l'apparence de son portail dans l'éditeur du Socle :
 * typographie, formes, densité, en-tête, accessibilité. Le Socle l'enregistre
 * et le publie ; ce fichier dit ce que le portail en retient.
 *
 * Défini ici plutôt que recopié du DTO du Socle, comme `Tenant` et `Demarche` :
 * le portail doit survivre à un renommage de champ ou à un contrat qui évolue.
 * `socle/tenantService.ts` est le seul endroit qui connaisse la forme de la
 * réponse ; tout le reste ne voit que ce type — en **camelCase**, le
 * vocabulaire du portail, quand le contrat parle snake_case.
 *
 * ⚠️ **AUCUNE COULEUR ICI.** Elles viennent de la charte graphique
 * (`domain/branding.ts`, `--brand-primary` / `--brand-secondary`). Le thème dit
 * COMMENT peindre, la charte dit AVEC QUOI. La seule chose qui les relie est
 * `darkPrimary` : il fonce la couleur de la charte **au rendu**, il ne la
 * remplace pas.
 *
 * ⚠️ **Le thème n'est jamais absent.** Un Socle d'avant le contrat 1.17.0, une
 * collectivité qui n'a rien publié, une réponse abîmée : tous donnent le thème
 * par DÉFAUT, jamais `null`. Un portail sans thème n'aurait rien à peindre, et
 * chaque composant porterait un cas d'absence qu'il finirait par oublier.
 *
 * Module PUR : pas de Deno, pas de réseau. Miroir volontaire de
 * `Socle/src/features/portal/portalTheme.ts` et de son
 * `public-api/_shared/portalTheme.ts` — même motif que `formSchema.ts` et
 * `languages.ts`, et testé des deux côtés.
 */

/**
 * Les polices que la collectivité peut choisir.
 *
 * ⚠️ Ce sont des **identifiants**, pas des familles CSS : `fontStack()` les
 * traduit. Le catalogue est court et fermé parce que le portail SERT ces
 * polices — voir `public/fonts/fonts.css`.
 */
export const FONTS = ["systeme", "nunito-sans", "rubik", "public-sans"] as const;
export type FontId = (typeof FONTS)[number];

export const TEXT_SCALES = ["compact", "standard", "comfortable"] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

export const RADIUS_SCALES = ["square", "soft", "round"] as const;
export type RadiusScale = (typeof RADIUS_SCALES)[number];

export const SHADOW_SCALES = ["none", "soft", "strong"] as const;
export type ShadowScale = (typeof SHADOW_SCALES)[number];

export const DENSITIES = ["compact", "standard", "airy"] as const;
export type Density = (typeof DENSITIES)[number];

export const HEADER_FILLS = ["white", "color"] as const;
export type HeaderFill = (typeof HEADER_FILLS)[number];

export const HEADER_COLORS = ["primary", "secondary"] as const;
export type HeaderColor = (typeof HEADER_COLORS)[number];

export const LOGO_POSITIONS = ["left", "center"] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export const MENU_STYLES = ["text", "pills"] as const;
export type MenuStyle = (typeof MENU_STYLES)[number];

export const ACCOUNT_STYLES = ["prominent", "discreet"] as const;
export type AccountStyle = (typeof ACCOUNT_STYLES)[number];

/** Une déclaration d'accessibilité tient en une phrase. */
const MAX_DECLARATION_LENGTH = 300;

export interface PortalTheme {
  typography: { font: FontId; textScale: TextScale };
  shapes: { radius: RadiusScale; shadow: ShadowScale; density: Density };
  header: {
    fill: HeaderFill;
    /** Laquelle des deux couleurs de la charte remplit le bandeau. */
    color: HeaderColor;
    /** Utiliser le logo blanc de la charte, sur un bandeau coloré. */
    logoWhite: boolean;
    logo: LogoPosition;
    menu: MenuStyle;
    /** Le bandeau suit-il le défilement de la page ? */
    sticky: boolean;
    account: AccountStyle;
  };
  accessibility: {
    highContrast: boolean;
    /** Foncer la couleur principale de la charte, au rendu seulement. */
    darkPrimary: boolean;
    /**
     * Mention d'accessibilité **obligatoire (RGAA)** d'un site public, affichée
     * au pied des pages. Chaîne vide = la collectivité ne l'a pas encore
     * écrite ; le portail n'invente rien à sa place.
     */
    declaration: string;
  };
}

/** Le thème d'une collectivité qui n'a rien réglé — les défauts du Socle. */
export function defaultTheme(): PortalTheme {
  return {
    typography: { font: "nunito-sans", textScale: "standard" },
    shapes: { radius: "soft", shadow: "soft", density: "standard" },
    header: {
      fill: "white",
      color: "primary",
      logoWhite: true,
      logo: "left",
      menu: "text",
      sticky: true,
      account: "prominent",
    },
    accessibility: { highContrast: false, darkPrimary: false, declaration: "" },
  };
}

function block(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Le thème servi par le Socle, lu avec tolérance.
 *
 * ⚠️ **CHAQUE CHAMP EST INDÉPENDANT.** Une valeur inconnue — un réglage ajouté
 * par un Socle plus récent, une réponse abîmée — retombe sur SON défaut et
 * n'emporte jamais ses voisines. Un thème à demi lisible reste le thème que la
 * collectivité a réglé, moins le réglage qu'on ne sait pas lire.
 */
export function parseTheme(value: unknown): PortalTheme {
  const fallback = defaultTheme();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fallback;

  const raw = value as Record<string, unknown>;
  const typography = block(raw.typography);
  const shapes = block(raw.shapes);
  const header = block(raw.header);
  const accessibility = block(raw.accessibility);
  const declaration = accessibility.declaration;

  return {
    typography: {
      font: oneOf(typography.font, FONTS, fallback.typography.font),
      // Le contrat dit `text_scale`, le portail dit `textScale` : la traduction
      // se fait ici, et nulle part ailleurs.
      textScale: oneOf(typography.text_scale, TEXT_SCALES, fallback.typography.textScale),
    },
    shapes: {
      radius: oneOf(shapes.radius, RADIUS_SCALES, fallback.shapes.radius),
      shadow: oneOf(shapes.shadow, SHADOW_SCALES, fallback.shapes.shadow),
      density: oneOf(shapes.density, DENSITIES, fallback.shapes.density),
    },
    header: {
      fill: oneOf(header.fill, HEADER_FILLS, fallback.header.fill),
      color: oneOf(header.color, HEADER_COLORS, fallback.header.color),
      logoWhite: bool(header.logo_white, fallback.header.logoWhite),
      logo: oneOf(header.logo, LOGO_POSITIONS, fallback.header.logo),
      menu: oneOf(header.menu, MENU_STYLES, fallback.header.menu),
      sticky: bool(header.sticky, fallback.header.sticky),
      account: oneOf(header.account, ACCOUNT_STYLES, fallback.header.account),
    },
    accessibility: {
      highContrast: bool(accessibility.high_contrast, fallback.accessibility.highContrast),
      darkPrimary: bool(accessibility.dark_primary, fallback.accessibility.darkPrimary),
      declaration:
        typeof declaration === "string" && declaration.trim().length <= MAX_DECLARATION_LENGTH
          ? declaration.trim()
          : "",
    },
  };
}

/**
 * La pile CSS d'une police du catalogue.
 *
 * ⚠️ Toutes se terminent par un repli générique : une police web qui n'arrive
 * pas — réseau lent, fichier absent — laisse la page lisible plutôt qu'au
 * choix du navigateur. Les familles nommées ici sont exactement celles que
 * `public/fonts/fonts.css` déclare.
 */
export function fontStack(font: FontId): string {
  switch (font) {
    case "systeme":
      return "system-ui, -apple-system, 'Segoe UI', sans-serif";
    case "rubik":
      return "'Rubik', system-ui, sans-serif";
    case "public-sans":
      return "'Public Sans', system-ui, sans-serif";
    case "nunito-sans":
      return "'Nunito Sans', system-ui, sans-serif";
  }
}
