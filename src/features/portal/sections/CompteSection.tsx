/**
 * Bandeau « Espace usager ».
 *
 * Le bouton est volontairement désactivé : ce lot ne livre aucune
 * authentification usager. Un bouton cliquable qui ne mènerait nulle part
 * serait pire qu'un bouton visiblement indisponible — `title` le dit
 * explicitement à qui pose la souris dessus.
 */
import type { CompteSection as CompteSectionData } from "@fn/_shared/domain/page.ts";

function UserIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className="text-slate-900"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

export function CompteSection({ section }: { section: CompteSectionData }) {
  return (
    <section className="flex flex-col items-stretch gap-4 rounded-xl bg-slate-900 px-6 py-5 sm:flex-row sm:items-center">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[hsl(153_82%_43%)]">
        <UserIcon />
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <h2 className="text-base font-bold text-white">{section.title}</h2>
        <p className="text-[12.5px] text-slate-300">{section.subtitle}</p>
      </div>
      <button
        type="button"
        disabled
        title="Bientôt disponible"
        aria-disabled="true"
        className="shrink-0 cursor-not-allowed whitespace-nowrap rounded-[10px] bg-white px-4 py-2.5 text-center text-sm font-bold text-slate-900 opacity-60"
      >
        Se connecter
      </button>
    </section>
  );
}
