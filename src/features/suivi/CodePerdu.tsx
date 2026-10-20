/**
 * « Code perdu ? » — sous la saisie du suivi (`/suivi`, espace usager L4a).
 *
 * La référence et l'adresse de courriel déclarée au dépôt suffisent à demander
 * un code NEUF : Iris le tire, l'envoie à cette adresse si elle concorde, et
 * l'ancien cesse de valoir. La réponse est la même que tout concorde ou non —
 * l'écran ne peut donc dire que « si… alors un code est parti » : il ne sait
 * rien de plus, et c'est voulu (personne ne doit pouvoir sonder les demandes).
 *
 * Un `<details>` natif : replié par défaut, ouvrable au clavier, annoncé comme
 * tel par les lecteurs d'écran, sans état à tenir.
 */
import { useRef, useState } from "react";
import { inputClass, invalidClass } from "@/features/demarche/RequesterSection.tsx";
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import { resendSuiviCode, type SuiviClientFailure } from "@/services/portal/suiviClient.ts";
import { suiviFailureKey } from "./failureMessage.ts";

type Field = "reference" | "email";

const REQUIRED: Record<Field, StringKey> = {
  reference: "suivi.required.reference",
  email: "suivi.required.email",
};

export function CodePerdu() {
  const t = useT();
  const [values, setValues] = useState<Record<Field, string>>({ reference: "", email: "" });
  const [errors, setErrors] = useState<Partial<Record<Field, StringKey>>>({});
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: true } | { ok: false; reason: SuiviClientFailure } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const missing: Partial<Record<Field, StringKey>> = {};
    for (const name of ["reference", "email"] as const) {
      if (values[name].trim() === "") missing[name] = REQUIRED[name];
    }
    setErrors(missing);
    setOutcome(null);
    if (Object.keys(missing).length > 0) return;
    setPending(true);
    const result = await resendSuiviCode({ reference: values.reference.trim(), email: values.email.trim() });
    setPending(false);
    setOutcome(result);
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  const field = (name: Field, label: string, type: string, autoComplete: string) => {
    const id = "code-perdu-" + name;
    const error = errors[name];
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
          {label}
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
          <span className="sr-only">{t("form.required")}</span>
        </label>
        <input
          id={id}
          type={type}
          value={values[name]}
          autoComplete={autoComplete}
          spellCheck={false}
          className={inputClass + (error ? " " + invalidClass : "")}
          aria-invalid={error !== undefined}
          aria-describedby={error ? id + "-erreur" : undefined}
          onChange={(event) => {
            const value = event.target.value;
            setValues((previous) => ({ ...previous, [name]: value }));
            setErrors((previous) => {
              if (!(name in previous)) return previous;
              const next = { ...previous };
              delete next[name];
              return next;
            });
          }}
        />
        {error && (
          <p id={id + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
            {t(error)}
          </p>
        )}
      </div>
    );
  };

  return (
    <details className="mt-8 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-3">
      <summary className="cursor-pointer text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)]">
        {t("suivi.lost.title")}
      </summary>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
        <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("suivi.lost.intro")}</p>
        {field("reference", t("suivi.reference"), "text", "off")}
        {field("email", t("suivi.email"), "email", "email")}
        {outcome !== null && (
          <div
            ref={statusRef}
            tabIndex={-1}
            role={outcome.ok ? "status" : "alert"}
            className={
              "rounded-[var(--pt-radius-sm)] border px-4 py-3 text-[length:var(--pt-body)] " +
              (outcome.ok ? "border-[color:var(--pt-border)] text-[color:var(--pt-ink)]" : "border-red-300 bg-red-50 text-red-800")
            }
          >
            {outcome.ok ? t("suivi.lost.sent") : t(suiviFailureKey(outcome.reason))}
          </div>
        )}
        <div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-[var(--pt-radius-sm)] border border-[color:var(--brand-primary)] px-5 py-2.5 text-[length:var(--pt-body)] font-bold text-[color:var(--brand-primary)] hover:opacity-90 disabled:opacity-60"
          >
            {t(pending ? "suivi.lost.submitting" : "suivi.lost.submit")}
          </button>
        </div>
      </form>
    </details>
  );
}
