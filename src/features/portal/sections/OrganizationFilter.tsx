/**
 * Le filtre par organisme : ne voir que les démarches qu'une commune ou un
 * service de la collectivité propose. `null` vaut « tous ».
 *
 * N'apparaît que s'il y a de quoi choisir : avec un seul organisme, il ne
 * filtrerait rien, et un sélecteur à une entrée est une question sans objet.
 */
import type { DemarcheOrganization } from "@fn/_shared/domain/demarche.ts";

export function OrganizationFilter({
  organizations,
  value,
  onChange,
}: {
  /** Les organismes qui proposent au moins une démarche, déjà ordonnés. */
  organizations: DemarcheOrganization[];
  value: string | null;
  onChange: (organizationId: string | null) => void;
}) {
  if (organizations.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="font-medium">Organisme</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className="h-9 max-w-[260px] rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 focus:border-[color:var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]"
      >
        <option value="">Tous les organismes</option>
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );
}
