/**
 * Bandeau « Espace usager ».
 *
 * Le second lien mène au compte citoyen : `/compte` si l'on y est connecté,
 * la connexion sinon (`useAccountHref`).
 *
 * Connecté, « Mes demandes » s'y ajoute (L3b).
 *
 * À côté, un lien ACTIF « Suivre une demande » : suivre une demande déposée sans
 * compte (`/suivi`) n'a pas besoin d'espace usager.
 */
import type { CompteSection as CompteSectionData } from "@fn/_shared/domain/page.ts";
import { Link } from "react-router-dom";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import { useAccountHref } from "@/features/compte/sessionKind.ts";

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
  const { lang } = useLanguage();
  const account = useAccountHref();
  return (
    <section className="flex flex-col items-stretch gap-4 rounded-[var(--pt-radius)] bg-[color:var(--pt-ink)] p-[var(--pt-pad)] sm:flex-row sm:items-center">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--pt-radius-sm)] bg-[color:var(--pt-primary)]">
        <UserIcon />
      </div>
      <div className="flex flex-1 flex-col gap-0.5">
        <h2 className="text-[length:var(--pt-h2)] font-bold text-white">{section.title}</h2>
        {/* Le sous-titre paramétré invite à se connecter : connecté, il mentirait. */}
        <p className="text-[length:var(--pt-small)] text-white/75">
          {account.connected ? t("compte.section.connected") : section.subtitle}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <Link
          to={localizedPath(lang, "/suivi")}
          className="whitespace-nowrap rounded-[var(--pt-radius-sm)] bg-white px-4 py-2.5 text-center text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)] hover:opacity-90"
        >
          {t("compte.follow")}
        </Link>
        {account.connected && (
          <Link
            to={localizedPath(lang, "/compte/demandes")}
            className="whitespace-nowrap rounded-[var(--pt-radius-sm)] bg-white px-4 py-2.5 text-center text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)] hover:opacity-90"
          >
            {t("compte.demandes.link")}
          </Link>
        )}
        <Link
          to={account.href}
          className="shrink-0 whitespace-nowrap rounded-[var(--pt-radius-sm)] bg-white px-4 py-2.5 text-center text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)] hover:opacity-90"
        >
          {t(account.connected ? "header.account" : "compte.signIn")}
        </Link>
      </div>
    </section>
  );
}
