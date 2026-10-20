/**
 * Les briques de formulaire du compte : champ, mot de passe (avec règles en
 * direct et bouton afficher/masquer), case à cocher, et le retour d'erreurs.
 *
 * Même motif que `SuiviForm` : un résumé qui reçoit le focus après un envoi
 * refusé (RGAA 10.7 / 11.10), et pour chaque champ un message relié par
 * `aria-describedby` avec `aria-invalid`.
 *
 * ⚠️ LES RÈGLES DE MOT DE PASSE NE SONT PAS UNE ZONE `aria-live` : une annonce à
 * chaque frappe noierait un lecteur d'écran. La liste est reliée au champ par
 * `aria-describedby` — elle est lue quand on entre dans le champ — et chaque
 * ligne dit son état en toutes lettres (« respectée » / « à respecter »), pas
 * seulement par l'icône.
 */
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { ErrorSummary } from "@/features/demarche/ErrorSummary.tsx";
import { inputClass, invalidClass } from "@/features/demarche/RequesterSection.tsx";
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import type { AccountClientFailure } from "@/services/portal/accountClient.ts";
import { useReportErrorCount } from "./AccountFrame.tsx";
import { accountFailureKey } from "./failureMessage.ts";
import { PASSWORD_RULE_KEYS, passwordRuleStates } from "./passwordRules.ts";

export const PRIMARY_BUTTON =
  "rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90 disabled:opacity-60";
export const SECONDARY_BUTTON =
  "rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)] disabled:opacity-60";
export const H2 = "text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]";

// ── Retour d'erreurs ─────────────────────────────────────────────────────────

/**
 * L'état des erreurs d'un formulaire : celles de saisie (par champ) ou l'échec
 * d'un envoi. Le résumé / l'alerte reçoivent le focus à chaque refus.
 */
export function useFormFeedback<F extends string>() {
  const [errors, setErrors] = useState<Partial<Record<F, StringKey>>>({});
  const [failure, setFailure] = useState<AccountClientFailure | null>(null);
  // Compte les envois refusés — pas l'erreur elle-même, qui change aussi
  // quand l'usager corrige un champ.
  const [alertedAt, setAlertedAt] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);
  const errorCount = Object.keys(errors).length;

  useReportErrorCount(errorCount);
  useEffect(() => {
    if (alertedAt === 0) return;
    alertRef.current?.focus();
    alertRef.current?.scrollIntoView?.();
  }, [alertedAt]);

  /** Des champs refusés avant l'envoi ; un objet vide les efface. */
  const reject = useCallback((next: Partial<Record<F, StringKey>>) => {
    setFailure(null);
    setErrors(next);
    if (Object.keys(next).length > 0) setAlertedAt((n) => n + 1);
  }, []);

  /** Un envoi échoué ; `null` efface. */
  const fail = useCallback((next: AccountClientFailure | null) => {
    setErrors({});
    setFailure(next);
    if (next !== null) setAlertedAt((n) => n + 1);
  }, []);

  /** L'erreur d'un champ disparaît dès qu'on y retouche. */
  const touch = useCallback((name: F) => {
    setErrors((previous) => {
      if (!(name in previous)) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
  }, []);

  return { errors, failure, errorCount, alertRef, reject, fail, touch };
}

export type FormFeedback<F extends string> = ReturnType<typeof useFormFeedback<F>>;

export function FormFeedbackView<F extends string>({
  feedback,
  messages,
  children,
}: {
  feedback: FormFeedback<F>;
  /** Un texte propre à l'écran pour certains échecs (ex. « mot de passe actuel incorrect »). */
  messages?: Partial<Record<AccountClientFailure, StringKey>>;
  /** Une action liée à l'échec (ex. renvoyer le lien), sous l'alerte. */
  children?: ReactNode;
}) {
  const t = useT();
  const { errorCount, failure, alertRef } = feedback;
  return (
    <>
      {errorCount > 0 && <ErrorSummary ref={alertRef} count={errorCount} />}
      {failure !== null && errorCount === 0 && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
        >
          {t(messages?.[failure] ?? accountFailureKey(failure))}
        </div>
      )}
      {failure !== null && children}
    </>
  );
}

/** Un succès, annoncé aux lecteurs d'écran sans prendre le focus. */
export function StatusNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-3 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]"
    >
      {children}
    </p>
  );
}

// ── Champs ───────────────────────────────────────────────────────────────────

interface InputProps {
  id: string;
  className: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}

export function Field({
  id,
  label,
  error,
  hint,
  describedBy,
  children,
}: {
  id: string;
  label: string;
  error: string | null;
  hint?: string;
  /** Un élément déjà relié au champ (la liste des règles). */
  describedBy?: string;
  children: (props: InputProps) => ReactNode;
}) {
  const t = useT();
  const ids = [hint ? id + "-aide" : null, describedBy ?? null, error !== null ? id + "-erreur" : null].filter(
    (v): v is string => v !== null,
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
        {label}
        <span className="ml-1 text-red-600" aria-hidden="true">
          *
        </span>
        <span className="sr-only">{t("form.required")}</span>
      </label>
      {hint && (
        <p id={id + "-aide"} className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {hint}
        </p>
      )}
      {children({
        id,
        className: inputClass + (error !== null ? " " + invalidClass : ""),
        "aria-invalid": error !== null,
        "aria-describedby": ids.length > 0 ? ids.join(" ") : undefined,
      })}
      {error !== null && (
        <p id={id + "-erreur"} className="text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function EmailField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} error={error}>
      {(props) => (
        <input
          {...props}
          type="email"
          value={value}
          autoComplete="email"
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** Le code à six chiffres d'une application d'authentification. */
export function CodeField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label} error={error}>
      {(props) => (
        <input
          {...props}
          type="text"
          value={value}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value.replace(/\s/g, ""))}
        />
      )}
    </Field>
  );
}

function RuleIcon({ met }: { met: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className="mt-0.5 shrink-0">
      {met ? <path d="m5 12 5 5 9-10" /> : <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

/** Les règles du serveur, cochées ou non, en direct. Reliée au champ par `aria-describedby`. */
export function PasswordRules({ id, password }: { id: string; password: string }) {
  const t = useT();
  return (
    <div id={id} className="text-[length:var(--pt-small)]">
      <p className="font-semibold text-[color:var(--pt-ink)]">{t("compte.rules.intro")}</p>
      <ul className="mt-1 flex flex-col gap-1">
        {passwordRuleStates(password).map(({ rule, met }) => (
          <li
            key={rule}
            className={"flex items-start gap-2 " + (met ? "text-[color:var(--pt-ink)]" : "text-[color:var(--pt-muted)]")}
          >
            <RuleIcon met={met} />
            <span>
              {t(PASSWORD_RULE_KEYS[rule])}
              <span className="sr-only"> {t(met ? "compte.rules.met" : "compte.rules.unmet")}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Le bouton afficher/masquer, à partager entre un mot de passe et sa confirmation. */
export function useReveal() {
  const [visible, setVisible] = useState(false);
  return { visible, toggle: () => setVisible((v) => !v) };
}

export function PasswordField({
  id,
  label,
  value,
  error,
  autoComplete,
  onChange,
  showRules = false,
  reveal,
}: {
  id: string;
  label: string;
  value: string;
  error: string | null;
  autoComplete: "current-password" | "new-password";
  onChange: (value: string) => void;
  /** Montre les règles en direct sous le champ (nouveau mot de passe). */
  showRules?: boolean;
  /** Le bouton afficher/masquer, partagé avec la confirmation (un seul réglage pour les deux champs). */
  reveal: { visible: boolean; toggle: () => void };
}) {
  const t = useT();
  const rulesId = useId();
  return (
    <Field id={id} label={label} error={error} describedBy={showRules ? rulesId : undefined}>
      {(props) => (
        <>
          <input
            {...props}
            type={reveal.visible ? "text" : "password"}
            value={value}
            autoComplete={autoComplete}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            onClick={reveal.toggle}
            aria-controls={id}
            className="self-start text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] underline hover:no-underline"
          >
            {t(reveal.visible ? "compte.password.hide" : "compte.password.show")}
          </button>
          {showRules && <PasswordRules id={rulesId} password={value} />}
        </>
      )}
    </Field>
  );
}

export function CheckboxField({
  id,
  checked,
  error,
  help,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  error?: string | null;
  /** Une aide reliée à la case. */
  help?: string;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  const ids = [help ? id + "-aide" : null, error ? id + "-erreur" : null].filter((v): v is string => v !== null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.length > 0 ? ids.join(" ") : undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--brand-primary)]"
        />
        <label htmlFor={id} className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
          {children}
        </label>
      </div>
      {help && (
        <p id={id + "-aide"} className="ml-8 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {help}
        </p>
      )}
      {error && (
        <p id={id + "-erreur"} className="ml-8 text-[length:var(--pt-body)] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
