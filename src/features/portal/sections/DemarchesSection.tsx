/**
 * Grille de démarches.
 *
 * Une carte par démarche (`DemarcheCard`), la pastille « À la une » pour les
 * démarches épinglées par la collectivité, et le filtre par organisme dans
 * l'en-tête. L'ordre, la classe de grille, le filtre et le message d'absence
 * viennent de `composition.ts`, pour rester testables sans rendu.
 */
import type { Demarche, DemarcheOrganization } from "@fn/_shared/domain/demarche.ts";
import type { DemarchesSection as DemarchesSectionData } from "@fn/_shared/domain/page.ts";
import { emptyDemarchesMessage, gridColumnsClass, orderDemarchesForSection } from "../composition.ts";
import { DemarcheCard } from "./DemarcheCard.tsx";
import { OrganizationFilter } from "./OrganizationFilter.tsx";

export function DemarchesSection({
  section,
  demarches,
  organizations,
  organizationId,
  onOrganizationChange,
  searchActive,
}: {
  section: DemarchesSectionData;
  /** Démarches déjà filtrées par la recherche et l'organisme (le cas échéant), non triées. */
  demarches: Demarche[];
  /** Les organismes qui proposent au moins une démarche du catalogue complet. */
  organizations: DemarcheOrganization[];
  /** Organisme sélectionné, `null` = tous. Possédé par la page : il vaut pour toutes les grilles. */
  organizationId: string | null;
  onOrganizationChange: (organizationId: string | null) => void;
  /** Une recherche non vide est en cours : le message « rien trouvé » en dépend. */
  searchActive: boolean;
}) {
  const pinnedSet = new Set(section.pinned);
  const ordered = orderDemarchesForSection(demarches, section.pinned, section.pinnedFirst);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{section.title}</h2>
        <OrganizationFilter
          organizations={organizations}
          value={organizationId}
          onChange={onOrganizationChange}
        />
      </div>
      {ordered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500">
          {emptyDemarchesMessage(searchActive, organizationId)}
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
