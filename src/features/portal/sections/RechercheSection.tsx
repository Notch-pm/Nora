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

function SearchIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className="shrink-0 text-slate-400"
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
  const label = section.placeholder.trim() !== "" ? section.placeholder : "Rechercher une démarche";

  return (
    <section className="flex flex-col items-center gap-3.5 py-2">
      <h2 className="text-center text-2xl font-extrabold tracking-tight text-slate-900">
        {section.title}
      </h2>
      {section.subtitle.trim() !== "" && (
        <p className="text-center text-sm text-slate-500">{section.subtitle}</p>
      )}
      <div className="flex h-12 w-full max-w-[520px] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 shadow-sm">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={section.placeholder}
          aria-label={label}
          className="w-full border-0 bg-transparent p-0 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0"
        />
      </div>
      {shortcuts.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {shortcuts.map((demarche) => (
            <button
              key={demarche.id}
              type="button"
              onClick={() => onQueryChange(demarche.name)}
              className="rounded-full bg-slate-100 px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-200"
            >
              {demarche.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
