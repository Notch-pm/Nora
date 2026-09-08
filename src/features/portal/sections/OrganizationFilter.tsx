/**
 * Le filtre par organisme : ne voir que les démarches qu'une commune ou un
 * service de la collectivité propose. `null` vaut « tous ».
 *
 * N'apparaît que s'il y a de quoi choisir : avec un seul organisme, il ne
 * filtrerait rien, et un sélecteur à une entrée est une question sans objet.
 */
import type { DemarcheOrganization } from "@fn/_shared/domain/demarche.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";

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
  const t = useT();
  if (organizations.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
      <span className="font-medium">{t("filter.organization")}</span>
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
        className="h-9 max-w-[260px] rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-2.5 text-[length:var(--pt-small)] text-[color:var(--pt-ink)] focus:border-[color:var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]"
      >
        <option value="">{t("filter.allOrganizations")}</option>
        {organizations.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );
}
