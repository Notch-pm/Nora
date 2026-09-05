/**
 * Bandeau de texte libre — la collectivité choisit le titre, le corps et
 * l'alignement (par exemple pour un bloc « Contact et horaires »).
 */
import type { TexteSection as TexteSectionData } from "@fn/_shared/domain/page.ts";

export function TexteSection({ section }: { section: TexteSectionData }) {
  return (
    <section
      className={
        "flex flex-col gap-1.5 rounded-xl bg-[color:color-mix(in_srgb,var(--brand-secondary)_35%,white)] px-6 py-4 " +
        (section.align === "center" ? "items-center text-center" : "items-start text-left")
      }
    >
      <h2 className="text-base font-bold text-slate-900">{section.title}</h2>
      <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-slate-700">
        {section.body}
      </p>
    </section>
  );
}
