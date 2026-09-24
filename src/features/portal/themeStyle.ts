/**
 * Du thème aux pixels : la palette dérivée et les variables CSS de la page.
 *
 * ⚠️ **C'EST LE POINT DE PERFORMANCE.** Le thème ne descend pas en props dans
 * les composants : il produit **un seul objet de style** posé sur la racine de
 * la page, et tout le portail lit des variables CSS. Un thème entier tient
 * ainsi en quelques centaines d'octets, sans une requête de plus — la seule
 * exception étant la POLICE, servie depuis `public/fonts/`.
 *
 * ⚠️ **Les couleurs viennent de la CHARTE de la collectivité**, jamais du thème
 * (`domain/theme.ts` n'en porte aucune). Ce fichier en dérive tout le reste —
 * teintes douces, encres lisibles, bandeau — pour qu'une collectivité n'ait à
 * choisir que deux couleurs et les retrouve partout, cohérentes.
 *
 * ⚠️ **Miroir volontaire** de `Socle/src/features/portal/themeStyle.ts` : les
 * mêmes facteurs, les mêmes encres, les mêmes noms de variables. C'est ce qui
 * fait que l'aperçu de l'éditeur ressemble au site — s'ils divergent, c'est
 * l'éditeur qui ment, et personne ne s'en aperçoit avant la publication. Testé
 * des deux côtés.
 */
import type { CSSProperties } from "react";
import { fontStack, type PortalTheme } from "@fn/_shared/domain/theme.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";

// ── Les échelles ────────────────────────────────────────────────────────────

const SCALE_FACTOR = { compact: 0.92, standard: 1, comfortable: 1.12 } as const;
const DENSITY_FACTOR = { compact: 0.78, standard: 1, airy: 1.28 } as const;
const RADIUS_PX = { square: 2, soft: 10, round: 18 } as const;

const SHADOW_CSS = {
  none: "none",
  soft: "0 1px 2px 0 hsl(220 20% 10% / 0.05)",
  strong: "0 8px 24px -4px hsl(220 20% 10% / 0.12)",
} as const;

/** Tailles de texte de référence, en pixels, avant échelle. */
const TYPE_SCALE = { h1: 30, h2: 19, body: 14, small: 12, tiny: 11 } as const;

/** Espacements de référence, en pixels, avant densité. */
const SPACING = { gap: 22, pad: 20, cardPad: 14 } as const;

/**
 * Les neutres du portail, en deux jeux : l'ordinaire, et celui du contraste
 * renforcé. Ce sont les seules couleurs FIGÉES du rendu — un gris de texte
 * n'appartient pas à la charte d'une collectivité, il appartient à la
 * lisibilité.
 *
 * ⚠️ DEUX BORDURES, ET LA DIFFÉRENCE EST RÉGLEMENTAIRE. `border` dessine les
 * cartes et les séparateurs : décoratifs, le RGAA ne leur demande rien.
 * `fieldBorder` est le contour d'un champ de saisie — c'est lui qui dit « ici,
 * on écrit » — et il doit tenir 3 : 1 (RGAA 3.3) : 3,56 sur blanc, 3,21 sur
 * l'aplat neutre ; 4,44 en contraste renforcé. Le relevé du 2026-09-15 a
 * trouvé les champs dessinés avec `border`, à 1,24 : 1.
 */
const NEUTRALS = {
  normal: {
    ink: "#1c2220",
    muted: "#5c6663",
    border: "#e4e7e6",
    fieldBorder: "#808a87",
    surface: "#f1f4f3",
  },
  contrast: {
    ink: "#0d1210",
    muted: "#3d4844",
    border: "#acb9b5",
    fieldBorder: "#6f7a77",
    surface: "#e6ebe9",
  },
} as const;

/**
 * Le vert de la gamme et son jaune, faute de charte.
 *
 * ⚠️ LE VERT A ÉTÉ FONCÉ LE 2026-09-18 (`#089b59` → `#07854c`), sur décision
 * produit. L'ancien donnait 3,59 : 1 en texte sur blanc et 4,498 au mieux sur
 * un bouton : une collectivité sans charte publiée était servie hors
 * conformité RGAA par défaut. Le nouveau tient 4,70 : 1 dans les deux cas —
 * le plus petit pas qui passe. Mêmes valeurs au Socle.
 */
export const DEFAULT_PRIMARY = "#07854c";
export const DEFAULT_SECONDARY = "#ffcd57";

const WHITE = "#ffffff";
const HEX_COLOR = /^#[0-9a-f]{6}$/;

// ── Arithmétique des couleurs ───────────────────────────────────────────────
//
// ⚠️ On lit `#rrggbb` minuscule, et rien d'autre : la frontière du portail
// (`brandingService`) ne laisse passer que cette forme. Une couleur qu'on ne
// sait pas lire n'est pas devinée — elle vaut absente.

function channels(hex: string): [number, number, number] | null {
  if (!HEX_COLOR.test(hex)) return null;
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/** Luminance relative (sRGB, WCAG), ou `null` si la couleur est illisible. */
export function relativeLuminance(hex: string): number | null {
  const rgb = channels(hex);
  if (rgb === null) return null;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** Rapport de contraste WCAG, de 1 à 21, ou `null` si l'une des couleurs est illisible. */
function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * L'encre qui se lit sur ce fond : le blanc, ou l'encre sombre proposée —
 * **celle des deux qui contraste le plus**. À égalité, le blanc.
 *
 * ⚠️ LE CHOIX SE FAISAIT SUR UN SEUIL DE LUMINANCE FIXE, 0,4, ET IL ÉTAIT FAUX
 * (relevé RGAA du 2026-09-15). Le vrai point de bascule entre le blanc et
 * l'encre du portail est vers 0,21 : entre les deux, le blanc perdait. Un
 * orange `#e07b39` recevait du blanc à 2,97 : 1 là où l'encre sombre passe à
 * 5,44 ; un turquoise `#00a3a3`, 3,10 contre 5,21. Comparer les deux contrastes
 * plutôt que viser un seuil vaut aussi pour l'encre du contraste renforcé, dont
 * le point de bascule n'est pas le même.
 *
 * Une couleur illisible rend le blanc : elle est traitée comme sombre, et le
 * défaut du pied de page l'est.
 *
 * ⚠️ Miroir de `Socle/src/features/portal/contrast.ts` (`readableInk`).
 */
function readableInk(background: string, darkInk: string): string {
  const onWhite = contrastRatio(background, WHITE);
  const onInk = contrastRatio(background, darkInk);
  if (onWhite === null || onInk === null) return WHITE;
  return onWhite >= onInk ? WHITE : darkInk;
}

/**
 * Le texte se lit-il en clair sur ce fond ? Oui quand le blanc y contraste
 * mieux que l'encre ordinaire du portail — voir `readableInk`. Sert à qui ne
 * peint pas avec les encres du thème (le pied de page composé).
 */
export function isDarkColor(hex: string): boolean {
  return readableInk(hex, NEUTRALS.normal.ink) === WHITE;
}

/** La même couleur, transparente. Une couleur illisible rend `transparent`. */
function withAlpha(hex: string, alpha: number): string {
  const rgb = channels(hex);
  if (rgb === null) return "transparent";
  const to255 = (c: number) => Math.round(c * 255);
  return `rgb(${to255(rgb[0])} ${to255(rgb[1])} ${to255(rgb[2])} / ${alpha})`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = channels(hex);
  if (rgb === null) return null;
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const component = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${component(0)}${component(8)}${component(4)}`;
}

/**
 * La même couleur, plus foncée : la clarté multipliée par 0,75, teinte et
 * saturation inchangées.
 *
 * ⚠️ **Le facteur fait partie du contrat** (`PortalTheme.dark_primary` au
 * Socle) : c'est ce que l'éditeur mesure quand il annonce à la collectivité que
 * son contraste passera. En changer un ici rendrait ce diagnostic faux.
 * L'assombrissement se fait en TSL — le faire en RVB désaturerait au passage,
 * et la collectivité ne reconnaîtrait plus sa couleur.
 */
const DARKEN_FACTOR = 0.75;

function darkenColor(hex: string): string {
  const hsl = hexToHsl(hex);
  if (hsl === null) return hex;
  return hslToHex(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * DARKEN_FACTOR)));
}

// ── La palette ──────────────────────────────────────────────────────────────

function brandColors(branding: Branding | null): { primary: string; secondary: string } {
  const read = (value: string | null | undefined, fallback: string) =>
    typeof value === "string" && HEX_COLOR.test(value) ? value : fallback;
  return {
    primary: read(branding?.primaryColor, DEFAULT_PRIMARY),
    secondary: read(branding?.secondaryColor, DEFAULT_SECONDARY),
  };
}

/**
 * Les variables CSS à poser sur la racine de la page.
 *
 * Deux familles, et la distinction compte : `--brand-*` sont les couleurs de la
 * collectivité **telles qu'appliquées** (donc éventuellement assombries par
 * l'accessibilité), `--pt-*` sont les valeurs du thème. Les composants d'avant
 * le thème lisent les premières et restent justes ; les nouveaux lisent les
 * secondes.
 */
export function themeStyle(theme: PortalTheme, branding: Branding | null): CSSProperties {
  const brand = brandColors(branding);
  const strong = theme.accessibility.highContrast;
  const { ink, muted, border, fieldBorder, surface } = strong ? NEUTRALS.contrast : NEUTRALS.normal;

  // `highContrast` fonce la couleur principale comme le fait `darkPrimary` :
  // c'est le même geste, demandé pour la même raison.
  const primary =
    theme.accessibility.darkPrimary || strong ? darkenColor(brand.primary) : brand.primary;
  const accent = brand.secondary;

  const filled = theme.header.fill === "color";
  const headerSurface = filled ? (theme.header.color === "secondary" ? accent : primary) : WHITE;
  const headerInk = filled ? readableInk(headerSurface, ink) : ink;
  const prominent = theme.header.account === "prominent";
  const pills = theme.header.menu === "pills";
  const centered = theme.header.logo === "center";

  const type = SCALE_FACTOR[theme.typography.textScale];
  const density = DENSITY_FACTOR[theme.shapes.density];
  const radius = RADIUS_PX[theme.shapes.radius];
  const px = (base: number, factor: number) => `${Math.round(base * factor)}px`;

  const vars: Record<string, string> = {
    // La charte, telle qu'appliquée. Les composants qui la lisaient avant le
    // thème continuent de fonctionner — et gagnent l'assombrissement.
    "--brand-primary": primary,
    "--brand-secondary": accent,

    "--pt-font": fontStack(theme.typography.font),

    "--pt-radius": `${radius}px`,
    "--pt-radius-sm": `${Math.max(2, radius - 4)}px`,
    "--pt-shadow": SHADOW_CSS[theme.shapes.shadow],

    "--pt-h1": px(TYPE_SCALE.h1, type),
    "--pt-h2": px(TYPE_SCALE.h2, type),
    "--pt-body": px(TYPE_SCALE.body, type),
    "--pt-small": px(TYPE_SCALE.small, type),
    "--pt-tiny": px(TYPE_SCALE.tiny, type),

    "--pt-gap": px(SPACING.gap, density),
    "--pt-pad": px(SPACING.pad, density),
    "--pt-card-pad": px(SPACING.cardPad, density),

    "--pt-ink": ink,
    "--pt-muted": muted,
    "--pt-border": border,
    "--pt-field-border": fieldBorder,
    "--pt-surface": surface,
    "--pt-primary": primary,
    "--pt-primary-soft": withAlpha(primary, strong ? 0.14 : 0.08),
    "--pt-on-primary": readableInk(primary, ink),
    "--pt-accent": accent,
    "--pt-accent-soft": withAlpha(accent, strong ? 0.5 : 0.35),
    "--pt-accent-ink": readableInk(accent, ink),

    "--pt-header-surface": headerSurface,
    "--pt-header-ink": headerInk,
    "--pt-header-muted": filled ? withAlpha(headerInk, 0.78) : muted,
    "--pt-header-border": filled ? "transparent" : border,
    "--pt-header-direction": centered ? "column" : "row",
    "--pt-header-gap": centered ? "10px" : "14px",

    "--pt-nav-bg": pills
      ? filled
        ? withAlpha(headerInk, 0.14)
        : withAlpha(primary, 0.08)
      : "transparent",
    "--pt-nav-pad": pills ? "6px 12px" : "0",
    "--pt-nav-radius": pills ? "999px" : "0",

    "--pt-account-bg": prominent ? (filled ? headerInk : primary) : "transparent",
    "--pt-account-fg": prominent
      ? filled
        ? headerSurface
        : readableInk(primary, ink)
      : headerInk,
    "--pt-account-border": prominent
      ? filled
        ? headerInk
        : primary
      : filled
        ? withAlpha(headerInk, 0.5)
        : "transparent",
    "--pt-account-pad": prominent ? "8px 14px" : "8px 2px",

    // Le carré du logo, quand la collectivité n'en a pas. Sur un bandeau coloré
    // sans logo blanc, on le pose en sombre : un carré vert sur un bandeau vert
    // ne se verrait pas.
    "--pt-mark-bg": filled ? (theme.header.logoWhite ? headerInk : ink) : primary,
  };

  // ⚠️ `fontFamily` EN PLUS de la variable. Poser `--pt-font` ne suffit pas :
  // `body` résout `var(--pt-font)` avec la valeur du `:root`, et tout ce qui est
  // dedans hérite de CETTE résolution — la police du thème n'atteindrait jamais
  // le texte. C'est le seul réglage qui doit être appliqué, pas seulement
  // déclaré.
  return { ...vars, fontFamily: "var(--pt-font)" } as CSSProperties;
}

/**
 * Le logo à afficher dans le bandeau.
 *
 * Le logo blanc ne sert que sur un bandeau de couleur, et seulement si la
 * collectivité en a déposé un : sans lui, le logo couleur reste préférable à un
 * bandeau anonyme.
 */
export function headerLogoUrl(theme: PortalTheme, branding: Branding | null): string | null {
  if (theme.header.fill === "color" && theme.header.logoWhite && branding?.logoWhiteUrl) {
    return branding.logoWhiteUrl;
  }
  return branding?.logoUrl ?? null;
}

// ── Le fond image d'un bloc ─────────────────────────────────────────────────

/**
 * Le fond d'un bloc habillé d'une image : la photo, cadrée au centre et rognée
 * pour couvrir tout le bloc. Rien d'autre par-dessus.
 *
 * ⚠️ **LE VOILE CLAIR A ÉTÉ RETIRÉ le 2026-09-12, sur décision produit** : la
 * photo se voit telle que la collectivité l'a choisie. Il faut savoir ce qu'on
 * a perdu — c'était une GARANTIE de contraste, pas un effet : à 60 % de blanc,
 * le pire fond possible (un voile sur du noir pur) laissait l'encre du portail
 * à 5,7 : 1, au-dessus du seuil AA de 4,5 : 1, quelle que soit l'image. Sans
 * lui, une photo sombre rend le titre illisible et rien ne le mesure avant
 * l'affichage.
 *
 * Ce qu'il reste comme filet : un bloc à fond image passe son sous-titre à
 * l'encre pleine, le gris de texte ne tenant sur aucune photo. Et le jour où
 * il faudra revenir à un voile, la bonne forme est **sous le texte seul**, pas
 * sur toute l'image : on garde la photo intacte et le contraste avec.
 *
 * ⚠️ L'adresse est sérialisée par `JSON.stringify` : elle vient d'un agent, et
 * une URL https peut contenir un guillemet. Sans échappement, le navigateur
 * rejetterait la déclaration entière et le fond disparaîtrait sans que rien ne
 * le dise.
 *
 * ⚠️ **Miroir volontaire** de `Socle/src/features/portal/themeStyle.ts`, comme
 * le reste de ce fichier : l'éditeur montre ce que le site rend. Testé des deux
 * côtés.
 *
 * Rend `undefined` sans image : un bloc sans fond ne doit porter aucun style.
 */
export function imageBackdropStyle(
  imageUrl: string | null,
  fixed: boolean,
): CSSProperties | undefined {
  const url = (imageUrl ?? "").trim();
  if (url === "") return undefined;
  return {
    backgroundImage: `url(${JSON.stringify(url)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    // `fixed` : l'image s'ancre à la fenêtre, le bloc glisse par-dessus elle.
    // Ignoré par plusieurs navigateurs mobiles — c'est un ornement, le bloc
    // reste entier sans lui.
    backgroundAttachment: fixed ? "fixed" : "scroll",
  };
}

/**
 * Halo sous un texte blanc : trois ombres **sans décalage**, de plus en plus
 * larges et de plus en plus légères — l'ombre part de tous les côtés à la fois,
 * serrée au bord des lettres (lisibilité) puis diffuse (elle détache le mot sans
 * dessiner de boîte). Exporté pour le test.
 */
export const DARK_TEXT_HALO =
  "0 0 2px rgba(0, 0, 0, 0.7), 0 0 8px rgba(0, 0, 0, 0.55), 0 0 18px rgba(0, 0, 0, 0.4)";
/** Même halo, en clair, sous l'encre sombre du thème. */
export const LIGHT_TEXT_HALO =
  "0 0 2px rgba(255, 255, 255, 0.85), 0 0 8px rgba(255, 255, 255, 0.7), 0 0 18px rgba(255, 255, 255, 0.5)";

/**
 * Couleur et ombre du titre et du sous-titre du bloc de recherche posés sur
 * son image (Socle 1.32.0 : `text_color` / `text_shadow`).
 *
 * ⚠️ L'ombre prend toujours le **contre-pied** du texte : sombre sous du blanc,
 * claire sous l'encre. Une ombre noire sous une encre presque noire épaissirait
 * les lettres sans rien détacher.
 *
 * ⚠️ **Miroir volontaire** de `Socle/src/features/portal/themeStyle.ts` : les
 * mêmes nombres, pour que l'aperçu de l'éditeur montre ce que le site rend.
 *
 * Rend `undefined` quand il n'y a rien à changer (encre du thème, sans ombre).
 */
export function imageTextStyle(color: "theme" | "white", shadow: boolean): CSSProperties | undefined {
  const white = color === "white";
  if (!white && !shadow) return undefined;
  return {
    ...(white ? { color: "#ffffff" } : {}),
    ...(shadow ? { textShadow: white ? DARK_TEXT_HALO : LIGHT_TEXT_HALO } : {}),
  };
}
