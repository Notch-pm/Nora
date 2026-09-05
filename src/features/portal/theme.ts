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
