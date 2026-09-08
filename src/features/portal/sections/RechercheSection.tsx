/**
 * Bloc « Recherche de démarche ».
 *
 * Le champ est possédé par `HomeComposition` : c'est lui qui filtre les
 * sections « démarches » qui suivent. Les raccourcis ne filtrent rien
 * eux-mêmes — ils préremplissent le champ avec le nom de la démarche, pour
 * qu'il n'existe qu'un seul mécanisme de filtre, celui du champ.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { RechercheSection as RechercheSectionData } from "@fn/_shared/domain/page.ts";
import { resolveShortcuts } from "../composition.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";

function SearchIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className="shrink-0 text-[color:var(--pt-muted)]"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function RechercheSection({
  section,
  demarches,
  query,
  onQueryChange,
}: {
  section: RechercheSectionData;
  /** Catalogue complet (non filtré) : les raccourcis référencent l'ensemble des démarches publiées. */
  demarches: Demarche[];
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const shortcuts = resolveShortcuts(section.shortcuts, demarches);
  const t = useT();
  const label =
    section.placeholder.trim() !== "" ? section.placeholder : t("search.placeholder");

  return (
    <section className="flex flex-col items-center gap-3.5 py-2">
      <h2 className="text-center text-[length:var(--pt-h1)] font-extrabold leading-tight tracking-tight text-[color:var(--pt-ink)]">
        {section.title}
      </h2>
      {section.subtitle.trim() !== "" && (
        <p className="text-center text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
          {section.subtitle}
        </p>
      )}
      <div className="flex h-12 w-full max-w-[520px] items-center gap-2.5 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-3.5 shadow-[var(--pt-shadow)]">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={section.placeholder}
          aria-label={label}
          className="w-full border-0 bg-transparent p-0 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] outline-none placeholder:text-[color:var(--pt-muted)] focus:outline-none focus:ring-0"
        />
      </div>
      {shortcuts.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {shortcuts.map((demarche) => (
            <button
              key={demarche.id}
              type="button"
              onClick={() => onQueryChange(demarche.name)}
              className="rounded-full bg-[color:var(--pt-surface)] px-3 py-1.5 text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-ink)] hover:opacity-80"
            >
              {demarche.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
