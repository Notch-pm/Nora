/**
 * Le rendu d'un champ de formulaire, type par type.
 *
 * Implémentation de référence côté usager du schéma possédé par le Socle —
 * l'équivalent de son `FormPreview`, avec une différence : ici la saisie est
 * réelle, donc elle est validée et elle part dans une demande.
 *
 * Rien de ce qui se décide n'est ici : ce qui est visible, obligatoire, valide
 * ou déposé vient de `formulaire.ts`. Ce fichier ne fait qu'afficher.
 */
import type { AttachmentField, Field, FieldOption } from "@fn/_shared/domain/formSchema.ts";
import { useT, useTn } from "@/i18n/LanguageLayout.tsx";

const inputClass =
  "w-full rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] " +
  "placeholder:text-[color:var(--pt-muted)] focus:border-[color:var(--brand-primary)] focus:outline-none " +
  "focus:ring-2 focus:ring-[color:var(--brand-primary)]/30";

const invalidClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";

/**
 * Le dépôt de pièces n'existe pas encore côté traitement : le champ est montré
 * — l'usager doit savoir ce qui lui sera demandé — mais désactivé, et il ne
 * retient jamais l'envoi. Le cacher laisserait croire que la démarche ne
 * demande rien.
 */
function AttachmentNotice({ field }: { field: AttachmentField }) {
  const t = useT();
  const tn = useTn();
  const formats =
    field.acceptedFormats.length > 0
      ? t("form.formats", { formats: field.acceptedFormats.map((f) => f.toUpperCase()).join(", ") })
      : t("form.allFormats");
  const files = tn("form.maxFiles", field.maxFiles);

  return (
    <div className="rounded-[var(--pt-radius-sm)] border border-dashed border-[color:var(--pt-border)] bg-[color:var(--pt-surface)] px-3 py-3">
      <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("form.attachmentLater")}</p>
      <p className="mt-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {formats} · {files}
      </p>
    </div>
  );
}

function Options({ options }: { options: FieldOption[] }) {
  return (
    <>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  );
}

export function FormFieldControl({
  field,
  value,
  onChange,
  required,
  error,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  required: boolean;
  error: string | null;
}) {
  const t = useT();
  const inputId = "champ-" + field.id;
  const describedBy = [field.help ? inputId + "-aide" : null, error ? inputId + "-erreur" : null]
    .filter((id) => id !== null)
    .join(" ");
  const controlClass = inputClass + (error !== null ? " " + invalidClass : "");
  const shared = {
    id: inputId,
    "aria-invalid": error !== null,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    className: controlClass,
  };

  const control = (() => {
    switch (field.type) {
      case "attachment":
        return <AttachmentNotice field={field} />;
      case "textarea":
        return (
          <textarea
            {...shared}
            rows={4}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "boolean":
        return (
          <label className="flex items-center gap-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            <input
              {...shared}
              type="checkbox"
              className="h-4 w-4 rounded border-[color:var(--pt-border)] accent-[color:var(--brand-primary)]"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            <span>{t("form.yes")}</span>
          </label>
        );
      case "select":
        return (
          <select
            {...shared}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(event.target.value)}
          >
            {/* Une liste obligatoire commence sans réponse : préselectionner le
                premier choix ferait répondre l'usager à sa place. */}
            <option value="">{t("form.choose")}</option>
            <Options options={field.options} />
          </select>
        );
      case "radio":
        return (
          <div
            role="radiogroup"
            aria-labelledby={inputId + "-libelle"}
            className="flex flex-col gap-1.5"
          >
            {field.options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                <input
                  type="radio"
                  name={inputId}
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => onChange(option.value)}
                  className="h-4 w-4 border-[color:var(--pt-border)] accent-[color:var(--brand-primary)]"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        );
      case "checkboxes": {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div
            role="group"
            aria-labelledby={inputId + "-libelle"}
            className="flex flex-col gap-1.5"
          >
            {field.options.map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value),
                    )
                  }
                  className="h-4 w-4 rounded border-[color:var(--pt-border)] accent-[color:var(--brand-primary)]"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        );
      }
      default: {
        const types: Record<string, string> = {
          text: "text",
          number: "number",
          date: "date",
          email: "email",
          phone: "tel",
        };
        return (
          <input
            {...shared}
            type={types[field.type] ?? "text"}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            maxLength={"maxLength" in field ? field.maxLength : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      }
    }
  })();

  // Les groupes (radio, cases à cocher) n'ont pas de contrôle unique à
  // étiqueter : leur libellé est un texte, référencé par `aria-labelledby`.
  const isGroup = field.type === "radio" || field.type === "checkboxes";
  const Label = isGroup ? "p" : "label";

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        id={inputId + "-libelle"}
        {...(isGroup ? {} : { htmlFor: inputId })}
        className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]"
      >
        {field.label}
        {required && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only">{t("form.required")}</span>}
      </Label>
      {field.help && (
        <p id={inputId + "-aide"} className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {field.help}
        </p>
      )}
      {control}
      {error !== null && (
        <p id={inputId + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
