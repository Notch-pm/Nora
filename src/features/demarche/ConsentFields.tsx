/**
 * « Vos consentements » — les deux cases RGPD, dans le bloc « Vos informations »
 * de CHAQUE démarche, quelle qu'elle soit.
 *
 * N'affiche que ce que `domain/consents.ts` décide : le catalogue, l'ordre,
 * l'obligation, les défauts. Le libellé de chaque case est la phrase EXACTE
 * qu'Iris consignera (voir le dictionnaire, `consent.traitement` et
 * `consent.partage`), le nom de la collectivité déjà dedans — c'est ce que
 * l'usager accepte, et c'est ce qui fait la preuve.
 *
 * ⚠️ RGAA : chaque case a son `<label>` réel (le texte entier est cliquable),
 * l'obligatoire est marqué comme les autres champs (astérisque + texte pour le
 * lecteur d'écran), et l'erreur est reliée à sa case par `aria-describedby`.
 */
import type { ConsentAnswers, ConsentKind } from "@fn/_shared/domain/consents.ts";
import { CONSENTS, consentErrorKey } from "@fn/_shared/domain/consents.ts";
import type { FieldErrors } from "@fn/_shared/domain/formulaire.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import type { StringKey } from "@/i18n/strings.ts";

const STATEMENT_KEYS: Record<ConsentKind, StringKey> = {
  traitement: "consent.traitement",
  partage: "consent.partage",
};

export function ConsentFields({
  answers,
  onChange,
  errors,
  organismName,
}: {
  answers: ConsentAnswers;
  onChange: (kind: ConsentKind, granted: boolean) => void;
  errors: FieldErrors;
  /** Le nom de la collectivité, interpolé dans la phrase du partage. */
  organismName: string;
}) {
  const { lang } = useLanguage();
  const t = useT();
  // Même repli qu'Iris (`DEFAULT_ORGANISM`) : une phrase à trou ne se signe pas.
  const organisme = organismName.trim() === "" ? t("consent.organismFallback") : organismName.trim();

  return (
    // Un groupe de cases est un `<fieldset>` à lui seul (RGAA 11.6) — imbriqué
    // dans celui de « Vos informations », ce que HTML permet : un lecteur
    // d'écran annonce alors « Vos consentements » en entrant dans une case.
    <fieldset className="min-w-0">
      <legend className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
        {t("consent.heading")}
      </legend>
      <div className="mt-1 flex flex-col gap-3">
        <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("consent.subtitle")}</p>
        {CONSENTS.map((def) => {
          const inputId = "consentement-" + def.kind;
          const error = errorText(lang, errors[consentErrorKey(def.kind)]);
          return (
            <div key={def.kind} className="flex flex-col gap-1.5">
              <label htmlFor={inputId} className="flex items-start gap-3 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                <input
                  id={inputId}
                  type="checkbox"
                  // ⚠️ Le contour tient 3 : 1 (`--pt-field-border`), comme les
                  // autres champs ; le focus se voit (RGAA 10.7).
                  className={
                    "mt-1 h-4 w-4 shrink-0 rounded border accent-[color:var(--brand-primary)] " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] focus-visible:ring-offset-2 " +
                    (error !== null ? "border-red-500" : "border-[color:var(--pt-field-border)]")
                  }
                  checked={answers[def.kind]}
                  aria-required={def.required}
                  aria-invalid={error !== null}
                  aria-describedby={error !== null ? inputId + "-erreur" : undefined}
                  onChange={(event) => onChange(def.kind, event.target.checked)}
                />
                <span>
                  {t(STATEMENT_KEYS[def.kind], { organisme })}
                  {def.required && (
                    <span className="ml-1 text-red-600" aria-hidden="true">
                      *
                    </span>
                  )}
                  {def.required && <span className="sr-only">{t("form.required")}</span>}
                </span>
              </label>
              {error !== null && (
                <p id={inputId + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
