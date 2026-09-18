/**
 * La déclaration d'accessibilité, au pied de chaque page.
 *
 * C'est une **mention obligatoire** d'un site public (RGAA / article 47 de la
 * loi du 11 février 2005) : elle doit figurer sur toutes les pages, pas
 * seulement sur l'accueil composé. D'où un composant à part, rendu par les
 * trois cadres du portail — la page composée, la liste de repli et les pages
 * d'une démarche.
 *
 * ⚠️ **Le portail n'invente rien.** Le texte vient de la collectivité, qui
 * l'écrit dans l'éditeur du Socle ; vide, la bande ne s'affiche pas du tout.
 * Afficher « Non conforme » ou « Conformité inconnue » à sa place serait une
 * déclaration que personne n'a faite — et une déclaration est un acte engageant.
 */
import type { PortalTheme } from "@fn/_shared/domain/theme.ts";

/**
 * La collectivité a-t-elle écrit une déclaration ? Sert aux cadres de page
 * (`DemarcheShell`, `OrganismePage`…) pour savoir si le pied de page de
 * premier niveau a quelque chose à porter, AVANT de poser un repère
 * `contentinfo` — un repère vide n'aide personne (RGAA 9.2 / 12.6).
 */
export function hasAccessibilityDeclaration(theme?: PortalTheme): boolean {
  return (theme?.accessibility.declaration ?? "").trim() !== "";
}

export function AccessibilityNotice({ theme }: { theme?: PortalTheme }) {
  if (!hasAccessibilityDeclaration(theme)) return null;
  return (
    <p
      className="px-6 py-4 text-center text-[length:var(--pt-tiny)] text-[color:var(--pt-muted)]"
      style={{ background: "var(--pt-surface)" }}
    >
      {theme?.accessibility.declaration}
    </p>
  );
}

/**
 * Le pied de page de premier niveau (`contentinfo`) des écrans qui n'ont que
 * la déclaration à y mettre — pas de pied composé à côté. L'accueil, qui peut
 * en avoir un, compose le sien lui-même (voir `HomeComposition`).
 */
export function AccessibilityFooter({ theme }: { theme?: PortalTheme }) {
  if (!hasAccessibilityDeclaration(theme)) return null;
  return (
    <footer>
      <AccessibilityNotice theme={theme} />
    </footer>
  );
}
