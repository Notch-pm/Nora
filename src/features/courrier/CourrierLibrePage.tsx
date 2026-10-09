/**
 * « Envoyer un courrier libre » — `/courrier` (la collectivité) et
 * `/{organisme}/courrier` (un de ses organismes), langue comprise.
 *
 * L'usager écrit librement : un objet, un message, qui il est, de quoi lui
 * répondre, jusqu'à trois pièces jointes, et les deux consentements RGPD. Le
 * courrier part dans Clara, la gestion du courrier de l'organisme ; le portail
 * n'en garde rien.
 *
 * Ce que ce composant NE décide pas : qui reçoit du courrier (le Socle,
 * `free_mail.enabled` — un organisme fermé rend `courrier_unavailable` et la
 * page le dit), ni ce qu'un courrier doit contenir (`domain/courrier.ts`, les
 * mêmes règles que celles que `portal-api` réapplique avant de relayer).
 *
 * Même ossature que le formulaire d'une démarche (`FormulairePage`) : le cadre
 * `DemarcheShell`, le récapitulatif d'erreurs qui prend le focus après un
 * envoi refusé (RGAA 10.7 / 11.10), le bloc « Vos informations »
 * (`RequesterSection`) et ses consentements, la preuve de travail résolue
 * dans le navigateur, l'identifiant de dépôt tiré UNE fois — un double clic ou
 * un renvoi après coupure rend le même courrier (`duplicate`), pas un second.
 *
 * ⚠️ Les fichiers partent AVEC le courrier, au clic sur « Envoyer » — pas à la
 * sélection comme les pièces d'une démarche. Ils sont vérifiés ici (nombre,
 * taille, extension) pour le confort, et de nouveau par `portal-api`.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { solveChallenge } from "@fn/_shared/ai/challenge.ts";
import type { ConsentAnswers, ConsentKind } from "@fn/_shared/domain/consents.ts";
import {
  consentErrorKey,
  defaultConsentAnswers,
  toConsentAnswers,
  validateConsents,
} from "@fn/_shared/domain/consents.ts";
import {
  COURRIER_FILE_EXTENSIONS,
  type CourrierReceipt,
  fileProblem,
  MAX_BODY,
  MAX_COURRIER_FILE_BYTES,
  MAX_COURRIER_FILES,
  MAX_SUBJECT,
  type SenderCategory,
  SENDER_CATEGORIES,
  validateCourrier,
} from "@fn/_shared/domain/courrier.ts";
import type { FieldErrors } from "@fn/_shared/domain/formulaire.ts";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import { organismePath, servedLanguage, splitScopedPath } from "@/i18n/localizedPath.ts";
import { courrierSentTitle, courrierTitle, errorPageTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { challengeToSolve } from "@/services/portal/depositChallenge.ts";
import {
  type CourrierSendFailure,
  fetchDepositChallenge,
  sendCourrier,
} from "@/services/portal/portalClient.ts";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "@/features/demarche/DemarcheShell.tsx";
import { RequesterSection } from "@/features/demarche/RequesterSection.tsx";
import { courrierSendErrorKey } from "./sendErrors.ts";
import { senderFields, splitCourrierErrors, toCourrierDraft } from "./sender.ts";
import { useCourrier } from "./useCourrier.ts";

// ⚠️ Le contour d'un champ de saisie tient 3 : 1 (RGAA 3.3) — `--pt-field-border`.
const inputClass =
  "w-full rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-field-border)] bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] " +
  "focus:border-[color:var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]/30";
const invalidClass = "border-red-500 focus:border-red-500 focus:ring-red-500/30";

/**
 * Un identifiant de dépôt, stable pour cet écran — un UUID, que Clara exige
 * pour reconnaître un rejeu. Repli v4 pour un navigateur sans `randomUUID`.
 */
function newSubmissionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1).replace(/\.0$/, "") + " Mo";
  if (bytes >= 1024) return Math.round(bytes / 1024) + " Ko";
  return bytes + " o";
}

/** Le récapitulatif des erreurs, en tête — même motif que le formulaire d'une démarche. */
const ErrorSummary = forwardRef<HTMLDivElement, { count: number }>(function ErrorSummary({ count }, ref) {
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

/** Un champ de texte du courrier (objet, message) : libellé réel, obligatoire annoncé, erreur reliée. */
function TextField({
  id,
  label,
  value,
  onChange,
  error,
  maxLength,
  multiline = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  maxLength: number;
  multiline?: boolean;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const describedBy = [id + "-aide", error !== null ? id + "-erreur" : null].filter(Boolean).join(" ");
  const shared = {
    id,
    value,
    maxLength,
    required: true,
    "aria-invalid": error !== null,
    "aria-describedby": describedBy,
    className: inputClass + (error !== null ? " " + invalidClass : ""),
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
        {label}
        <span className="ml-1 text-red-600" aria-hidden="true">
          *
        </span>
        <span className="sr-only">{t("form.required")}</span>
      </label>
      <p id={id + "-aide"} className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {t("validation.maxLength", { n: maxLength.toLocaleString(lang) })}
      </p>
      {multiline ? (
        <textarea {...shared} rows={10} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input {...shared} type="text" onChange={(event) => onChange(event.target.value)} />
      )}
      {error !== null && (
        <p id={id + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Les pièces jointes : retenues dans le navigateur jusqu'à l'envoi. Même
 * présentation que le dépôt d'une pièce de démarche (`FormFields`), le contrôle
 * réel en `sr-only` et sa zone qui porte le focus visible (RGAA 10.7).
 */
function FilesField({
  files,
  onChange,
  error,
  onError,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  error: string | null;
  onError: (message: string | null) => void;
  disabled: boolean;
}) {
  const t = useT();
  const inputId = "courrier-fichiers";
  const full = files.length >= MAX_COURRIER_FILES;
  const describedBy = [inputId + "-aide", error !== null ? inputId + "-erreur" : null].filter(Boolean).join(" ");

  function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    onError(null);
    let next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= MAX_COURRIER_FILES) {
        onError(t("validation.maxFiles", { n: MAX_COURRIER_FILES }));
        break;
      }
      const problem = fileProblem(file);
      if (problem === "too_large") {
        onError(t("validation.fileTooLarge", { name: file.name, size: MAX_COURRIER_FILE_BYTES / 1_048_576 }));
        continue;
      }
      if (problem !== null) {
        onError(t("validation.fileUnsupported", { name: file.name }));
        continue;
      }
      next = [...next, file];
    }
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p id={inputId + "-libelle"} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
        {t("courrierLibre.files")}
      </p>
      <p id={inputId + "-aide"} className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {t("courrierLibre.filesHint", {
          n: MAX_COURRIER_FILES,
          size: MAX_COURRIER_FILE_BYTES / 1_048_576,
          formats: COURRIER_FILE_EXTENSIONS.map((ext) => ext.toUpperCase()).join(", "),
        })}
      </p>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={file.name + "-" + index}
              className="flex items-center justify-between gap-3 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-3 py-2 text-[length:var(--pt-body)]"
            >
              <span className="min-w-0 truncate text-[color:var(--pt-ink)]">
                {file.name}
                <span className="ml-2 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{formatSize(file.size)}</span>
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onError(null);
                  onChange(files.filter((_, i) => i !== index));
                }}
                aria-label={t("form.removeFile", { name: file.name })}
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
            (error !== null ? "border-red-500 " : "border-[color:var(--pt-field-border)] ") +
            "bg-[color:var(--pt-surface)] hover:border-[color:var(--brand-primary)] " +
            "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[color:var(--brand-primary)]"
          }
        >
          <span className="text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)]">
            {t("courrierLibre.addFiles")}
          </span>
          <input
            id={inputId}
            type="file"
            className="sr-only"
            multiple
            accept={COURRIER_FILE_EXTENSIONS.map((ext) => "." + ext).join(",")}
            disabled={disabled}
            aria-labelledby={inputId + "-libelle"}
            aria-describedby={describedBy}
            aria-invalid={error !== null}
            onChange={(event) => {
              add(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      )}
      {error !== null && (
        <p id={inputId + "-erreur"} role="alert" className="text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function CourrierLibrePage() {
  const { organisme: slug } = splitScopedPath(useLocation().pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state, retry } = useCourrier(lang, slug);

  // Le serveur a tranché la langue : l'adresse s'y aligne, sur une réponse à jour seulement.
  const served = servedLanguage(
    state.status === "ready" ? { requested: state.requested, lang: state.snapshot.lang } : null,
    lang,
  );
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<SenderCategory>("citoyen");
  const [senderValues, setSenderValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [consents, setConsents] = useState<ConsentAnswers>(defaultConsentAnswers);
  const [textErrors, setTextErrors] = useState<FieldErrors>({});
  const [senderErrors, setSenderErrors] = useState<FieldErrors>({});
  const [sending, setSending] = useState(false);
  const [sendFailure, setSendFailure] = useState<CourrierSendFailure | null>(null);
  const [receipt, setReceipt] = useState<CourrierReceipt | null>(null);
  const [submissionId] = useState(newSubmissionId);
  const [submitFailedAt, setSubmitFailedAt] = useState(0);
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const fields = useMemo(() => senderFields(category, (key) => t(key)), [category, t]);
  const filesError = errorText(lang, textErrors.files) ?? fileNotice;
  const errorCount = Object.keys(textErrors).length + Object.keys(senderErrors).length;

  useDocumentTitle(
    state.status === "error"
      ? errorPageTitle(lang, errorMessageFor(state.reason, lang).title)
      : state.status !== "ready"
        ? t("page.title")
        : receipt !== null
          ? courrierSentTitle(lang, receipt.duplicate, receipt.organismeName)
          : courrierTitle(
            lang,
            state.snapshot.freeMail.title,
            state.snapshot.organisme.name,
            state.snapshot.tenant.name,
            errorCount,
          ),
  );

  // Après un envoi refusé, le focus va au résumé — une fois par clic manqué,
  // jamais pendant la correction (voir `FormulairePage`).
  useEffect(() => {
    if (submitFailedAt === 0) return;
    errorSummaryRef.current?.focus();
    errorSummaryRef.current?.scrollIntoView();
  }, [submitFailedAt]);

  // Le retour : la page de l'organisme, ou l'accueil pour la collectivité.
  const back = organismePath(
    lang,
    state.status === "ready" && !state.snapshot.organisme.isTenant ? (state.snapshot.organisme.slug ?? slug) : null,
    "/",
  );
  const backLink = (subtle: boolean) => (
    <Link
      to={back}
      className={
        subtle
          ? "text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)] hover:underline"
          : "rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
      }
    >
      {t("demarche.backHome")}
    </Link>
  );

  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        {backLink(false)}
      </DemarcheError>
    );
  }

  const { tenant, villes, organisme, freeMail, branding, tenantBranding } = state.snapshot;
  const title = freeMail.title ?? t("courrierLibre.title");
  const shell = (children: React.ReactNode) => (
    <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      tenantBranding={tenantBranding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
    >
      {children}
    </DemarcheShell>
  );

  if (receipt !== null) {
    return shell(
      <section className="rounded-[var(--pt-radius)] border border-[color:var(--brand-primary)] bg-[color:color-mix(in_srgb,var(--brand-primary)_6%,white)] p-6">
        <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
          {t(receipt.duplicate ? "courrierLibre.sent.titleAgain" : "courrierLibre.sent.title")}
        </h1>
        <p className="mt-2 text-[color:var(--pt-ink)]">{t("courrierLibre.sent.to", { name: receipt.organismeName })}</p>
        {receipt.reference !== null ? (
          <>
            <p className="mt-6 text-[length:var(--pt-body)] font-semibold uppercase tracking-wide text-[color:var(--pt-muted)]">
              {t("receipt.reference")}
            </p>
            <p className="mt-1 text-[length:var(--pt-h1)] font-black tracking-tight text-[color:var(--pt-ink)]">
              {receipt.reference}
            </p>
            <p className="mt-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("courrierLibre.sent.note")}</p>
          </>
        ) : (
          <p className="mt-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
            {t("courrierLibre.sent.noReference", { name: receipt.organismeName })}
          </p>
        )}
        <div className="mt-6">{backLink(false)}</div>
      </section>,
    );
  }

  const clearTextError = (name: string) =>
    setTextErrors((previous) => {
      if (!(name in previous)) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });

  const setSenderValue = (key: string, value: string) => {
    setSenderValues((previous) => ({ ...previous, [key]: value }));
    setSenderErrors((previous) => {
      // Un moyen de répondre suffit : saisir le téléphone efface aussi
      // l'erreur « courriel ou téléphone » rangée sous le courriel.
      const keys = key === "tel_portable" ? [key, "courriel"] : [key];
      if (!keys.some((k) => k in previous)) return previous;
      const next = { ...previous };
      for (const k of keys) delete next[k];
      return next;
    });
  };

  const setConsent = (kind: ConsentKind, granted: boolean) => {
    setConsents((previous) => ({ ...previous, [kind]: granted }));
    setSenderErrors((previous) => {
      const key = consentErrorKey(kind);
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;

    const draft = toCourrierDraft({ subject, body }, category, senderValues);
    const split = splitCourrierErrors(validateCourrier(draft, files), category);
    const identityErrors: FieldErrors = { ...split.sender, ...validateConsents(consents) };
    setTextErrors(split.text);
    setSenderErrors(identityErrors);
    if (Object.keys(split.text).length > 0 || Object.keys(identityErrors).length > 0) {
      setSubmitFailedAt((n) => n + 1);
      return;
    }

    setSending(true);
    setSendFailure(null);
    // La preuve de travail, comme pour une démarche : une panne de `/v1/defi`
    // n'empêche pas de tenter l'envoi (voir `challengeToSolve`).
    const toSolve = challengeToSolve(await fetchDepositChallenge());
    const challenge = toSolve === null ? null : await solveChallenge(toSolve, 2000, submissionId);
    const result = await sendCourrier(
      {
        organisme: organisme.isTenant ? null : (organisme.slug ?? slug),
        submissionId,
        courrier: draft,
        consents: toConsentAnswers(consents),
        files,
      },
      challenge,
    );
    setSending(false);
    if (result.ok) setReceipt(result.receipt);
    else setSendFailure(result.reason);
  };

  return shell(
    <>
      <nav className="mb-6">{backLink(true)}</nav>

      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">{title}</h1>
      <p className="mt-2 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
        {t("courrierLibre.intro", { name: organisme.name })}
      </p>

      <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-6">
        {errorCount > 0 && <ErrorSummary ref={errorSummaryRef} count={errorCount} />}

        {sendFailure !== null && (
          <div
            role="alert"
            className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
          >
            {t(courrierSendErrorKey(sendFailure))}
          </div>
        )}

        <div className="flex flex-col gap-4 rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] p-5">
          <TextField
            id="courrier-objet"
            label={t("courrierLibre.subject")}
            value={subject}
            onChange={(value) => {
              setSubject(value);
              clearTextError("subject");
            }}
            error={errorText(lang, textErrors.subject)}
            maxLength={MAX_SUBJECT}
          />
          <TextField
            id="courrier-message"
            label={t("courrierLibre.body")}
            value={body}
            onChange={(value) => {
              setBody(value);
              clearTextError("body");
            }}
            error={errorText(lang, textErrors.body)}
            maxLength={MAX_BODY}
            multiline
          />
          <FilesField
            files={files}
            onChange={(next) => {
              setFiles(next);
              clearTextError("files");
            }}
            error={filesError}
            onError={setFileNotice}
            disabled={sending}
          />
        </div>

        <RequesterSection
          audiences={[...SENDER_CATEGORIES]}
          audience={category}
          onAudienceChange={(next) => {
            setCategory(next);
            // Changer de public change les champs : les erreurs de l'ancien ne désignent plus rien.
            setSenderErrors({});
          }}
          fields={fields}
          values={senderValues}
          onChange={setSenderValue}
          errors={senderErrors}
          consents={consents}
          onConsentChange={setConsent}
          // ⚠️ Le nom de l'organisme DESTINATAIRE : c'est lui que Clara nomme
          // dans la phrase qu'elle consigne, pas la collectivité du domaine.
          organismName={organisme.name}
          note={
            <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("courrierLibre.contactHint")}</p>
          }
        />

        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={sending}
            className="rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90 disabled:opacity-60"
          >
            {t(sending ? "courrierLibre.submitting" : "courrierLibre.submit")}
          </button>
          <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
        </div>
      </form>
    </>,
  );
}
