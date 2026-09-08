/**
 * Bandeau « Espace usager ».
 *
 * Le bouton est volontairement désactivé : ce lot ne livre aucune
 * authentification usager. Un bouton cliquable qui ne mènerait nulle part
 * serait pire qu'un bouton visiblement indisponible — `title` le dit
 * explicitement à qui pose la souris dessus.
 */
import type { CompteSection as CompteSectionData } from "@fn/_shared/domain/page.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";

function UserIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className="text-[color:var(--pt-on-primary)]"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

export function CompteSection({ section }: { section: CompteSectionData }) {
  const t = useT();
  return (
    <section className="flex flex-col items-stretch gap-4 rounded-[var(--pt-radius)] bg-[color:var(--pt-ink)] p-[var(--pt-pad)] sm:flex-row sm:items-center">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--pt-radius-sm)] bg-[color:var(--pt-primary)]">
        <UserIcon />
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <h2 className="text-[length:var(--pt-h2)] font-bold text-white">{section.title}</h2>
        <p className="text-[length:var(--pt-small)] text-white/75">{section.subtitle}</p>
      </div>
      <button
        type="button"
        disabled
        title={t("compte.soon")}
        aria-disabled="true"
        className="shrink-0 cursor-not-allowed whitespace-nowrap rounded-[var(--pt-radius-sm)] bg-white px-4 py-2.5 text-center text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)] opacity-60"
      >
        {t("compte.signIn")}
      </button>
    </section>
  );
}
