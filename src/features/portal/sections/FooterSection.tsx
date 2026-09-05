/**
 * Pied de page composé par la collectivité : pleine largeur, à la couleur de
 * fond choisie, sous-blocs répartis sur une à trois colonnes dans l'ordre.
 * Rendu HORS du conteneur centré de la page — c'est `HomeComposition` qui le
 * place — et le texte se lit en clair ou en sombre selon le fond.
 */
import type { FooterSection as FooterSectionData } from "@fn/_shared/domain/page.ts";
import { footerColumnsClass, isDarkColor } from "../composition.ts";

export function FooterSection({ section }: { section: FooterSectionData }) {
  const dark = isDarkColor(section.background);
  return (
    <footer
      className={dark ? "text-white" : "text-slate-900"}
      style={{ backgroundColor: section.background }}
    >
      <div className="mx-auto max-w-5xl px-6 py-10">
        {section.title ? <p className="mb-6 text-sm font-bold">{section.title}</p> : null}
        <div className={`grid gap-8 ${footerColumnsClass(section.columns)}`}>
          {section.children.map((child) => (
            <div
              key={child.id}
              className={child.align === "center" ? "flex flex-col items-center text-center" : ""}
            >
              <h2 className="text-sm font-bold">{child.title}</h2>
              <p
                className={
                  "mt-1 whitespace-pre-line text-sm leading-relaxed " +
                  (dark ? "text-white/75" : "text-slate-700")
                }
              >
                {child.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
