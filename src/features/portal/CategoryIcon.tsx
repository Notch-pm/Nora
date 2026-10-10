/**
 * Le pictogramme d'une catégorie de démarches, dessiné depuis le registre
 * généré `categoryIcons.ts`. Une valeur absente ou inconnue donne le
 * pictogramme neutre : une carte a toujours son pictogramme.
 *
 * Décoratif : le libellé de la catégorie est écrit à côté, le lecteur d'écran
 * n'a rien à apprendre du dessin.
 */
import { createElement } from "react";
import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from "./categoryIcons.ts";

export function categoryIconNodes(icon: string | null) {
  return (icon !== null ? CATEGORY_ICONS[icon] : undefined) ?? CATEGORY_ICONS[FALLBACK_CATEGORY_ICON];
}

export function CategoryIcon({ icon, size = 20 }: { icon: string | null; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-icon={icon !== null && icon in CATEGORY_ICONS ? icon : FALLBACK_CATEGORY_ICON}
    >
      {categoryIconNodes(icon).map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
}
