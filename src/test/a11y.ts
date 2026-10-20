/**
 * Accessibilité de base des nouveaux écrans : axe-core sur le DOM rendu par
 * jsdom. jsdom n'a ni mise en page ni couleurs calculées : les règles qui en
 * dépendent (contraste, régions de page) sont écartées — elles relèvent de
 * l'audit RGAA du lot L8, pas de ce filet automatique.
 */
import axe from "axe-core";

export async function a11yViolations(container: HTMLElement): Promise<string[]> {
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
      "landmark-one-main": { enabled: false },
      "page-has-heading-one": { enabled: false },
    },
  });
  return result.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}
