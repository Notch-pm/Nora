/**
 * La carte d'une démarche : nom, texte public, durée estimée, et les
 * organismes qui la proposent. Partagée par la grille de la page composée et
 * par la liste de repli — une démarche se présente de la même façon partout.
 *
 * La carte entière mène à la démarche : le lien porte son intitulé (c'est lui
 * qu'annonce un lecteur d'écran) et s'étend au bloc par `after:inset-0`, pour
 * que la cible au doigt soit la carte et non trois mots.
 */
import { Link } from "react-router-dom";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";

import type { Demarche } from "@fn/_shared/domain/demarche.ts";

export function DemarcheCard({ demarche, pinned = false }: { demarche: Demarche; pinned?: boolean }) {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <li
      style={pinned ? { background: "var(--pt-primary-soft)" } : undefined}
      className={
        "relative flex flex-col gap-2 rounded-[var(--pt-radius)] border p-[var(--pt-card-pad)] shadow-[var(--pt-shadow)] transition hover:shadow-md " +
        (pinned ? "border-[color:var(--pt-primary)]" : "border-[color:var(--pt-border)] bg-white")
      }
    >
      {pinned && (
        <span className="w-fit rounded-full bg-[color:var(--pt-accent)] px-2 py-0.5 text-[length:var(--pt-tiny)] font-extrabold text-[color:var(--pt-accent-ink)]">
          {t("card.pinned")}
        </span>
      )}
      <h3 className="text-[length:var(--pt-body)] font-bold leading-tight text-[color:var(--pt-ink)]">
        <Link
          to={localizedPath(lang, "/demarches/" + encodeURIComponent(demarche.id))}
          className="after:absolute after:inset-0 hover:underline focus-visible:underline"
        >
          {demarche.name}
        </Link>
      </h3>
      {demarche.description !== null && (
        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{demarche.description}</p>
      )}
      {demarche.estimatedMinutes !== null && (
        <p className="text-[length:var(--pt-tiny)] text-[color:var(--pt-muted)]">
          {t("card.duration", { n: demarche.estimatedMinutes })}
        </p>
      )}
      {demarche.organizations.length > 0 && (
        <ul
          className="mt-auto flex flex-wrap gap-1 pt-1"
          aria-label={t("card.organizations")}
        >
          {demarche.organizations.map((org) => (
            <li
              key={org.id}
              className="rounded-full bg-[color:var(--pt-surface)] px-2 py-0.5 text-[length:var(--pt-tiny)] font-semibold text-[color:var(--pt-muted)]"
            >
              {org.name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
