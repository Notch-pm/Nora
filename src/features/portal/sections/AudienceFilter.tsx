/**
 * Le filtre « Je suis… » : ne voir que les démarches ouvertes à son cas —
 * citoyen, entreprise, association. `null` vaut « peu importe ».
 *
 * Il se **cumule** avec le filtre par organisme, il ne le remplace pas : deux
 * dimensions de la même liste — qui je suis, et à qui je m'adresse.
 *
 * N'apparaît que s'il y a de quoi choisir : quand toutes les démarches visent
 * le même public, il ne filtrerait rien, et un sélecteur à une entrée est une
 * question sans objet. Même règle que `OrganizationFilter`.
 */
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";

/** Le mot de chaque public dans le sélecteur — traduit comme le reste de l'outil. */
const AUDIENCE_KEY: Record<Audience, StringKey> = {
  citoyen: "audience.citoyen",
  entreprise: "audience.entreprise",
  association: "audience.association",
};

export function AudienceFilter({
  audiences,
  value,
  onChange,
}: {
  /** Les publics visés par au moins une démarche du catalogue, déjà ordonnés. */
  audiences: Audience[];
  value: Audience | null;
  onChange: (audience: Audience | null) => void;
}) {
  const t = useT();
  if (audiences.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      <span className="font-medium">{t("filter.audience")}</span>
      <select
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : (event.target.value as Audience))
        }
        className="h-9 max-w-[260px] rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 focus:border-[color:var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]"
      >
        <option value="">{t("filter.allAudiences")}</option>
        {audiences.map((audience) => (
          <option key={audience} value={audience}>
            {t(AUDIENCE_KEY[audience])}
          </option>
        ))}
      </select>
    </label>
  );
}
