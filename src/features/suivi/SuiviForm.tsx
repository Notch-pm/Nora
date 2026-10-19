/**
 * La saisie de l'accès au suivi : référence, courriel, code d'accès.
 *
 * Validation de PRÉSENCE seulement : savoir si les trois valeurs ouvrent une
 * demande est l'affaire du serveur, qui répond par un refus unique (voir
 * `failureMessage.ts`). Le motif d'erreurs est celui du formulaire d'une
 * démarche : un résumé qui reçoit le focus (RGAA 10.7 / 11.10), et pour chaque
 * champ un message relié par `aria-describedby` avec `aria-invalid`.
 */
import { useEffect, useRef, useState } from "react";
import type { SuiviAccess } from "@fn/_shared/domain/suivi.ts";
import { ErrorSummary } from "@/features/demarche/ErrorSummary.tsx";
import { inputClass, invalidClass } from "@/features/demarche/RequesterSection.tsx";
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import type { SuiviClientFailure } from "@/services/portal/suiviClient.ts";
import { suiviFailureKey } from "./failureMessage.ts";

type FieldName = keyof SuiviAccess;

const REQUIRED_KEYS: Record<FieldName, StringKey> = {
  reference: "suivi.required.reference",
  email: "suivi.required.email",
  code: "suivi.required.code",
};

function Field({
  name,
  label,
  error,
  children,
}: {
  name: FieldName;
  label: string;
  error: string | null;
  children: (props: {
    id: string;
    className: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
}) {
  const t = useT();
  const id = "suivi-" + name;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
        {label}
        <span className="ml-1 text-red-600" aria-hidden="true">
          *
        </span>
        <span className="sr-only">{t("form.required")}</span>
      </label>
      {children({
        id,
        className: inputClass + (error !== null ? " " + invalidClass : ""),
        "aria-invalid": error !== null,
        "aria-describedby": error !== null ? id + "-erreur" : undefined,
      })}
      {error !== null && (
        <p id={id + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function SuiviForm({
  expired,
  onSubmit,
  onErrorCount,
}: {
  /** L'accès qu'on tenait n'existe plus : une phrase le dit au-dessus de la saisie. */
  expired: boolean;
  /** Tente l'accès ; rend l'échec à afficher, ou `null` quand c'est ouvert. */
  onSubmit: (access: SuiviAccess) => Promise<SuiviClientFailure | null>;
  /** Le nombre d'erreurs de saisie, pour le titre de l'onglet. */
  onErrorCount: (count: number) => void;
}) {
  const t = useT();
  const [values, setValues] = useState<SuiviAccess>({ reference: "", email: "", code: "" });
  const [errors, setErrors] = useState<Partial<Record<FieldName, StringKey>>>({});
  const [failure, setFailure] = useState<SuiviClientFailure | null>(null);
  const [pending, setPending] = useState(false);
  // Compte les envois refusés ou échoués — pas l'erreur elle-même, qui change
  // aussi quand l'usager corrige un champ (même raison que `FormulairePage`).
  const [alertedAt, setAlertedAt] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const errorCount = Object.keys(errors).length;

  useEffect(() => {
    onErrorCount(errorCount);
  }, [errorCount, onErrorCount]);

  useEffect(() => {
    if (alertedAt === 0) return;
    alertRef.current?.focus();
    alertRef.current?.scrollIntoView();
  }, [alertedAt]);

  const set = (name: FieldName, value: string) => {
    setValues((previous) => ({ ...previous, [name]: value }));
    // L'erreur d'un champ disparaît dès qu'on y retouche.
    setErrors((previous) => {
      if (!(name in previous)) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setFailure(null);

    const missing: Partial<Record<FieldName, StringKey>> = {};
    for (const name of ["reference", "email", "code"] as const) {
      if (values[name].trim() === "") missing[name] = REQUIRED_KEYS[name];
    }
    setErrors(missing);
    if (Object.keys(missing).length > 0) {
      setAlertedAt((n) => n + 1);
      return;
    }

    setPending(true);
    const result = await onSubmit({
      reference: values.reference.trim(),
      email: values.email.trim(),
      code: values.code.trim(),
    });
    // Ouvert : la page remplace ce formulaire, rien à mettre à jour ici.
    if (result === null) return;
    setPending(false);
    setFailure(result);
    setAlertedAt((n) => n + 1);
  };

  return (
    <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-5">
      {expired && failure === null && (
        <p className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-3 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
          {t("suivi.error.expired")}
        </p>
      )}

      {errorCount > 0 && <ErrorSummary ref={alertRef} count={errorCount} />}

      {failure !== null && errorCount === 0 && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
        >
          {t(suiviFailureKey(failure))}
        </div>
      )}

      <Field name="reference" label={t("suivi.reference")} error={errors.reference ? t(errors.reference) : null}>
        {(props) => (
          <input
            {...props}
            type="text"
            value={values.reference}
            placeholder="DEM-2026-000123"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => set("reference", event.target.value)}
          />
        )}
      </Field>

      <Field name="email" label={t("suivi.email")} error={errors.email ? t(errors.email) : null}>
        {(props) => (
          <input
            {...props}
            type="email"
            value={values.email}
            autoComplete="email"
            spellCheck={false}
            onChange={(event) => set("email", event.target.value)}
          />
        )}
      </Field>

      <Field name="code" label={t("suivi.code")} error={errors.code ? t(errors.code) : null}>
        {(props) => (
          <input
            {...props}
            type="text"
            value={values.code}
            placeholder="XXXX-XXXX-XX"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            onChange={(event) => set("code", event.target.value)}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          {t(pending ? "suivi.submitting" : "suivi.submit")}
        </button>
        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("form.requiredNote")}</p>
      </div>
    </form>
  );
}
