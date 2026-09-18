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
 *
 * ⚠️ **Le lien vers la déclaration complète (`/accessibilite`) ne se décide pas
 * ici** : le Socle sert `declarationLink` déjà résolu — vrai seulement si la
 * collectivité l'a demandé ET qu'une déclaration non vide est publiée. Le
 * portail ne peut donc pas afficher un lien vers une page vide. Il peut, en
 * revanche, n'afficher QUE le lien, quand la collectivité n'a pas écrit de
 * phrase : c'est encore une mention.
 */
import { Link, useLocation } from "react-router-dom";
import type { PortalTheme } from "@fn/_shared/domain/theme.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath, splitScopedPath } from "@/i18n/localizedPath.ts";

/**
 * La collectivité a-t-elle écrit une déclaration ? Sert aux cadres de page
 * (`DemarcheShell`, `OrganismePage`…) pour savoir si le pied de page de
 * premier niveau a quelque chose à porter, AVANT de poser un repère
 * `contentinfo` — un repère vide n'aide personne (RGAA 9.2 / 12.6).
 */
export function hasAccessibilityDeclaration(theme?: PortalTheme): boolean {
  if (theme === undefined) return false;
  return theme.accessibility.declaration.trim() !== "" || theme.accessibility.declarationLink;
}

export function AccessibilityNotice({ theme }: { theme?: PortalTheme }) {
  // Les hooks d'abord : l'ordre des appels ne doit pas dépendre du thème.
  const { lang } = useLanguage();
  const t = useT();
  const { pathname } = useLocation();
  if (theme === undefined || !hasAccessibilityDeclaration(theme)) return null;

  const text = theme.accessibility.declaration.trim();
  const link = theme.accessibility.declarationLink;
  // Sur la déclaration elle-même, le lien dit qu'il désigne la page courante.
  const here = splitScopedPath(pathname).path === "/accessibilite";
  return (
    <p
      className="px-6 py-4 text-center text-[length:var(--pt-tiny)] text-[color:var(--pt-muted)]"
      style={{ background: "var(--pt-surface)" }}
    >
      {text}
      {text !== "" && link ? " · " : null}
      {link && (
        <Link
          to={localizedPath(lang, "/accessibilite")}
          aria-current={here ? "page" : undefined}
          className="font-semibold text-[color:var(--pt-ink)] underline hover:no-underline"
        >
          {t("accessibilite.title")}
        </Link>
      )}
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
