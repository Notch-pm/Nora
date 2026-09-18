/**
 * Le lien d'évitement (RGAA 12.7) : le premier élément tabulable de chaque
 * écran, invisible jusqu'au focus, qui mène droit au contenu — sans repasser
 * par l'en-tête, sa navigation décorative et le sélecteur de langue à chaque
 * page suivante.
 *
 * ⚠️ LE `href` RESTE `#contenu` (secours sans script, partage d'un lien qui
 * pointe dessus, robots), MAIS LE CLIC NE LAISSE PAS LE NAVIGATEUR POSER LE
 * FRAGMENT LUI-MÊME. Une navigation par fragment pousse une entrée d'historique
 * et déclenche `popstate`, que `LanguageLayout` écoute (canonicalisation de
 * `/fr/…`) et que la mesure d'audience (`useAudience.ts`) regarde via
 * `location.pathname` — inoffensif ici puisque le chemin ne change pas, mais on
 * ne prend pas le risque : le focus et le défilement sont faits à la main,
 * l'adresse ne bouge jamais.
 */
import type { MouseEvent } from "react";
import { useT } from "@/i18n/LanguageLayout.tsx";

export function SkipLink() {
  const t = useT();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const target = document.getElementById("contenu");
    if (target === null) return;
    target.focus();
    target.scrollIntoView();
  }

  return (
    <a
      href="#contenu"
      onClick={onClick}
      className={
        "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 " +
        "focus:rounded-[var(--pt-radius-sm)] focus:bg-white focus:px-4 focus:py-2 " +
        "focus:text-[length:var(--pt-body)] focus:font-semibold focus:text-[color:var(--pt-ink)] " +
        "focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]"
      }
    >
      {t("skip.toContent")}
    </a>
  );
}
