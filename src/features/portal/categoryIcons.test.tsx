import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CATEGORY_ICONS, FALLBACK_CATEGORY_ICON } from "./categoryIcons.ts";
import { CategoryIcon } from "./CategoryIcon.tsx";

/**
 * ⚠️ La MÊME liste que `src/features/categories/icon-options.test.ts` du
 * Socle, qui la possède. Le Socle l'allonge → on régénère ici
 * (`node scripts/generate-category-icons.mjs ../socle`) et on recopie la liste.
 * Tant que ce n'est pas fait, une valeur nouvelle se dessine en pictogramme
 * neutre : rien ne casse, mais la carte perd son dessin.
 */
const CONTRACT_VALUES = [
  "clipboard-list", "landmark", "file-text", "id-card", "stamp", "scale", "heart", "cross",
  "vote", "users", "calendar", "mail", "credit-card", "receipt", "euro", "baby", "toy-brick",
  "school", "backpack", "utensils", "ferris-wheel", "tent", "bus", "graduation-cap", "smile",
  "person-standing", "stethoscope", "heart-pulse", "hospital", "pill", "heart-handshake",
  "hand-heart", "accessibility", "armchair", "sun", "home", "building-2", "construction",
  "lightbulb", "triangle-alert", "map-pin", "tree-pine", "flower-2", "recycle", "trash-2",
  "droplets", "dog", "car", "square-parking", "bike", "dumbbell", "trophy", "waves", "drama",
  "library", "book-open", "music", "palette", "castle", "party-popper", "ticket", "briefcase",
  "store", "shopping-basket", "handshake", "monitor", "megaphone", "shield-check", "siren",
];

describe("pictogrammes de catégorie", () => {
  it("dessine exactement le catalogue du Socle", () => {
    expect(Object.keys(CATEGORY_ICONS)).toEqual(CONTRACT_VALUES);
    for (const value of CONTRACT_VALUES) expect(CATEGORY_ICONS[value].length).toBeGreaterThan(0);
  });

  it("dessine le pictogramme demandé", () => {
    const html = renderToStaticMarkup(<CategoryIcon icon="utensils" />);
    expect(html).toContain('data-icon="utensils"');
    expect(html).toContain("<path");
    expect(html).toContain('aria-hidden="true"');
  });

  it("retombe sur le pictogramme neutre sans catégorie ou pour une valeur inconnue", () => {
    for (const icon of [null, "licorne"]) {
      expect(renderToStaticMarkup(<CategoryIcon icon={icon} />)).toContain(
        `data-icon="${FALLBACK_CATEGORY_ICON}"`,
      );
    }
  });
});
