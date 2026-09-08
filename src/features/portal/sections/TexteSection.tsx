/**
 * Bandeau de texte libre — la collectivité choisit le titre, le corps et
 * l'alignement (par exemple pour un bloc « Contact et horaires »).
 */
import type { TexteSection as TexteSectionData } from "@fn/_shared/domain/page.ts";

export function TexteSection({ section }: { section: TexteSectionData }) {
  return (
    <section
      // L'aplat est la couleur secondaire de la collectivité, diluée : posé en
      // style parce qu'une transparence sur une variable CSS ne s'écrit pas en
      // modificateur d'opacité Tailwind.
      style={{ background: "var(--pt-accent-soft)" }}
      className={
        "flex flex-col gap-1.5 rounded-[var(--pt-radius)] p-[var(--pt-pad)] " +
        (section.align === "center" ? "items-center text-center" : "items-start text-left")
      }
    >
      <h2 className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">
        {section.title}
      </h2>
      <p className="whitespace-pre-line text-[length:var(--pt-body)] leading-relaxed text-[color:var(--pt-ink)]">
        {section.body}
      </p>
    </section>
  );
}
