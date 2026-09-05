/**
 * Grille de démarches.
 *
 * Reprend le contenu de carte de l'ancienne liste brute du portail (nom,
 * description, durée estimée) et ajoute la pastille « À la une » pour les
 * démarches épinglées par la collectivité. L'ordre et la classe de grille
 * viennent de `composition.ts`, pour rester testables sans rendu.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { DemarchesSection as DemarchesSectionData } from "@fn/_shared/domain/page.ts";
import { gridColumnsClass, orderDemarchesForSection } from "../composition.ts";

function DemarcheCard({ demarche, pinned }: { demarche: Demarche; pinned: boolean }) {
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
    </li>
  );
}

export function DemarchesSection({
  section,
  demarches,
  searchActive,
}: {
  section: DemarchesSectionData;
  /** Démarches déjà filtrées par la recherche (le cas échéant), non triées. */
  demarches: Demarche[];
  /** Une recherche non vide est en cours : le message « rien trouvé » en dépend. */
  searchActive: boolean;
}) {
  const pinnedSet = new Set(section.pinned);
  const ordered = orderDemarchesForSection(demarches, section.pinned, section.pinnedFirst);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-slate-900">{section.title}</h2>
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
          {searchActive
            ? "Aucune démarche ne correspond à votre recherche."
            : "Aucune démarche n'est proposée en ligne pour le moment."}
        </p>
      ) : (
        <ul className={"grid gap-3 " + gridColumnsClass(section.columns)}>
          {ordered.map((demarche) => (
            <DemarcheCard key={demarche.id} demarche={demarche} pinned={pinnedSet.has(demarche.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}
