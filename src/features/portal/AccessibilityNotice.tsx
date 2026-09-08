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

export function AccessibilityNotice({ theme }: { theme?: PortalTheme }) {
  const declaration = theme?.accessibility.declaration ?? "";
  if (declaration.trim() === "") return null;
  return (
    <p
      className="px-6 py-4 text-center text-[length:var(--pt-tiny)] text-[color:var(--pt-muted)]"
      style={{ background: "var(--pt-surface)" }}
    >
      {declaration}
    </p>
  );
}
