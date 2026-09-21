/**
 * « Vos informations » — l'identité du requérant, telle que la collectivité l'a
 * demandée.
 *
 * Le portail n'invente aucune question : les publics proposés et les champs
 * affichés viennent tous de `requester_config`, paramétré au Socle. Quand la
 * collectivité n'a ouvert aucun public, ce bloc ne s'affiche pas et la demande
 * part sans identité — l'anonymat devient alors un choix assumé de la
 * collectivité, pas un oubli du portail.
 *
 * Les clés (`courriel`, `nom_usuel`, `siret`…) sont celles du Socle et partent
 * telles quelles : Iris les rapproche du référentiel usagers sans traduction.
 */
import type { Audience, RequesterField } from "@fn/_shared/domain/requesterConfig.ts";
import { AUDIENCES } from "@fn/_shared/domain/requesterConfig.ts";
import type { FieldErrors } from "@fn/_shared/domain/formulaire.ts";
import { autocompleteFor } from "./autocomplete.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import type { StringKey } from "@/i18n/strings.ts";

// ⚠️ Le contour d'un champ de saisie tient 3 : 1 (RGAA 3.3) — `--pt-field-border`,
// pas `--pt-border` (1,24 : 1, réservé aux cartes et séparateurs décoratifs).
const inputClass =
  "w-full rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-field-border)] bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] " +
  "focus:border-[color:var(--brand-primary)] focus:outline-none " +
  "focus:ring-2 focus:ring-[color:var(--brand-primary)]/30";

const invalidClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";

/**
 * Les civilités telles que le Socle les STOCKE — minuscules, deux valeurs.
 *
 * ⚠️ La VALEUR part au Socle et à Iris : elle ne se traduit jamais. Seule
 * l'étiquette lue par l'usager change de langue.
 */
const CIVILITES: { value: string; key: StringKey }[] = [
  { value: "madame", key: "requester.madame" },
  { value: "monsieur", key: "requester.monsieur" },
];

const INPUT_TYPES: Record<string, string> = {
  courriel: "email",
  tel_portable: "tel",
  tel_fixe: "tel",
};

function RequesterInput({
  field,
  value,
  onChange,
  error,
}: {
  field: RequesterField;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  const t = useT();
  const inputId = "requerant-" + field.key;
  const className = inputClass + (error !== null ? " " + invalidClass : "");
  const describedBy = error !== null ? inputId + "-erreur" : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
        {field.label}
        {field.required && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {field.required && <span className="sr-only">{t("form.required")}</span>}
      </label>
      {field.key === "civilite" ? (
        <select
          id={inputId}
          className={className}
          value={value}
          autoComplete={autocompleteFor(field.key)}
          aria-invalid={error !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t("form.choose")}</option>
          {CIVILITES.map((civilite) => (
            <option key={civilite.value} value={civilite.value}>
              {t(civilite.key)}
            </option>
          ))}
        </select>
      ) : field.key === "adresse" ? (
        <textarea
          id={inputId}
          rows={2}
          className={className}
          value={value}
          autoComplete={autocompleteFor(field.key)}
          aria-invalid={error !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={inputId}
          type={INPUT_TYPES[field.key] ?? "text"}
          className={className}
          value={value}
          autoComplete={autocompleteFor(field.key)}
          aria-invalid={error !== null}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error !== null && (
        <p id={inputId + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function RequesterSection({
  audiences,
  audience,
  onAudienceChange,
  fields,
  values,
  onChange,
  errors,
  dense = false,
}: {
  /** Les publics ouverts par la collectivité. Au moins un, sinon rien n'est rendu. */
  audiences: Audience[];
  audience: Audience;
  onAudienceChange: (audience: Audience) => void;
  fields: RequesterField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors: FieldErrors;
  /** Une seule colonne de champs — pour un conteneur étroit (le panneau de la bulle). */
  dense?: boolean;
}) {
  const { lang } = useLanguage();
  const t = useT();
  if (audiences.length === 0) return null;

  return (
    // ⚠️ `<fieldset>` / `<legend>` réels (RGAA 11.6), pas un `<section>` avec un
    // titre décoratif : un lecteur d'écran qui entre dans un champ annonce
    // alors « Vos informations » avant son étiquette. Le `<legend>` DOIT être
    // l'enfant direct du `<fieldset>` — le sous-titre passe donc dans un
    // conteneur séparé, avec un `mt-1` qui reproduit l'espacement qu'il avait
    // avec le titre quand les deux vivaient dans le même bloc.
    //
    // ⚠️ LE CADRE EST SUR UN `<div>` AUTOUR, PAS SUR LE `<fieldset>`. Un
    // `fieldset` bordé fait passer sa `legend` DANS le trait (l'entaille
    // native), et le titre du bloc se retrouvait à cheval sur le contour. Sans
    // bordure, la `legend` est une ligne comme une autre. `min-w-0` : un
    // `fieldset` refuse par défaut de rétrécir sous son contenu, et la grille
    // des champs déborderait sur un téléphone.
    <div className="rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] p-5">
    <fieldset className="min-w-0">
      <legend className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">
        {t("requester.title")}
      </legend>
      <div className="mt-1 flex flex-col gap-4">
        <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("requester.subtitle")}</p>

        {/* Un seul public ouvert : pas de question à poser, la réponse est faite. */}
        {audiences.length > 1 && (
          <div role="radiogroup" aria-label={t("requester.audience")} className="flex flex-wrap gap-2">
            {AUDIENCES.filter((candidate) => audiences.includes(candidate.key)).map((candidate) => {
              const active = candidate.key === audience;
              return (
                <label
                  key={candidate.key}
                  className={
                    "cursor-pointer rounded-full border px-3.5 py-1.5 text-[length:var(--pt-body)] font-semibold " +
                    // ⚠️ Le contrôle réel est en `sr-only` : c'est ce `<label>`
                    // qui doit montrer le focus (RGAA 10.7), via `:has()` sur
                    // son radio caché — sans lui, tabuler jusqu'à une pilule
                    // ne se voyait pas.
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color:var(--brand-primary)] has-[:focus-visible]:ring-offset-2 " +
                    (active
                      ? "border-[color:var(--brand-primary)] bg-[color:color-mix(in_srgb,var(--brand-primary)_10%,white)] text-[color:var(--brand-primary)]"
                      : "border-[color:var(--pt-border)] text-[color:var(--pt-muted)]")
                  }
                >
                  <input
                    type="radio"
                    name="public-requerant"
                    className="sr-only"
                    checked={active}
                    onChange={() => onAudienceChange(candidate.key)}
                  />
                  {candidate.label}
                </label>
              );
            })}
          </div>
        )}

        {fields.length === 0 ? (
          // Public ouvert, mais tous les champs masqués : la collectivité ne
          // demande rien de plus. Le dire vaut mieux qu'un cadre vide.
          <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("requester.none")}</p>
        ) : (
          // ⚠️ `sm:` se règle sur la largeur de la FENÊTRE, pas du conteneur :
          // dans le panneau étroit de la bulle, sur un grand écran, deux
          // colonnes se serreraient sans raison. `dense` les refuse.
          <div className={dense ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
            {fields.map((field) => (
              <RequesterInput
                key={field.key}
                field={field}
                value={values[field.key] ?? ""}
                onChange={(value) => onChange(field.key, value)}
                error={errorText(lang, errors[field.key])}
              />
            ))}
          </div>
        )}
      </div>
    </fieldset>
    </div>
  );
}
