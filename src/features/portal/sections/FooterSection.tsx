/**
 * Pied de page composé par la collectivité : pleine largeur, à la couleur de
 * fond choisie, sous-blocs répartis sur une à trois colonnes dans l'ordre.
 * Rendu HORS du conteneur centré de la page — c'est `HomeComposition` qui le
 * place — et le texte se lit en clair ou en sombre selon le fond.
 *
 * ⚠️ SA RACINE EST UN `<div>`, PAS UN `<footer>` (RGAA 9.2 / 12.6) : c'est
 * `HomeComposition` qui pose le `<footer>` de premier niveau (le repère
 * `contentinfo`) quand ce bloc termine la page — un second `<footer>` imbriqué
 * dedans serait un repère en double, et un `<footer>` qui reste dans `main`
 * (bloc composé ailleurs qu'en dernière position) n'en serait pas un non plus.
 */
import type { FooterSection as FooterSectionData } from "@fn/_shared/domain/page.ts";
import { footerColumnsClass, isDarkColor } from "../composition.ts";

export function FooterSection({ section }: { section: FooterSectionData }) {
  const dark = isDarkColor(section.background);
  return (
    <div
      className={dark ? "text-white" : "text-[color:var(--pt-ink)]"}
      style={{ backgroundColor: section.background }}
    >
      <div className="mx-auto max-w-5xl px-6 py-10">
        {section.title ? (
          <p className="mb-6 text-[length:var(--pt-body)] font-bold">{section.title}</p>
        ) : null}
        <div className={`grid gap-8 ${footerColumnsClass(section.columns)}`}>
          {section.children.map((child) => (
            <div
              key={child.id}
              className={child.align === "center" ? "flex flex-col items-center text-center" : ""}
            >
              <h2 className="text-[length:var(--pt-body)] font-bold">{child.title}</h2>
              <p
                className={
                  "mt-1 whitespace-pre-line text-[length:var(--pt-small)] leading-relaxed " +
                  (dark ? "text-white/75" : "text-black/70")
                }
              >
                {child.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
