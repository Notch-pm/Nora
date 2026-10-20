/**
 * « Mes informations » dans « Mon compte » (espace usager L3b) : la fiche du
 * Socle vue par son titulaire.
 *
 * Deux temps, dictés par le serveur :
 *  • profil jamais rempli (`null`) → l'identité complète (« Complétez vos
 *    informations ») ; elle rattache le compte à une fiche ;
 *  • ensuite → la fiche en lecture, et un seul formulaire, celui des
 *    COORDONNÉES. Civilité, nom, prénom et date de naissance fondent le
 *    rattachement : ils s'affichent sans pouvoir se modifier, avec la phrase qui
 *    dit à qui s'adresser.
 *
 * Aucune règle ici : la validation est celle du serveur (`profilForm.ts`), qui
 * reste juge — ses `champs` en défaut s'affichent champ par champ.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Profil, ProfilChamp } from "@fn/_shared/domain/profil.ts";
import { formatDate } from "@/features/suivi/format.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import {
  fetchProfil,
  type ProfilCall,
  type ProfilClientFailure,
  saveCoordonnees,
  saveIdentite,
} from "@/services/portal/profilClient.ts";
import { accountFailureKey } from "./failureMessage.ts";
import { Field, FormFeedbackView, PRIMARY_BUTTON, SECONDARY_BUTTON, StatusNote, useFormFeedback } from "./form.tsx";
import {
  coordonneesDraftOf,
  EMPTY_IDENTITE,
  errorsOf,
  type IdentiteDraft,
  PROFIL_MESSAGES,
  profilFailureAsAccount,
  validateCoordonnees,
  validateIdentite,
} from "./profilForm.ts";

const H3 = "text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)] focus:outline-none";

type State =
  | { status: "loading" }
  | { status: "ready"; profil: Profil | null }
  | { status: "error"; reason: ProfilClientFailure };

export function ProfilSection({ tenantName, onSessionLost }: { tenantName: string; onSessionLost: () => void }) {
  const t = useT();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    let current = true;
    fetchProfil().then((result) => {
      if (!current) return;
      if (result.ok) setState({ status: "ready", profil: result.value });
      else if (result.reason === "session_required") onSessionLost();
      else setState({ status: "error", reason: result.reason });
    });
    return () => {
      current = false;
    };
  }, [attempt, onSessionLost]);

  // Fermer le formulaire des coordonnées : le focus revient au bouton qui l'a ouvert.
  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  const close = useCallback(() => {
    returnFocus.current = true;
    setEditing(false);
  }, []);

  if (state.status === "loading") {
    return (
      <p role="status" className="text-[color:var(--pt-muted)]">
        {t("page.loading")}
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <div role="alert" className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800">
          {t(PROFIL_MESSAGES[profilFailureAsAccount(state.reason)] ?? accountFailureKey(profilFailureAsAccount(state.reason)))}
        </div>
        <div>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
            className={SECONDARY_BUTTON}
          >
            {t("page.retry")}
          </button>
        </div>
      </>
    );
  }

  const { profil } = state;

  if (profil === null) {
    return (
      <>
        <h3 className={H3}>{t("compte.profil.completeTitle")}</h3>
        <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
          {t("compte.profil.completeIntro", { tenant: tenantName })}
        </p>
        <ProfilForm
          mode="identite"
          initial={EMPTY_IDENTITE}
          onSessionLost={onSessionLost}
          onSaved={(next) => {
            setSaved(true);
            setState({ status: "ready", profil: next });
          }}
        />
      </>
    );
  }

  if (editing) {
    return (
      <>
        <FocusedHeading>{t("compte.profil.editTitle")}</FocusedHeading>
        <ProfilForm
          mode="coordonnees"
          initial={{ ...EMPTY_IDENTITE, ...coordonneesDraftOf(profil) }}
          onSessionLost={onSessionLost}
          onCancel={close}
          onSaved={(next) => {
            setSaved(true);
            setState({ status: "ready", profil: next });
            close();
          }}
        />
      </>
    );
  }

  return (
    <>
      {saved && <StatusNote>{t("compte.profil.saved")}</StatusNote>}
      <ProfilFiche profil={profil} tenantName={tenantName} />
      <div>
        <button
          type="button"
          ref={editButton}
          onClick={() => {
            setSaved(false);
            setEditing(true);
          }}
          className={SECONDARY_BUTTON}
        >
          {t("compte.profil.edit")}
        </button>
      </div>
    </>
  );
}

/** Un titre qui prend le focus à son apparition : l'ouverture du formulaire s'annonce. */
function FocusedHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h3 ref={ref} tabIndex={-1} className={H3}>
      {children}
    </h3>
  );
}

// ── La fiche en lecture ──────────────────────────────────────────────────────

function Row({ label, value }: { label: StringKey; value: string | null }) {
  const t = useT();
  return (
    <>
      <dt className="font-semibold text-[color:var(--pt-ink)]">{t(label)}</dt>
      <dd className="break-words text-[color:var(--pt-ink)]">
        {value ?? <span className="text-[color:var(--pt-muted)]">{t("compte.profil.notFilled")}</span>}
      </dd>
    </>
  );
}

function ProfilFiche({ profil, tenantName }: { profil: Profil; tenantName: string }) {
  const t = useT();
  const { lang } = useLanguage();
  const civilite =
    profil.civilite === "madame" ? t("compte.profil.madame") : profil.civilite === "monsieur" ? t("compte.profil.monsieur") : null;
  const adresse = [profil.adresse1, profil.adresse2, [profil.codePostal, profil.ville].filter(Boolean).join(" ")]
    .filter((line): line is string => typeof line === "string" && line !== "");
  const rows: [StringKey, string | null][] = [
    ["compte.profil.civilite", civilite],
    ["compte.profil.prenom", profil.prenom],
    ["compte.profil.nom", profil.nom],
    ["compte.profil.dateNaissance", profil.dateNaissance === null ? null : formatDate(profil.dateNaissance, lang)],
  ];
  const coordonnees: [StringKey, string | null][] = [
    ["compte.profil.nomUsage", profil.nomUsage],
    ["compte.profil.mobile", profil.mobile],
    ["compte.profil.fixe", profil.fixe],
  ];
  return (
    <>
      <dl className="grid gap-x-6 gap-y-2 text-[length:var(--pt-body)] sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
        {coordonnees.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
        <dt className="font-semibold text-[color:var(--pt-ink)]">{t("compte.profil.adresse1")}</dt>
        <dd className="text-[color:var(--pt-ink)]">
          {adresse.length === 0 ? (
            <span className="text-[color:var(--pt-muted)]">{t("compte.profil.notFilled")}</span>
          ) : (
            adresse.map((line, index) => (
              <span key={index} className="block break-words">
                {line}
              </span>
            ))
          )}
        </dd>
      </dl>
      <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {t("compte.profil.readonly", { tenant: tenantName })}
      </p>
    </>
  );
}

// ── Le formulaire ────────────────────────────────────────────────────────────

function ProfilForm({
  mode,
  initial,
  onSaved,
  onCancel,
  onSessionLost,
}: {
  /** `identite` : premier remplissage ; `coordonnees` : ensuite, les seules zones modifiables. */
  mode: "identite" | "coordonnees";
  initial: IdentiteDraft;
  onSaved: (profil: Profil) => void;
  onCancel?: () => void;
  onSessionLost: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<IdentiteDraft>(initial);
  const [pending, setPending] = useState(false);
  const feedback = useFormFeedback<ProfilChamp>();
  const identite = mode === "identite";

  const set = (key: keyof IdentiteDraft) => (value: string) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    feedback.touch(key);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    let request: Promise<ProfilCall<Profil>>;
    if (identite) {
      const checked = validateIdentite(draft);
      if (!checked.ok) return feedback.reject(checked.errors);
      request = saveIdentite(checked.value);
    } else {
      const checked = validateCoordonnees(draft);
      if (!checked.ok) return feedback.reject(checked.errors);
      request = saveCoordonnees(checked.value);
    }
    feedback.reject({});
    setPending(true);
    const result = await request;
    setPending(false);
    if (result.ok) return onSaved(result.value);
    if (result.reason === "session_required") return onSessionLost();
    if (result.champs) return feedback.reject(errorsOf(result.champs));
    feedback.fail(profilFailureAsAccount(result.reason));
  };

  const text = (
    key: ProfilChamp & keyof IdentiteDraft,
    label: StringKey,
    options: { optional?: boolean; autoComplete?: string; type?: string; inputMode?: "tel" | "numeric"; maxLength?: number } = {},
  ) => (
    <Field
      id={"profil-" + key}
      label={t(label)}
      optional={options.optional}
      error={feedback.errors[key] ? t(feedback.errors[key]!) : null}
    >
      {(props) => (
        <input
          {...props}
          type={options.type ?? "text"}
          value={draft[key]}
          autoComplete={options.autoComplete}
          inputMode={options.inputMode}
          maxLength={options.maxLength}
          onChange={(event) => set(key)(event.target.value)}
        />
      )}
    </Field>
  );

  const civiliteError = feedback.errors.civilite ? t(feedback.errors.civilite) : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <FormFeedbackView feedback={feedback} messages={PROFIL_MESSAGES} />

      {identite && (
        <>
          <fieldset
            aria-describedby={civiliteError !== null ? "profil-civilite-erreur" : undefined}
            className="flex flex-col gap-1.5"
          >
            <legend className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
              {t("compte.profil.civilite")}
              <span className="ml-1 text-red-600" aria-hidden="true">
                *
              </span>
              <span className="sr-only">{t("form.required")}</span>
            </legend>
            <div className="flex flex-wrap gap-6">
              {(["madame", "monsieur"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                  <input
                    type="radio"
                    name="civilite"
                    value={value}
                    checked={draft.civilite === value}
                    onChange={() => set("civilite")(value)}
                    className="h-5 w-5 accent-[color:var(--brand-primary)]"
                  />
                  {t(value === "madame" ? "compte.profil.madame" : "compte.profil.monsieur")}
                </label>
              ))}
            </div>
            {civiliteError !== null && (
              <p id="profil-civilite-erreur" className="text-[length:var(--pt-body)] text-red-600">
                {civiliteError}
              </p>
            )}
          </fieldset>
          {text("prenom", "compte.profil.prenom", { autoComplete: "given-name" })}
          {text("nom", "compte.profil.nom", { autoComplete: "family-name" })}
        </>
      )}

      {text("nomUsage", "compte.profil.nomUsage", { optional: true })}
      {identite && text("dateNaissance", "compte.profil.dateNaissance", { optional: true, type: "date", autoComplete: "bday" })}
      {text("mobile", "compte.profil.mobile", { optional: true, type: "tel", inputMode: "tel", autoComplete: "tel" })}
      {text("fixe", "compte.profil.fixe", { optional: true, type: "tel", inputMode: "tel", autoComplete: "tel" })}
      {text("adresse1", "compte.profil.adresse1", { autoComplete: "address-line1" })}
      {text("adresse2", "compte.profil.adresse2", { optional: true, autoComplete: "address-line2" })}
      {text("codePostal", "compte.profil.codePostal", { autoComplete: "postal-code", inputMode: "numeric", maxLength: 5 })}
      {text("ville", "compte.profil.ville", { autoComplete: "address-level2" })}

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
          {t(pending ? "compte.submitting" : identite ? "compte.profil.submitIdentite" : "compte.profil.submitCoordonnees")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={pending} className={SECONDARY_BUTTON}>
            {t("compte.profil.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
