/**
 * Les cartes du recueil — le formulaire d'une démarche rempli DANS le fil.
 * N'AFFICHE QUE : toute règle (étape, purge, récapitulatif) vit dans
 * `collect.ts` / `recap.ts`, testés là. Chaque carte est une RÉGION NOMMÉE
 * (`aria-labelledby`), condition posée par la fiche de mission — alternative
 * au `fieldset`/`legend` pour les cartes à un seul contrôle, où un `fieldset`
 * ferait double emploi avec le `<label>` propre du contrôle.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isConversationField, viewOf } from "@fn/_shared/ai/collection.ts";
import type { DemandeReceipt } from "@fn/_shared/domain/demande.ts";
import { isFieldRequired, validateForm, type FieldError, type FieldErrors } from "@fn/_shared/domain/formulaire.ts";
import { enabledAudiences, requesterFieldsFor, type Audience } from "@fn/_shared/domain/requesterConfig.ts";
import { FormFieldControl } from "@/features/demarche/FormFields.tsx";
import { Receipt } from "@/features/demarche/Receipt.tsx";
import { RequesterSection } from "@/features/demarche/RequesterSection.tsx";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import { localizedPath } from "@/i18n/localizedPath.ts";
import { BUTTON_CLASS, CARD_CLASS, EYEBROW_CLASS, SECONDARY_BUTTON_CLASS } from "./cardStyles.ts";
import type { CollectNote, CollectSession } from "./collect.ts";
import { buildRecap } from "./recap.ts";
import { buildPrefill, writePrefill, type PrefillStorage } from "./prefill.ts";

/** `sessionStorage` peut lever (navigation privée) ou ne pas exister (rendu hors navigateur). */
function tabStorage(): PrefillStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Le repli permanent : à afficher pendant TOUT le recueil (fiche de mission). */
export function ClassicFormLink({ session }: { session: CollectSession }) {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <Link
      to={localizedPath(lang, "/demarches/" + encodeURIComponent(session.demarche.id) + "/formulaire")}
      onClick={() => {
        const storage = tabStorage();
        if (storage !== null) writePrefill(storage, session.demarche.id, buildPrefill(session));
      }}
      className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
    >
      {t("assistant.collect.classicFormLink")}
    </Link>
  );
}

/** La note d'ouverture d'un recueil — un simple repère du fil, jamais un message. */
export function StartedNoteView({ note }: { note: CollectNote }) {
  const t = useT();
  return (
    <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
      {t("assistant.collect.note", { name: note.demarcheName })}
    </p>
  );
}

/** L'accusé — une entrée PERMANENTE du fil, avec « Copier » et « Imprimer ». */
export function ReceiptNoteView({ receipt, demarcheName }: { receipt: DemandeReceipt; demarcheName: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(receipt.reference);
      setCopied(true);
    } catch {
      // Presse-papiers indisponible (permission refusée, contexte non sécurisé) :
      // la référence reste affichée en grand, l'usager peut la recopier à la main.
    }
  }

  return (
    <Receipt
      receipt={receipt}
      demarcheName={demarcheName}
      footer={
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void copy()} className={SECONDARY_BUTTON_CLASS}>
            {t("assistant.receipt.copy")}
          </button>
          <button type="button" onClick={() => window.print()} className={SECONDARY_BUTTON_CLASS}>
            {t("assistant.receipt.print")}
          </button>
          <p role="status" aria-live="polite" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
            {copied ? t("assistant.receipt.copied") : ""}
          </p>
        </div>
      }
    />
  );
}

/**
 * Le champ EN ATTENTE — `card` ou `conversation`, la même carte pour les
 * deux : un contrôle du formulaire, « Valider », « Passer » s'il est
 * facultatif. Sur un champ « conversation », une phrase rappelle qu'on peut
 * aussi répondre dans le message ci-dessous — le modèle, lui, ne voit jamais
 * ce contrôle.
 */
export function PendingFieldCard({
  session,
  onAnswer,
  onSkip,
}: {
  session: CollectSession;
  onAnswer: (fieldId: string, value: unknown) => void;
  onSkip: (fieldId: string) => void;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const tn = useTn();
  const view = viewOf(session.demarche.form, session.collection);
  const field = view.pending;
  const [draft, setDraft] = useState<unknown>(field ? session.collection.values[field.id] : undefined);
  const [error, setError] = useState<FieldError | null>(null);

  // Un nouveau champ en attente (ou une session différente) reprend un
  // brouillon neuf — jamais le reliquat du champ précédent.
  useEffect(() => {
    setDraft(field ? session.collection.values[field.id] : undefined);
    setError(null);
  }, [field?.id, session.demarche.id]);

  if (field === null) return null;
  const required = isFieldRequired(field, session.collection.values);
  const conversationMode = isConversationField(field);

  function validate() {
    const trial = { ...session.collection.values, [field!.id]: draft };
    const errors = validateForm(session.demarche.form, trial);
    const fieldError = errors[field!.id] ?? null;
    setError(fieldError);
    if (fieldError === null) onAnswer(field!.id, draft);
  }

  return (
    <section aria-labelledby="collect-field-heading" className={CARD_CLASS}>
      <p id="collect-field-heading" className={EYEBROW_CLASS}>
        {t("assistant.collect.fieldCardHeading")}
      </p>
      <p role="status" aria-live="polite" className="mt-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {tn("assistant.collect.remaining", view.remaining)}
      </p>
      <div className="mt-3">
        <FormFieldControl
          field={field}
          value={draft}
          onChange={setDraft}
          required={required}
          error={errorText(lang, error)}
          demarcheId={session.demarche.id}
        />
      </div>
      {conversationMode && (
        <p className="mt-2 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {t("assistant.collect.answerInChat")}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={validate} className={BUTTON_CLASS}>
          {t("assistant.collect.validate")}
        </button>
        {!required && (
          <button type="button" onClick={() => onSkip(field!.id)} className={SECONDARY_BUTTON_CLASS}>
            {t("assistant.collect.skip")}
          </button>
        )}
      </div>
    </section>
  );
}

/** L'organisme destinataire — seulement quand il y a un choix à faire. */
export function OrganizationCard({
  session,
  onChoose,
  onConfirm,
}: {
  session: CollectSession;
  onChoose: (organizationId: string) => void;
  onConfirm: () => boolean;
}) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const inputId = "collect-organisme";

  function confirm() {
    if (!onConfirm()) {
      setError(t("form.chooseOrganization"));
      return;
    }
    setError(null);
  }

  return (
    <section aria-labelledby="collect-org-heading" className={CARD_CLASS}>
      <p id="collect-org-heading" className={EYEBROW_CLASS}>
        {t("form.organization")}
      </p>
      <div className="mt-3 flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
          {t("form.organization")}
          <span className="ml-1 text-red-600" aria-hidden="true">*</span>
          <span className="sr-only">{t("form.required")}</span>
        </label>
        <select
          id={inputId}
          value={session.organizationId ?? ""}
          aria-invalid={error !== null}
          aria-describedby={error !== null ? inputId + "-erreur" : undefined}
          onChange={(event) => {
            if (event.target.value !== "") onChoose(event.target.value);
          }}
          className="w-full rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-field-border)] bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] focus:border-[color:var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]/30"
        >
          <option value="">{t("form.choose")}</option>
          {session.demarche.organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </select>
        {error !== null && (
          <p id={inputId + "-erreur"} role="alert" className="text-[length:var(--pt-body)] text-red-600">
            {error}
          </p>
        )}
      </div>
      <button type="button" onClick={confirm} className={BUTTON_CLASS + " mt-3"}>
        {t("assistant.collect.confirmOrganization")}
      </button>
    </section>
  );
}

/** « Vos informations » — le public, puis ses champs (`RequesterSection`, inchangé). */
export function IdentityCard({
  session,
  requesterErrors,
  onAudienceChange,
  onFieldChange,
  onConfirm,
}: {
  session: CollectSession;
  requesterErrors: FieldErrors;
  onAudienceChange: (audience: Audience) => void;
  onFieldChange: (key: string, value: string) => void;
  onConfirm: () => boolean;
}) {
  const t = useT();
  const audiences = enabledAudiences(session.demarche.requester);
  const currentAudience = session.audience ?? audiences[0] ?? null;
  const fields = currentAudience === null ? [] : requesterFieldsFor(session.demarche.requester, currentAudience);

  return (
    <section aria-labelledby="collect-identity-heading" className={CARD_CLASS}>
      <p id="collect-identity-heading" className={EYEBROW_CLASS}>
        {t("requester.title")}
      </p>
      <div className="mt-3">
        {currentAudience !== null && (
          <RequesterSection
            audiences={audiences}
            audience={currentAudience}
            onAudienceChange={onAudienceChange}
            fields={fields}
            values={session.requesterValues}
            onChange={onFieldChange}
            errors={requesterErrors}
          />
        )}
      </div>
      <button type="button" onClick={() => onConfirm()} className={BUTTON_CLASS + " mt-3"}>
        {t("assistant.collect.confirmIdentity")}
      </button>
    </section>
  );
}

/** Le récapitulatif — dernière relecture avant l'envoi, chaque ligne modifiable. */
export function RecapCard({
  session,
  submitting,
  submitFailureMessage,
  onModifyField,
  onModifyOrganization,
  onModifyIdentity,
  onSubmit,
}: {
  session: CollectSession;
  submitting: boolean;
  submitFailureMessage: { title: string; detail: string } | null;
  onModifyField: (fieldId: string) => void;
  onModifyOrganization: () => void;
  onModifyIdentity: () => void;
  onSubmit: () => void;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const recap = buildRecap(lang, session);
  const canModifyOrganization = session.demarche.organizations.length > 1;

  return (
    <section aria-labelledby="collect-recap-heading" className={CARD_CLASS}>
      <p id="collect-recap-heading" className={EYEBROW_CLASS}>
        {t("assistant.collect.recapCardHeading")}
      </p>

      <div className="mt-3 flex flex-col gap-5">
        {recap.sections.map((section) => (
          <div key={section.id}>
            {section.title !== null && (
              <h3 className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">{section.title}</h3>
            )}
            <dl className="mt-1 flex flex-col divide-y divide-[color:var(--pt-border)]">
              {section.rows.map((row) => (
                <div key={row.fieldId} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <dt className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{row.label}</dt>
                    <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">{row.value}</dd>
                  </div>
                  <button
                    type="button"
                    onClick={() => onModifyField(row.fieldId)}
                    className="shrink-0 text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
                  >
                    {t("assistant.recap.modify")}
                  </button>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {recap.organization !== null && (
          <div>
            <h3 className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">{t("form.organization")}</h3>
            <div className="mt-1 flex items-start justify-between gap-3 py-2">
              <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">{recap.organization.name}</dd>
              {canModifyOrganization && (
                <button
                  type="button"
                  onClick={onModifyOrganization}
                  className="shrink-0 text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
                >
                  {t("assistant.recap.modify")}
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">{t("requester.title")}</h3>
          {recap.identity === null ? (
            <p className="mt-1 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("form.noRequester")}</p>
          ) : (
            <>
              <dl className="mt-1 flex flex-col divide-y divide-[color:var(--pt-border)]">
                {recap.identity.rows.map((row) => (
                  <div key={row.fieldId} className="py-2">
                    <dt className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{row.label}</dt>
                    <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                onClick={onModifyIdentity}
                className="mt-1 text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
              >
                {t("assistant.recap.modify")}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="mt-4 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("assistant.recap.disclaimer")}</p>

      {submitFailureMessage !== null && (
        <div role="alert" className="mt-3 rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3">
          <p className="font-semibold text-red-800">{submitFailureMessage.title}</p>
          <p className="mt-1 text-[length:var(--pt-body)] text-red-800">{submitFailureMessage.detail}</p>
        </div>
      )}

      <button type="button" onClick={onSubmit} disabled={submitting} className={BUTTON_CLASS + " mt-4"}>
        {t(submitting ? "form.submitting" : "form.submit")}
      </button>
    </section>
  );
}
