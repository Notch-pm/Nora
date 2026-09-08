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
 */
const NEUTRALS = {
  normal: { ink: "#1c2220", muted: "#5c6663", border: "#e4e7e6", surface: "#f1f4f3" },
  contrast: { ink: "#0d1210", muted: "#3d4844", border: "#acb9b5", surface: "#e6ebe9" },
} as const;

/** Le vert de la gamme et son jaune, faute de charte. */
export const DEFAULT_PRIMARY = "#089b59";
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

/**
 * Le texte se lit-il en clair sur ce fond ? Sous 0,4 de luminance le fond est
 * sombre. Une couleur illisible est traitée comme sombre — le défaut du pied de
 * page l'est.
 */
export function isDarkColor(hex: string): boolean {
  const luminance = relativeLuminance(hex);
  return luminance === null || luminance < 0.4;
}

/** L'encre qui se lit sur ce fond : le blanc, ou l'encre sombre proposée. */
function readableInk(background: string, darkInk: string): string {
  return isDarkColor(background) ? WHITE : darkInk;
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
  const { ink, muted, border, surface } = strong ? NEUTRALS.contrast : NEUTRALS.normal;

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
