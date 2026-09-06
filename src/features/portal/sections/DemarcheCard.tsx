/**
 * La carte d'une démarche : nom, texte public, durée estimée, et les
 * organismes qui la proposent. Partagée par la grille de la page composée et
 * par la liste de repli — une démarche se présente de la même façon partout.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";

export function DemarcheCard({ demarche, pinned = false }: { demarche: Demarche; pinned?: boolean }) {
  return (
    <li
      className={
        "flex flex-col gap-2 rounded-xl border p-4 " +
        (pinned
          ? "border-[color:var(--brand-primary)] bg-[color:color-mix(in_srgb,var(--brand-primary)_6%,white)]"
          : "border-slate-200")
      }
    >
      {pinned && (
        <span className="w-fit rounded-full bg-[color:var(--brand-secondary)] px-2 py-0.5 text-[10.5px] font-extrabold text-slate-900">
          À la une
        </span>
      )}
      <h3 className="font-medium text-slate-900">{demarche.name}</h3>
      {demarche.description !== null && (
        <p className="text-sm text-slate-600">{demarche.description}</p>
      )}
      {demarche.estimatedMinutes !== null && (
        <p className="text-xs text-slate-500">Environ {demarche.estimatedMinutes} minutes</p>
      )}
      {demarche.organizations.length > 0 && (
        <ul
          className="mt-auto flex flex-wrap gap-1 pt-1"
          aria-label="Organismes proposant cette démarche"
        >
          {demarche.organizations.map((org) => (
            <li
              key={org.id}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"
            >
              {org.name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
