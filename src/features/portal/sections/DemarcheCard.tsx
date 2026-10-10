/**
 * La carte d'une démarche : le pictogramme de sa catégorie (et la pastille
 * « À la une »), la catégorie, le nom, le texte public, les organismes qui la
 * proposent, puis en pied la durée estimée et la flèche. Partagée par la
 * grille de la page composée et par la liste de repli — une démarche se
 * présente de la même façon partout.
 *
 * La carte entière mène à la démarche : le lien porte son intitulé (c'est lui
 * qu'annonce un lecteur d'écran) et s'étend au bloc par `after:inset-0`, pour
 * que la cible au doigt soit la carte et non trois mots.
 */
import { Link } from "react-router-dom";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import { organizationChips } from "../composition.ts";
import { CategoryIcon } from "../CategoryIcon.tsx";

import type { Demarche } from "@fn/_shared/domain/demarche.ts";

export function DemarcheCard({
  demarche,
  pinned = false,
  basePath = "/demarches",
}: {
  demarche: Demarche;
  pinned?: boolean;
  /**
   * La base du lien vers la démarche. Par défaut `/demarches` — le chemin
   * général du portail. La page d'un organisme y passe `/{slug}/demarches`
   * pour qu'une démarche commencée depuis elle reste sous le préfixe de cet
   * organisme, jamais sous l'adresse générale de la collectivité.
   */
  basePath?: string;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const tn = useTn();
  const chips = organizationChips(demarche.organizations);
  return (
    <li className="relative flex flex-col gap-2 rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] bg-white p-[var(--pt-card-pad)] shadow-[var(--pt-shadow)] transition hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-[var(--pt-radius-sm)] text-[color:var(--pt-primary)]"
          style={{ background: "var(--pt-primary-soft)" }}
        >
          <CategoryIcon icon={demarche.category?.icon ?? null} />
        </span>
        {pinned && (
          <span className="flex items-center gap-1 whitespace-nowrap rounded-full bg-[color:var(--pt-accent)] px-2 py-0.5 text-[length:var(--pt-tiny)] font-extrabold text-[color:var(--pt-accent-ink)]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" />
            </svg>
            {t("card.pinned")}
          </span>
        )}
      </div>
      {demarche.category !== null && (
        <p className="text-[length:var(--pt-tiny)] font-bold uppercase tracking-wide text-[color:var(--pt-muted)]">
          {demarche.category.name}
        </p>
      )}
      <h3 className="text-[length:var(--pt-body)] font-bold leading-tight text-[color:var(--pt-ink)]">
        <Link
          to={localizedPath(lang, basePath + "/" + encodeURIComponent(demarche.id))}
          className="after:absolute after:inset-0 hover:underline focus-visible:underline"
        >
          {demarche.name}
        </Link>
      </h3>
      {demarche.description !== null && (
        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{demarche.description}</p>
      )}
      {demarche.organizations.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={t("card.organizations")}>
          {chips.kind === "compte" ? (
            <li className="rounded-full bg-[color:var(--pt-surface)] px-2 py-0.5 text-[length:var(--pt-tiny)] font-semibold text-[color:var(--pt-muted)]">
              {tn("card.organizationsCount", chips.count, { n: chips.count })}
            </li>
          ) : (
            chips.organizations.map((org) => (
              <li
                key={org.id}
                className="rounded-full bg-[color:var(--pt-surface)] px-2 py-0.5 text-[length:var(--pt-tiny)] font-semibold text-[color:var(--pt-muted)]"
              >
                {org.name}
              </li>
            ))
          )}
        </ul>
      )}
      {/* Le pied : la durée à gauche, la flèche à droite. La flèche est un
          signe, pas un second lien — c'est la carte entière qui mène à la
          démarche (le lien du titre s'étend au bloc). */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[color:var(--pt-border)] pt-3">
        {demarche.estimatedMinutes !== null ? (
          <p className="flex items-center gap-1.5 text-[length:var(--pt-tiny)] text-[color:var(--pt-muted)]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {t("card.duration", { n: demarche.estimatedMinutes })}
          </p>
        ) : (
          <span />
        )}
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--pt-primary)] text-[color:var(--pt-on-primary)]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </span>
      </div>
    </li>
  );
}
