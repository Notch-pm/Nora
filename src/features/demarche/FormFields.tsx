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
import { useState, type ReactNode } from "react";
import type { AttachmentField, Field, FieldOption } from "@fn/_shared/domain/formSchema.ts";
import { useT, useTn } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import { uploadPiece, type PieceUploadFailure } from "@/services/portal/portalClient.ts";
import { piecesOf, type UploadedPiece } from "@fn/_shared/domain/formulaire.ts";

// ⚠️ Le contour d'un champ de saisie tient 3 : 1 (RGAA 3.3) — `--pt-field-border`,
// pas `--pt-border` (1,24 : 1, réservé aux cartes et séparateurs décoratifs).
const inputClass =
  "w-full rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-field-border)] bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] " +
  "placeholder:text-[color:var(--pt-muted)] focus:border-[color:var(--brand-primary)] focus:outline-none " +
  "focus:ring-2 focus:ring-[color:var(--brand-primary)]/30";

const invalidClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";

/** Ce que l'écran dit d'un fichier refusé — le code vient du serveur, la phrase d'ici. */
const PIECE_FAILURE_KEYS: Record<PieceUploadFailure, StringKey> = {
  piece_too_large: "form.piece.tooLarge",
  piece_unsupported: "form.piece.unsupported",
  piece_rejected: "form.piece.unsupported",
  too_many_uploads: "form.piece.failed",
  iris_unavailable: "form.piece.failed",
  iris_misconfigured: "form.piece.failed",
  not_configured: "form.piece.failed",
  network: "form.piece.failed",
};

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1).replace(/\.0$/, "") + " Mo";
  if (bytes >= 1024) return Math.round(bytes / 1024) + " Ko";
  return bytes + " o";
}

/**
 * Le dépôt d'une pièce (2026-09-08). Le fichier part DÈS sa sélection vers
 * `portal-api`, qui le remet à Iris : Iris vérifie le contenu réel (formats
 * fermés, extension, taille) et le garde en attente de la demande. Le
 * formulaire ne retient qu'un identifiant — aucun fichier ne traîne dans le
 * navigateur, et un rejeu du dépôt réutilise les mêmes identifiants.
 *
 * Le nombre de fichiers est borné par la démarche ; les formats annoncés sont
 * un confort (`accept`), la vérification est celle d'Iris.
 */
function AttachmentInput({
  field,
  value,
  onChange,
  inputId,
  demarcheId,
  invalid,
  describedBy,
}: {
  field: AttachmentField;
  value: unknown;
  onChange: (value: UploadedPiece[]) => void;
  inputId: string;
  demarcheId: string | null;
  invalid: boolean;
  /** L'aide et l'erreur du champ, comme pour tout autre contrôle (RGAA 11.10). */
  describedBy: string | undefined;
}) {
  const t = useT();
  const tn = useTn();
  const pieces = piecesOf(value);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const full = pieces.length >= field.maxFiles;
  const accept = field.acceptedFormats.map((f) => "." + f).join(",");
  const formats =
    field.acceptedFormats.length > 0
      ? t("form.formats", { formats: field.acceptedFormats.map((f) => f.toUpperCase()).join(", ") })
      : t("form.allFormats");

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0 || demarcheId === null) return;
    setUploadError(null);
    setBusy(true);
    let next = [...pieces];
    for (const file of Array.from(list)) {
      if (next.length >= field.maxFiles) {
        setUploadError(t("form.piece.tooMany", { n: field.maxFiles }));
        break;
      }
      const result = await uploadPiece(file, { demarcheId, fieldId: field.id });
      if (!result.ok) {
        setUploadError(t(PIECE_FAILURE_KEYS[result.reason], { name: file.name }));
        break;
      }
      next = [...next, { uploadId: result.piece.uploadId, name: result.piece.fileName || file.name, size: result.piece.sizeBytes }];
      onChange(next);
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {pieces.length > 0 && (
        <ul className="flex flex-col gap-1">
          {pieces.map((piece) => (
            <li
              key={piece.uploadId}
              className="flex items-center justify-between gap-3 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-3 py-2 text-[length:var(--pt-body)]"
            >
              <span className="min-w-0 truncate text-[color:var(--pt-ink)]">
                {piece.name}
                <span className="ml-2 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{formatSize(piece.size)}</span>
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChange(pieces.filter((p) => p.uploadId !== piece.uploadId))}
                aria-label={t("form.removeFile", { name: piece.name })}
                className="shrink-0 text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline disabled:opacity-50"
              >
                {t("form.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <label
          className={
            "flex cursor-pointer flex-col gap-1 rounded-[var(--pt-radius-sm)] border border-dashed px-3 py-3 " +
            (invalid ? "border-red-500 " : "border-[color:var(--pt-field-border)] ") +
            "bg-[color:var(--pt-surface)] hover:border-[color:var(--brand-primary)] " +
            // ⚠️ Le contrôle réel (l'input file) est en `sr-only` : c'est cette
            // zone qui doit montrer le focus (RGAA 10.7), via `:has()` — sans
            // lui, atteindre le dépôt au clavier ne se voyait pas.
            "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color:var(--brand-primary)]"
          }
        >
          <span className="text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)]">
            {busy ? t("form.uploading") : t("form.chooseFile")}
          </span>
          <span className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
            {formats} · {tn("form.maxFiles", field.maxFiles)}
          </span>
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept={accept === "" ? undefined : accept}
            multiple={field.maxFiles > 1}
            disabled={busy || demarcheId === null}
            aria-invalid={invalid}
            // ⚠️ Sans lui, le dépôt annonçait « invalide » sans dire pourquoi :
            // son message d'erreur n'était relié à rien — le défaut du relevé
            // RGAA sur les groupes, retrouvé ici au contrôle réel dans Chrome
            // (2026-09-18, « Acte de mariage »).
            aria-describedby={describedBy}
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      )}
      {uploadError !== null && (
        <p role="alert" className="text-[length:var(--pt-body)] text-red-600">{uploadError}</p>
      )}
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
  demarcheId = null,
  badge = null,
  note = null,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  required: boolean;
  error: string | null;
  /** La démarche remplie — nécessaire au dépôt d'une pièce (revérifiée serveur). */
  demarcheId?: string | null;
  /**
   * D'où vient la valeur — « d'après votre message », « déduit, à confirmer ».
   * Posé DANS le libellé, donc lu avec lui : un badge qui ne reposerait que sur
   * sa couleur ne dirait rien à qui ne la voit pas (RGAA 3.1).
   * ⚠️ Rendu par l'assistant SEUL : le formulaire classique n'en pose jamais.
   */
  badge?: ReactNode;
  /**
   * La citation source ou la justification de la déduction, sous le contrôle.
   * Rattachée au champ par `aria-describedby` : sans cela, l'usager non-voyant
   * entend une valeur sans savoir qu'elle a été déduite.
   */
  note?: ReactNode;
}) {
  const t = useT();
  const inputId = "champ-" + field.id;
  const describedBy = [
    field.help ? inputId + "-aide" : null,
    note !== null ? inputId + "-origine" : null,
    error ? inputId + "-erreur" : null,
  ]
    .filter((id) => id !== null)
    .join(" ");
  // ⚠️ `undefined`, pas `""` : un `aria-describedby` vide reste un attribut
  // posé, que certains lecteurs d'écran annoncent comme une description
  // absente plutôt que comme son absence.
  const describedByAttr = describedBy === "" ? undefined : describedBy;
  const controlClass = inputClass + (error !== null ? " " + invalidClass : "");
  const shared = {
    id: inputId,
    "aria-invalid": error !== null,
    "aria-describedby": describedByAttr,
    className: controlClass,
  };

  const control = (() => {
    switch (field.type) {
      case "attachment":
        return (
          <AttachmentInput
            field={field}
            value={value}
            onChange={onChange}
            inputId={inputId}
            demarcheId={demarcheId}
            invalid={error !== null}
            describedBy={describedByAttr}
          />
        );
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
          // ⚠️ RGAA 11.10 : le groupe ET chaque bouton portent l'aide/erreur
          // et l'invalidité — pas seulement le groupe. Un lecteur d'écran qui
          // atterrit directement sur UN bouton (navigation par formulaire,
          // lien du résumé) doit entendre l'erreur sans être remonté au
          // groupe. `aria-invalid` est valide sur `radiogroup` (contrairement
          // à `group`, voir `checkboxes` ci-dessous) : posé aux deux niveaux.
          <div
            role="radiogroup"
            aria-labelledby={inputId + "-libelle"}
            aria-describedby={describedByAttr}
            aria-invalid={error !== null}
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
                  aria-describedby={describedByAttr}
                  aria-invalid={error !== null}
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
          // ⚠️ Même correction que `radio`, MOINS `aria-invalid` sur le
          // conteneur : le rôle `group` ne le supporte pas (contrairement à
          // `radiogroup`) — seule chaque case le porte. C'était le trou
          // précis du relevé RGAA du 2026-09-15 : une case à cocher affichait
          // son erreur sans qu'aucun attribut n'y renvoie, la seule des cinq
          // erreurs qu'un lecteur d'écran ne retrouvait pas.
          <div
            role="group"
            aria-labelledby={inputId + "-libelle"}
            aria-describedby={describedByAttr}
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
                  aria-describedby={describedByAttr}
                  aria-invalid={error !== null}
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
        {badge}
      </Label>
      {field.help && (
        <p id={inputId + "-aide"} className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {field.help}
        </p>
      )}
      {control}
      {note !== null && (
        <div id={inputId + "-origine"} className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {note}
        </div>
      )}
      {error !== null && (
        <p id={inputId + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
