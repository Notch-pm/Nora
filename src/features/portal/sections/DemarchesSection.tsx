/**
 * Grille de démarches.
 *
 * Une carte par démarche (`DemarcheCard`), la pastille « À la une » pour les
 * démarches épinglées par la collectivité, et les filtres dans l'en-tête :
 * « Je suis… » quand la collectivité l'a demandé, et l'organisme. Ils se
 * **cumulent** — deux dimensions de la même liste, qui je suis et à qui je
 * m'adresse. L'ordre, la classe de grille, les filtres et le message d'absence
 * viennent de `composition.ts`, pour rester testables sans rendu.
 */
import type { Demarche, DemarcheOrganization } from "@fn/_shared/domain/demarche.ts";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import type { DemarchesSection as DemarchesSectionData } from "@fn/_shared/domain/page.ts";
import { emptyDemarchesKey, gridColumnsClass, orderDemarchesForSection } from "../composition.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";
import { AudienceFilter } from "./AudienceFilter.tsx";
import { DemarcheCard } from "./DemarcheCard.tsx";
import { OrganizationFilter } from "./OrganizationFilter.tsx";

export function DemarchesSection({
  section,
  demarches,
  organizations,
  organizationId,
  onOrganizationChange,
  audiences,
  audience,
  onAudienceChange,
  searchActive,
}: {
  section: DemarchesSectionData;
  /** Démarches déjà filtrées par la recherche, l'organisme et le public, non triées. */
  demarches: Demarche[];
  /** Les organismes qui proposent au moins une démarche du catalogue complet. */
  organizations: DemarcheOrganization[];
  /** Organisme sélectionné, `null` = tous. Possédé par la page : il vaut pour toutes les grilles. */
  organizationId: string | null;
  onOrganizationChange: (organizationId: string | null) => void;
  /** Les publics visés par au moins une démarche du catalogue complet. */
  audiences: Audience[];
  /** Public sélectionné, `null` = peu importe. Possédé par la page, comme l'organisme. */
  audience: Audience | null;
  onAudienceChange: (audience: Audience | null) => void;
  /** Une recherche non vide est en cours : le message « rien trouvé » en dépend. */
  searchActive: boolean;
}) {
  const t = useT();
  const pinnedSet = new Set(section.pinned);
  const ordered = orderDemarchesForSection(demarches, section.pinned, section.pinnedFirst);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">
          {section.title}
        </h2>
        {/* Les deux filtres se rangent côte à côte : ils réduisent la même
            grille, chacun sur sa dimension. « Je suis… » n'apparaît que si la
            collectivité l'a demandé sur CETTE grille. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {section.audienceFilter ? (
            <AudienceFilter audiences={audiences} value={audience} onChange={onAudienceChange} />
          ) : null}
          <OrganizationFilter
            organizations={organizations}
            value={organizationId}
            onChange={onOrganizationChange}
          />
        </div>
      </div>
      {ordered.length === 0 ? (
        <p className="rounded-[var(--pt-radius-sm)] border border-dashed border-[color:var(--pt-border)] py-6 text-center text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
          {t(emptyDemarchesKey(searchActive, organizationId, audience))}
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
