/**
 * Le formulaire d'une démarche, et son dépôt.
 *
 * L'écran est à la saisie : l'usager a lu la démarche à l'écran précédent et
 * a choisi de la commencer. Trois blocs seulement — l'organisme destinataire
 * quand il y a un choix à faire, les questions de la démarche, puis « Vos
 * informations ».
 *
 * Ce que ce composant NE décide pas : ce qui est visible, obligatoire, valide
 * ou déposé. Tout cela vit dans `formulaire.ts`, en logique pure — parce que
 * s'y tromper envoie une demande fausse à un agent, et qu'on veut pouvoir le
 * relire sans lancer un navigateur.
 *
 * ⚠️ L'identifiant de dépôt est tiré UNE fois, au montage, et conservé pendant
 * toute la vie de l'écran. C'est lui qui rend le double-clic et le renvoi après
 * coupure inoffensifs : Iris rend alors la demande déjà créée au lieu d'en
 * créer une seconde.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import { localizedPath, servedLanguage } from "@/i18n/localizedPath.ts";
import type { FormValues } from "@fn/_shared/domain/conditions.ts";
import { isSection } from "@fn/_shared/domain/formSchema.ts";
import type { DemandeReceipt } from "@fn/_shared/domain/demande.ts";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import { CONTACT_TYPES, enabledAudiences, requesterFieldsFor } from "@fn/_shared/domain/requesterConfig.ts";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { sendDemande, type PortalLoadFailure } from "@/services/portal/portalClient.ts";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "./DemarcheShell.tsx";
import { FormFieldControl } from "./FormFields.tsx";
import { RequesterSection } from "./RequesterSection.tsx";
import {
  isFieldRequired,
  toFormData,
  toRequester,
  validateForm,
  validateRequester,
  visibleNodes,
  type FieldErrors,
} from "./formulaire.ts";
import { useDemarche } from "./useDemarche.ts";

/** Un identifiant de dépôt, stable pour cet écran. */
function newSubmissionId(): string {
  const crypto = globalThis.crypto;
  if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Repli pour un navigateur sans `randomUUID` : l'unicité suffit, ce n'est
  // pas un secret.
  return "dep-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/** L'accusé de dépôt. Ce que l'usager doit pouvoir noter avant de fermer. */
function Receipt({ receipt, demarcheName }: { receipt: DemandeReceipt; demarcheName: string }) {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <section className="rounded-[var(--pt-radius)] border border-[color:var(--brand-primary)] bg-[color:color-mix(in_srgb,var(--brand-primary)_6%,white)] p-6">
      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
        {t(receipt.created ? "receipt.title" : "receipt.titleAgain")}
      </h1>
      <p className="mt-2 text-[color:var(--pt-ink)]">{demarcheName}</p>
      <p className="mt-6 text-[length:var(--pt-body)] font-semibold uppercase tracking-wide text-[color:var(--pt-muted)]">
        {t("receipt.reference")}
      </p>
      <p className="mt-1 text-[length:var(--pt-h1)] font-black tracking-tight text-[color:var(--pt-ink)]">{receipt.reference}</p>
      <p className="mt-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("receipt.note")}</p>
      <Link
        to={localizedPath(lang, "/")}
        className="mt-6 inline-flex rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-4 py-2 text-[length:var(--pt-body)] font-semibold hover:bg-[color:var(--pt-surface)]"
      >
        {t("demarche.backHome")}
      </Link>
    </section>
  );
}

/** Le récapitulatif des erreurs, en tête : le motif RGAA d'un formulaire long. */
function ErrorSummary({ count }: { count: number }) {
  const tn = useTn();
  return (
    <div
      role="alert"
      tabIndex={-1}
      className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
    >
      {tn("form.errors", count)}
    </div>
  );
}

export function FormulairePage() {
  const { demarcheId = "" } = useParams();
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state, retry } = useDemarche(demarcheId, lang);

  // Le serveur a tranché la langue : l'adresse s'y aligne (voir `PortalPage`).
  // ⚠️ ON N'ALIGNE L'ADRESSE QUE SUR UNE RÉPONSE À JOUR. Un état « prêt » qui
  // répond à la langue précédente est périmé le temps d'un rendu : s'en servir
  // renverrait le visiteur à la langue qu'il vient de quitter — et ferait
  // recharger la page sans que l'adresse change.
  const served = servedLanguage(
    state.status === "ready" ? { requested: state.requested, lang: state.snapshot.lang } : null,
    lang,
  );
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  const [values, setValues] = useState<FormValues>({});
  const [requesterValues, setRequesterValues] = useState<Record<string, string>>({});
  const [audience, setAudience] = useState<Audience | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [requesterErrors, setRequesterErrors] = useState<FieldErrors>({});
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendFailure, setSendFailure] = useState<PortalLoadFailure | null>(null);
  const [receipt, setReceipt] = useState<DemandeReceipt | null>(null);
  const [submissionId] = useState(newSubmissionId);

  const demarche = state.status === "ready" ? state.snapshot.demarche : null;

  const audiences = useMemo(
    () => (demarche === null ? [] : enabledAudiences(demarche.requester)),
    [demarche],
  );
  // Le public retenu : celui que l'usager a choisi, sinon le premier ouvert.
  const currentAudience = audience ?? audiences[0] ?? null;
  const requesterFields = useMemo(
    () =>
      demarche === null || currentAudience === null
        ? []
        : requesterFieldsFor(demarche.requester, currentAudience),
    [demarche, currentAudience],
  );

  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        <Link
          to={localizedPath(lang, "/")}
          className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
        >
          {t("demarche.backHome")}
        </Link>
      </DemarcheError>
    );
  }

  const { tenant, branding } = state.snapshot;
  const detail = state.snapshot.demarche;
  const schema = detail.form;
  const backToDemarche = localizedPath(lang, "/demarches/" + encodeURIComponent(detail.id));

  if (receipt !== null) {
    return (
      <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      theme={tenant.theme}
      languages={tenant.languages}
    >
        <Receipt receipt={receipt} demarcheName={detail.name} />
      </DemarcheShell>
    );
  }

  // Une démarche sans formulaire n'a pas d'écran de saisie : on renvoie à sa
  // présentation, qui explique quoi faire.
  if (schema === null) {
    return (
      <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      theme={tenant.theme}
      languages={tenant.languages}
    >
        <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">{detail.name}</h1>
        <p className="mt-3 text-[color:var(--pt-muted)]">
          Cette démarche ne peut pas encore être remplie en ligne.
        </p>
        <Link
          to={backToDemarche}
          className="mt-6 inline-flex rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
        >
          {t("demarche.back")}
        </Link>
      </DemarcheShell>
    );
  }

  const nodes = visibleNodes(schema, values);
  const mustChooseOrganization = detail.organizations.length > 1;
  const effectiveOrganizationId =
    organizationId ?? (detail.organizations.length === 1 ? detail.organizations[0].id : null);

  const setValue = (fieldId: string, value: unknown) => {
    setValues((previous) => ({ ...previous, [fieldId]: value }));
    // L'erreur d'un champ disparaît dès qu'on y retouche : la laisser affichée
    // pendant la correction est le défaut le plus agaçant d'un formulaire.
    setErrors((previous) => {
      if (!(fieldId in previous)) return previous;
      const next = { ...previous };
      delete next[fieldId];
      return next;
    });
  };

  const setRequesterValue = (key: string, value: string) => {
    setRequesterValues((previous) => ({ ...previous, [key]: value }));
    setRequesterErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;

    const formErrors = validateForm(schema, values);
    const identityErrors = validateRequester(requesterFields, requesterValues);
    const missingOrganization = mustChooseOrganization && effectiveOrganizationId === null;

    setErrors(formErrors);
    setRequesterErrors(identityErrors);
    setOrganizationError(missingOrganization ? t("form.chooseOrganization") : null);
    if (
      Object.keys(formErrors).length > 0 ||
      Object.keys(identityErrors).length > 0 ||
      missingOrganization
    ) {
      return;
    }

    setSending(true);
    setSendFailure(null);
    const result = await sendDemande({
      demarcheId: detail.id,
      organizationId: effectiveOrganizationId,
      formData: toFormData(schema, values),
      requester:
        currentAudience === null
          ? null
          : toRequester(CONTACT_TYPES[currentAudience], requesterFields, requesterValues),
      submissionId,
    });
    setSending(false);
    if (result.ok) setReceipt(result.receipt);
    else setSendFailure(result.reason);
  };

  const errorCount =
    Object.keys(errors).length + Object.keys(requesterErrors).length + (organizationError ? 1 : 0);

  return (
    <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      theme={tenant.theme}
      languages={tenant.languages}
    >
      <nav className="mb-6">
        <Link
          to={backToDemarche}
          className="text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)] hover:underline"
        >
          {t("demarche.back")}
        </Link>
      </nav>

      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">{detail.name}</h1>

      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-6">
        {errorCount > 0 && <ErrorSummary count={errorCount} />}

        {sendFailure !== null && (
          <div
            role="alert"
            className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
          >
            <p className="font-semibold">{errorMessageFor(sendFailure, lang).title}</p>
            <p className="mt-1">{errorMessageFor(sendFailure, lang).detail}</p>
          </div>
        )}

        {/* L'organisme destinataire n'est demandé que s'il y a un choix : avec
            un seul organisme, la question n'a pas d'objet. */}
        {mustChooseOrganization && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="organisme" className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
              {t("form.organization")}
              <span className="ml-1 text-red-600" aria-hidden="true">
                *
              </span>
            </label>
            <select
              id="organisme"
              value={effectiveOrganizationId ?? ""}
              aria-invalid={organizationError !== null}
              onChange={(event) => {
                setOrganizationId(event.target.value === "" ? null : event.target.value);
                setOrganizationError(null);
              }}
              className={
                "w-full rounded-[var(--pt-radius-sm)] border bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] focus:outline-none focus:ring-2 " +
                (organizationError !== null
                  ? "border-red-500 focus:ring-red-500/30"
                  : "border-[color:var(--pt-border)] focus:border-[color:var(--brand-primary)] focus:ring-[color:var(--brand-primary)]/30")
              }
            >
              <option value="">Choisissez…</option>
              {detail.organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {organizationError !== null && (
              <p className="text-[length:var(--pt-body)] text-red-600">{organizationError}</p>
            )}
          </div>
        )}

        {nodes.map((node) =>
          isSection(node) ? (
            <section key={node.id} className="flex flex-col gap-4 rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] p-5">
              <div>
                <h2 className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">{node.title}</h2>
                {node.description !== undefined && (
                  <p className="mt-1 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{node.description}</p>
                )}
              </div>
              {node.fields.map((field) => (
                <FormFieldControl
                  key={field.id}
                  field={field}
                  value={values[field.id]}
                  onChange={(value) => setValue(field.id, value)}
                  required={isFieldRequired(field, values)}
                  error={errorText(lang, errors[field.id])}
                />
              ))}
            </section>
          ) : (
            <FormFieldControl
              key={node.id}
              field={node}
              value={values[node.id]}
              onChange={(value) => setValue(node.id, value)}
              required={isFieldRequired(node, values)}
              error={errorText(lang, errors[node.id])}
            />
          ),
        )}

        {currentAudience !== null && (
          <RequesterSection
            audiences={audiences}
            audience={currentAudience}
            onAudienceChange={(next) => {
              setAudience(next);
              // Changer de public change les champs : les erreurs de l'ancien
              // ne désignent plus rien.
              setRequesterErrors({});
            }}
            fields={requesterFields}
            values={requesterValues}
            onChange={setRequesterValue}
            errors={requesterErrors}
          />
        )}

        {audiences.length === 0 && (
          // La collectivité n'a ouvert aucun public de requérant : la demande
          // part sans identité. C'est son choix, pas un oubli du portail — mais
          // l'usager doit le savoir avant d'envoyer.
          <p className="rounded-[var(--pt-radius-sm)] border border-dashed border-[color:var(--pt-border)] px-4 py-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
            {t("form.noRequester")}
          </p>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={sending}
            className="rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90 disabled:opacity-60"
          >
            {t(sending ? "form.submitting" : "form.submit")}
          </button>
          <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
        </div>
      </form>
    </DemarcheShell>
  );
}
