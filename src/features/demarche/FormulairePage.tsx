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
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import { organismePath, servedLanguage, splitScopedPath } from "@/i18n/localizedPath.ts";
import { demarcheTitle, errorPageTitle, formulaireTitle, receiptTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";
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
  toAttachments,
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
  // Le périmètre vient de l'adresse — même raison que dans `DemarchePage` :
  // après un dépôt sous une mairie, on revient à la page de cette mairie.
  const { organisme } = splitScopedPath(useLocation().pathname);
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
        to={organismePath(lang, organisme, "/")}
        className="mt-6 inline-flex rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-4 py-2 text-[length:var(--pt-body)] font-semibold hover:bg-[color:var(--pt-surface)]"
      >
        {t("demarche.backHome")}
      </Link>
    </section>
  );
}

/**
 * Le récapitulatif des erreurs, en tête : le motif RGAA d'un formulaire long.
 *
 * `tabIndex={-1}` le rend focusable par programme sans l'ajouter à l'ordre de
 * tabulation — c'est `FormulairePage` qui y amène le focus après un envoi
 * refusé (RGAA 10.7 / bonne pratique 11.10), via la `ref` transmise ici.
 */
const ErrorSummary = forwardRef<HTMLDivElement, { count: number }>(function ErrorSummary(
  { count },
  ref,
) {
  const tn = useTn();
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
    >
      {tn("form.errors", count)}
    </div>
  );
});

export function FormulairePage() {
  const { demarcheId = "" } = useParams();
  // Le périmètre vient de l'adresse — voir `DemarchePage`.
  const { organisme } = splitScopedPath(useLocation().pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state, retry } = useDemarche(demarcheId, lang, organisme);

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
  // Compte les envois refusés — pas l'erreur elle-même (`errorCount`), qui
  // change aussi quand l'usager CORRIGE un champ. Sans cette distinction, le
  // focus reviendrait sur le résumé à chaque champ corrigé plutôt qu'une
  // seule fois après le clic sur « Envoyer ». Voir l'effet plus bas.
  const [submitFailedAt, setSubmitFailedAt] = useState(0);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

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

  // Calculé ici, AVANT les retours anticipés ci-dessous : c'est ce qui permet
  // au titre d'onglet (juste après) et à l'effet de focus (plus bas) de s'en
  // servir sans dépendre de la branche atteinte au premier rendu.
  const errorCount =
    Object.keys(errors).length + Object.keys(requesterErrors).length + (organizationError ? 1 : 0);

  // Le titre de l'onglet (RGAA 8.6), posé avant tout retour anticipé : les
  // hooks doivent s'exécuter dans le même ordre à chaque rendu, quel que soit
  // l'état de la démarche. Après un envoi refusé, il se préfixe du nombre
  // d'erreurs — souvent la première chose qu'un lecteur d'écran annonce.
  useDocumentTitle(
    state.status === "error"
      ? errorPageTitle(lang, errorMessageFor(state.reason, lang).title)
      : state.status !== "ready"
        ? t("page.title")
        : receipt !== null
          ? receiptTitle(lang, receipt.created, state.snapshot.tenant.name)
          : state.snapshot.demarche.form === null
            ? demarcheTitle(state.snapshot.demarche.name, state.snapshot.tenant.name)
            : formulaireTitle(
                lang,
                state.snapshot.demarche.name,
                state.snapshot.tenant.name,
                errorCount,
              ),
  );

  // Après un envoi refusé, le focus va au résumé plutôt qu'au bouton — sans
  // quoi personne ne le remarque (RGAA 10.7 / 11.10). `submitFailedAt` ne
  // bouge qu'au moment du clic manqué, jamais pendant la correction : cet
  // effet ne se rejoue donc pas à chaque champ que l'usager corrige.
  useEffect(() => {
    if (submitFailedAt === 0) return;
    errorSummaryRef.current?.focus();
    errorSummaryRef.current?.scrollIntoView();
  }, [submitFailedAt]);

  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        <Link
          to={organismePath(lang, organisme, "/")}
          className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
        >
          {t("demarche.backHome")}
        </Link>
      </DemarcheError>
    );
  }

  const { tenant, villes, branding, tenantBranding } = state.snapshot;
  const detail = state.snapshot.demarche;
  const schema = detail.form;
  const backToDemarche = organismePath(
    lang,
    organisme,
    "/demarches/" + encodeURIComponent(detail.id),
  );

  if (receipt !== null) {
    return (
      <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      tenantBranding={tenantBranding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
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
      tenantBranding={tenantBranding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
    >
        <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">{detail.name}</h1>
        <p className="mt-3 text-[color:var(--pt-muted)]">{t("demarche.notOnline")}</p>
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
      // Un envoi manqué de plus : l'effet plus haut amène le focus sur le
      // résumé une fois qu'il est rendu avec le décompte à jour.
      setSubmitFailedAt((n) => n + 1);
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
      // Les fichiers sont déjà chez Iris : seuls leurs identifiants partent,
      // et un rejeu après coupure les renvoie tels quels.
      attachments: toAttachments(schema, values),
    });
    setSending(false);
    if (result.ok) setReceipt(result.receipt);
    else setSendFailure(result.reason);
  };

  return (
    <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      tenantBranding={tenantBranding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
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
        {errorCount > 0 && <ErrorSummary ref={errorSummaryRef} count={errorCount} />}

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
                  : "border-[color:var(--pt-field-border)] focus:border-[color:var(--brand-primary)] focus:ring-[color:var(--brand-primary)]/30")
              }
            >
              <option value="">{t("form.choose")}</option>
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
                  demarcheId={detail.id}
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
              demarcheId={detail.id}
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
