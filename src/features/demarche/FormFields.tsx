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

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-[color:var(--brand-primary)] focus:outline-none " +
  "focus:ring-2 focus:ring-[color:var(--brand-primary)]/30";

const invalidClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";

/**
 * Le dépôt de pièces n'existe pas encore côté traitement : le champ est montré
 * — l'usager doit savoir ce qui lui sera demandé — mais désactivé, et il ne
 * retient jamais l'envoi. Le cacher laisserait croire que la démarche ne
 * demande rien.
 */
function AttachmentNotice({ field }: { field: AttachmentField }) {
  const formats =
    field.acceptedFormats.length > 0
      ? "Formats acceptés : " + field.acceptedFormats.map((f) => f.toUpperCase()).join(", ")
      : "Tous formats acceptés";
  const files = field.maxFiles > 1 ? field.maxFiles + " fichiers maximum" : "1 fichier maximum";

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3">
      <p className="text-sm text-slate-600">
        Cette pièce vous sera demandée après le dépôt de votre demande.
      </p>
      <p className="mt-1 text-xs text-slate-500">
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
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input
              {...shared}
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-[color:var(--brand-primary)]"
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            <span>Oui</span>
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
            <option value="">Choisissez…</option>
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
              <label key={option.value} className="flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="radio"
                  name={inputId}
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => onChange(option.value)}
                  className="h-4 w-4 border-slate-300 accent-[color:var(--brand-primary)]"
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
              <label key={option.value} className="flex items-center gap-2 text-sm text-slate-800">
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
                  className="h-4 w-4 rounded border-slate-300 accent-[color:var(--brand-primary)]"
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
        className="text-sm font-semibold text-slate-900"
      >
        {field.label}
        {required && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (obligatoire)</span>}
      </Label>
      {field.help && (
        <p id={inputId + "-aide"} className="text-xs text-slate-500">
          {field.help}
        </p>
      )}
      {control}
      {error !== null && (
        <p id={inputId + "-erreur"} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
