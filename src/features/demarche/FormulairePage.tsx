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
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  return (
    <section className="rounded-xl border border-[color:var(--brand-primary)] bg-[color:color-mix(in_srgb,var(--brand-primary)_6%,white)] p-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
        {receipt.created ? "Votre demande est enregistrée" : "Votre demande était déjà enregistrée"}
      </h1>
      <p className="mt-2 text-slate-700">{demarcheName}</p>
      <p className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Votre référence
      </p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{receipt.reference}</p>
      <p className="mt-4 text-sm text-slate-600">
        Notez cette référence : elle identifie votre demande auprès de votre collectivité. Le suivi
        en ligne et la confirmation par courriel arriveront prochainement.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50"
      >
        Retour à l'accueil
      </Link>
    </section>
  );
}

/** Le récapitulatif des erreurs, en tête : le motif RGAA d'un formulaire long. */
function ErrorSummary({ count }: { count: number }) {
  return (
    <div
      role="alert"
      tabIndex={-1}
      className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      {count > 1
        ? count + " informations doivent être corrigées avant l'envoi."
        : "Une information doit être corrigée avant l'envoi."}
    </div>
  );
}

export function FormulairePage() {
  const { demarcheId = "" } = useParams();
  const { state, retry } = useDemarche(demarcheId);

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
          to="/"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
        >
          Retour à l'accueil
        </Link>
      </DemarcheError>
    );
  }

  const { tenant, branding } = state.snapshot;
  const detail = state.snapshot.demarche;
  const schema = detail.form;
  const backToDemarche = "/demarches/" + encodeURIComponent(detail.id);

  if (receipt !== null) {
    return (
      <DemarcheShell tenantName={tenant.name} branding={branding}>
        <Receipt receipt={receipt} demarcheName={detail.name} />
      </DemarcheShell>
    );
  }

  // Une démarche sans formulaire n'a pas d'écran de saisie : on renvoie à sa
  // présentation, qui explique quoi faire.
  if (schema === null) {
    return (
      <DemarcheShell tenantName={tenant.name} branding={branding}>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{detail.name}</h1>
        <p className="mt-3 text-slate-600">
          Cette démarche ne peut pas encore être remplie en ligne.
        </p>
        <Link
          to={backToDemarche}
          className="mt-6 inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
        >
          Revenir à la démarche
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
    setOrganizationError(missingOrganization ? "Choisissez l'organisme concerné." : null);
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
    <DemarcheShell tenantName={tenant.name} branding={branding}>
      <nav className="mb-6">
        <Link
          to={backToDemarche}
          className="text-sm font-semibold text-[color:var(--brand-primary)] hover:underline"
        >
          Revenir à la démarche
        </Link>
      </nav>

      <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">{detail.name}</h1>

      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-6">
        {errorCount > 0 && <ErrorSummary count={errorCount} />}

        {sendFailure !== null && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <p className="font-semibold">{errorMessageFor(sendFailure).title}</p>
            <p className="mt-1">{errorMessageFor(sendFailure).detail}</p>
          </div>
        )}

        {/* L'organisme destinataire n'est demandé que s'il y a un choix : avec
            un seul organisme, la question n'a pas d'objet. */}
        {mustChooseOrganization && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="organisme" className="text-sm font-semibold text-slate-900">
              Organisme concerné
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
                "w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 " +
                (organizationError !== null
                  ? "border-red-500 focus:ring-red-500/30"
                  : "border-slate-300 focus:border-[color:var(--brand-primary)] focus:ring-[color:var(--brand-primary)]/30")
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
              <p className="text-sm text-red-600">{organizationError}</p>
            )}
          </div>
        )}

        {nodes.map((node) =>
          isSection(node) ? (
            <section key={node.id} className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{node.title}</h2>
                {node.description !== undefined && (
                  <p className="mt-1 text-sm text-slate-500">{node.description}</p>
                )}
              </div>
              {node.fields.map((field) => (
                <FormFieldControl
                  key={field.id}
                  field={field}
                  value={values[field.id]}
                  onChange={(value) => setValue(field.id, value)}
                  required={isFieldRequired(field, values)}
                  error={errors[field.id] ?? null}
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
              error={errors[node.id] ?? null}
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
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600">
            Cette démarche est déposée sans vos coordonnées : votre collectivité ne pourra pas vous
            répondre directement.
          </p>
        )}

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg bg-[color:var(--brand-primary)] px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
          >
            {sending ? "Envoi en cours…" : "Envoyer ma demande"}
          </button>
          <p className="text-xs text-slate-500">
            Les champs marqués d'un astérisque sont obligatoires.
          </p>
        </div>
      </form>
    </DemarcheShell>
  );
}
