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
import type { Field } from "@fn/_shared/domain/formSchema.ts";
import type { ConsentKind } from "@fn/_shared/domain/consents.ts";
import { isFieldRequired, validateForm, type FieldError, type FieldErrors } from "@fn/_shared/domain/formulaire.ts";
import { enabledAudiences, requesterFieldsFor, type Audience } from "@fn/_shared/domain/requesterConfig.ts";
import { FormFieldControl } from "@/features/demarche/FormFields.tsx";
import { Receipt } from "@/features/demarche/Receipt.tsx";
import { RequesterSection } from "@/features/demarche/RequesterSection.tsx";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import { localizedPath } from "@/i18n/localizedPath.ts";
import { BUTTON_CLASS, CARD_CLASS, EYEBROW_CLASS, SECONDARY_BUTTON_CLASS } from "./cardStyles.ts";
import type { CollectNote, CollectSession } from "./collect.ts";
import { OriginBadge, OriginNote } from "./FieldOrigin.tsx";
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
export function ClassicFormLink({
  session,
  prominent = false,
}: {
  session: CollectSession;
  /**
   * Le repli devient le geste PRINCIPAL — quand la conversation s'arrête en
   * plein recueil, il n'y a plus d'autre chemin vers l'envoi.
   */
  prominent?: boolean;
}) {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <Link
      to={localizedPath(lang, "/demarches/" + encodeURIComponent(session.demarche.id) + "/formulaire")}
      onClick={() => {
        const storage = tabStorage();
        if (storage !== null) writePrefill(storage, session.demarche.id, buildPrefill(session));
      }}
      className={
        prominent
          ? BUTTON_CLASS + " inline-flex"
          : "text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
      }
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
 * Le COMPLÉMENT à renseigner — ce qui ne peut pas se dire, et ce qu'on peut
 * choisir plutôt que décrire.
 *
 * ⚠️ **Cette carte NE POSE PLUS DE QUESTION.** C'est le modèle qui demande,
 * dans ses mots ; elle ne fait qu'offrir le contrôle quand il en faut un. Elle
 * récitait le libellé du champ avant le 2026-09-21, et deux voix demandaient
 * alors la même chose de deux façons.
 *
 * Elle ne s'affiche donc que s'il y a quelque chose à montrer : un calendrier
 * ou un dépôt de fichier (`controls` — on ne peut pas y répondre en parlant),
 * ou, replié, le contrôle d'un champ à options que le modèle vient de demander
 * (`assists` — pour qui préfère cliquer). Le reste du temps, elle disparaît et
 * la conversation suffit.
 */
function FieldControl({
  session,
  field,
  folded,
  onAnswer,
  onSkip,
}: {
  session: CollectSession;
  field: Field;
  /** Replié : un repli offert, pas la question. */
  folded: boolean;
  onAnswer: (fieldId: string, value: unknown) => void;
  onSkip: (fieldId: string) => void;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const [draft, setDraft] = useState<unknown>(session.collection.values[field.id]);
  const [error, setError] = useState<FieldError | null>(null);

  // Un champ différent (ou une session différente) reprend un brouillon neuf.
  useEffect(() => {
    setDraft(session.collection.values[field.id]);
    setError(null);
  }, [field.id, session.demarche.id]);

  const required = isFieldRequired(field, session.collection.values);

  function validate() {
    const trial = { ...session.collection.values, [field.id]: draft };
    const fieldError = validateForm(session.demarche.form, trial)[field.id] ?? null;
    setError(fieldError);
    if (fieldError === null) onAnswer(field.id, draft);
  }

  const body = (
    <>
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
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={validate} className={BUTTON_CLASS}>
          {t("assistant.collect.validate")}
        </button>
        {!required && (
          <button type="button" onClick={() => onSkip(field.id)} className={SECONDARY_BUTTON_CLASS}>
            {t("assistant.collect.skip")}
          </button>
        )}
      </div>
    </>
  );

  if (!folded) return body;
  return (
    <details>
      <summary className="cursor-pointer text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)]">
        {t("assistant.collect.answerInForm")}
      </summary>
      {body}
    </details>
  );
}

/**
 * Ce qu'il reste d'obligatoire — replié.
 *
 * Historique : c'était la sortie de secours, et elle a manqué. Constaté en test : le modèle
 * demande « code postal et ville », l'usager répond « 44000 », le serveur retient
 * le code postal et la ville reste vide. Le modèle passe à la question suivante
 * sans y revenir, puis annonce que tout est là. L'écran, lui, affichait « Encore
 * une information à préciser » — et **rien pour la préciser** : la carte de champ
 * ne se montre que pour ce qui ne se dit pas (une date, un fichier), et le
 * récapitulatif n'ouvre pas tant qu'un obligatoire manque. Conversation sans
 * issue.
 *
 * Replié par défaut : la conversation reste le chemin, ceci n'est qu'une porte.
 * Mais elle existe désormais à tout moment, sans dépendre de ce que le modèle
 * veut bien demander — c'est justement quand il s'égare qu'on en a besoin.
 *
 * ⚠️ Elle ne s'ouvre JAMAIS seule, et ne propose un CONTRÔLE que pour ce qui
 * ne se dit pas (une date, un fichier, un lieu sur la carte) — décision PO du
 * 2026-10-01. Ouverte d'office avec un menu « Type de dépôt » et une zone
 * « Description », elle remplaçait la conversation par un formulaire, alors
 * que l'assistant venait justement de poser sa question. Ce qui se dit est
 * seulement NOMMÉ : c'est à l'assistant qu'on le dit. Le filet du serveur
 * (`runAssistantTurn`) relance un modèle qui oublierait de le demander.
 */
export function RemainingRequiredFields({
  session,
  fields,
  onAnswer,
  onSkip,
}: {
  session: CollectSession;
  fields: readonly Field[];
  onAnswer: (fieldId: string, value: unknown) => void;
  onSkip: (fieldId: string) => void;
}) {
  const t = useT();
  if (fields.length === 0) return null;
  const spoken = fields.filter((field) => isConversationField(field));
  const controls = fields.filter((field) => !isConversationField(field));
  return (
    <details className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
      <summary className="cursor-pointer text-[color:var(--brand-primary)]">
        {t("assistant.collect.remainingSee")}
      </summary>
      <div className="mt-2 flex flex-col gap-5">
        {spoken.length > 0 && (
          <div>
            <p>{t("assistant.collect.remainingSpoken")}</p>
            <ul className="mt-1 list-disc ps-5">
              {spoken.map((field) => (
                <li key={field.id}>{field.label}</li>
              ))}
            </ul>
          </div>
        )}
        {controls.map((field) => (
          <div key={field.id}>
            <FieldControl
              session={session}
              field={field}
              folded={false}
              onAnswer={onAnswer}
              onSkip={onSkip}
            />
          </div>
        ))}
      </div>
    </details>
  );
}

export function PendingFieldCard({
  session,
  asking,
  onAnswer,
  onSkip,
}: {
  session: CollectSession;
  /** Ce que la question du modèle porte — revalidé par le serveur. */
  asking: readonly string[];
  onAnswer: (fieldId: string, value: unknown) => void;
  onSkip: (fieldId: string) => void;
}) {
  const t = useT();
  const view = viewOf(session.demarche.form, session.collection, asking);
  if (view.controls.length === 0 && view.assists.length === 0) return null;

  return (
    <section aria-labelledby="collect-field-heading" className={CARD_CLASS}>
      <p id="collect-field-heading" className={EYEBROW_CLASS}>
        {t("assistant.collect.fieldCardHeading")}
      </p>
      <div className="flex flex-col gap-4">
        {view.controls.map((field) => (
          <FieldControl
            key={field.id}
            session={session}
            field={field}
            folded={false}
            onAnswer={onAnswer}
            onSkip={onSkip}
          />
        ))}
        {view.assists.map((field) => (
          <FieldControl
            key={field.id}
            session={session}
            field={field}
            folded
            onAnswer={onAnswer}
            onSkip={onSkip}
          />
        ))}
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

/**
 * « Vos informations » — le public et ses champs s'il y en a, et TOUJOURS les
 * consentements (`RequesterSection`, le même bloc que le formulaire classique).
 */
export function IdentityCard({
  session,
  requesterErrors,
  onAudienceChange,
  onFieldChange,
  onConsentChange,
  onConfirm,
  dense = false,
}: {
  session: CollectSession;
  /** Erreurs de l'identité ET des consentements. */
  requesterErrors: FieldErrors;
  onAudienceChange: (audience: Audience) => void;
  onFieldChange: (key: string, value: string) => void;
  onConsentChange: (kind: ConsentKind, granted: boolean) => void;
  onConfirm: () => boolean;
  /** Une seule colonne de champs — le panneau de la bulle est étroit. */
  dense?: boolean;
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
        <RequesterSection
          audiences={audiences}
          audience={currentAudience}
          onAudienceChange={onAudienceChange}
          dense={dense}
          fields={fields}
          values={session.requesterValues}
          onChange={onFieldChange}
          errors={requesterErrors}
          consents={session.consents}
          onConsentChange={onConsentChange}
          organismName={session.demarche.tenantName}
        />
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
                    <dt className="flex flex-wrap items-center gap-2 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                      {row.label}
                      {/* Le badge n'apparaît QUE sur ce que l'assistant a posé :
                          une valeur saisie par l'usager n'a pas d'origine à
                          justifier, et un badge partout ne distinguerait rien. */}
                      {row.origin !== undefined && <OriginBadge origin={row.origin.origin} />}
                    </dt>
                    <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">{row.value}</dd>
                    {row.origin !== undefined && (
                      <p className="mt-0.5 text-[length:var(--pt-small)] italic text-[color:var(--pt-muted)]">
                        <OriginNote record={row.origin} />
                      </p>
                    )}
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
            <dl className="mt-1 flex flex-col divide-y divide-[color:var(--pt-border)]">
              {recap.identity.rows.map((row) => (
                <div key={row.fieldId} className="py-2">
                  <dt className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{row.label}</dt>
                  <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {/* Les consentements se relisent avec l'identité : même carte à la
              saisie, même « Modifier » ici. Toujours les deux, même sans identité. */}
          <h4 className="mt-3 text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-ink)]">{t("consent.heading")}</h4>
          <dl className="mt-1 flex flex-col divide-y divide-[color:var(--pt-border)]">
            {recap.consents.map((row) => (
              <div key={row.kind} className="py-2">
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
