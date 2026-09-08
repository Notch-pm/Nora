/**
 * La charte graphique appliquée à la page : deux variables CSS, et un logo.
 *
 * Les composants ne connaissent que `--brand-primary` et `--brand-secondary`
 * (définies par défaut dans `index.css`) ; ce module les redéfinit sur la
 * racine de la page quand la collectivité a une charte. Champ par champ : une
 * couleur manquante garde sa valeur par défaut, elle n'entraîne pas l'autre.
 *
 * Les valeurs viennent du Socle déjà validées (`#rrggbb`, `https`) — voir
 * `brandingService`. Ce module ne revalide pas ; il n'invente rien non plus.
 */
import type { CSSProperties } from "react";
import type { Branding } from "@fn/_shared/domain/branding.ts";

/** Le vert de la gamme (`hsl(153 90% 32%)`) et son jaune, faute de charte. */
export const DEFAULT_PRIMARY = "#089b59";
export const DEFAULT_SECONDARY = "#ffcd57";

/** Variables CSS à poser sur la racine de la page. Vide sans charte. */
export function brandingStyle(branding: Branding | null): CSSProperties {
  const vars: Record<string, string> = {};
  if (branding?.primaryColor) vars["--brand-primary"] = branding.primaryColor;
  if (branding?.secondaryColor) vars["--brand-secondary"] = branding.secondaryColor;
  // Les propriétés personnalisées ne sont pas dans le type `CSSProperties` ;
  // React les transmet pourtant telles quelles.
  return vars as CSSProperties;
}

/**
 * ── La dernière charte connue ────────────────────────────────────────────────
 *
 * Le portail ne connaît la charte qu'une fois le serveur répondu : elle arrive
 * avec le reste. L'écran d'attente — celui que le visiteur regarde le plus —
 * serait donc le seul à ne pas porter les couleurs de sa collectivité. On
 * retient donc la charte reçue pour peindre l'attente de la visite SUIVANTE.
 *
 * Le stockage local est cloisonné par origine, et une collectivité a son
 * domaine : personne ne peut hériter de la charte d'une autre. Une charte
 * modifiée depuis se corrige au chargement en cours — cette mémoire ne peint
 * que l'attente, jamais la page.
 */
const STORAGE_KEY = "nora.branding";

const HEX_COLOR = /^#[0-9a-f]{6}$/;

function storedColor(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value) ? value : null;
}

function storedUrl(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

/**
 * La charte relue depuis la mémoire.
 *
 * ⚠️ ON REVALIDE. Le Socle sert des valeurs vérifiées (`#rrggbb`, `https`) ;
 * ce qui revient du stockage local a pu être écrit par n'importe quoi d'autre,
 * et finit dans un `style` et un `src`. Un champ non conforme vaut absent : la
 * page reprend son défaut plutôt que d'obéir à une valeur inventée.
 */
export function parseRememberedBranding(raw: string | null): Branding | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  return {
    logoUrl: storedUrl(stored.logoUrl),
    logoWhiteUrl: storedUrl(stored.logoWhiteUrl),
    primaryColor: storedColor(stored.primaryColor),
    secondaryColor: storedColor(stored.secondaryColor),
  };
}

/**
 * ⚠️ `localStorage` LÈVE en navigation privée sur certains navigateurs, et
 * quand les données de site sont bloquées — même précaution que pour la langue
 * (`LanguageLayout`). L'échec vaut « pas de mémoire » : l'attente se peint aux
 * couleurs de la gamme, et la visite se passe.
 */
export function rememberedBranding(): Branding | null {
  try {
    return parseRememberedBranding(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Retient la charte reçue, pour l'attente de la prochaine visite. */
export function rememberBranding(branding: Branding | null): void {
  try {
    // Une collectivité qui retire sa charte ne doit pas garder l'ancienne en
    // mémoire : l'attente mentirait sur ce que la page va afficher.
    if (branding === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
  } catch {
    // Pas de mémoire : la prochaine attente sera aux couleurs de la gamme.
  }
}
