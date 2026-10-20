/**
 * « Mon compte » — `/compte`.
 *
 * L'adresse du compte, la sécurité (mot de passe, double authentification) et la
 * déconnexion. Tout vient du serveur (`GET /v1/compte`) : sans session de
 * compte il répond `session_required`, et l'écran renvoie à la connexion. Une
 * session INVITÉE (celle de `/suivi`) n'ouvre pas cette page.
 */
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import {
  type AccountClientFailure,
  type AccountProfile,
  endAccountSession,
  fetchAccount,
} from "@/services/portal/accountClient.ts";
import { AccountFrame, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import { ChangePasswordForm } from "./ChangePasswordForm.tsx";
import { accountFailureKey } from "./failureMessage.ts";
import { H2, SECONDARY_BUTTON } from "./form.tsx";
import { forgetSessionKind } from "./sessionKind.ts";
import { TotpSection } from "./TotpSection.tsx";

type State =
  | { status: "loading" }
  | { status: "ready"; profile: AccountProfile }
  | { status: "error"; reason: AccountClientFailure };

export function ComptePage() {
  return <AccountFrame>{() => <CompteScreen />}</AccountFrame>;
}

const H3 = "text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]";

function CompteScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [leaveFailed, setLeaveFailed] = useState(false);

  useScreenTitle(t("compte.account.title"));

  useEffect(() => {
    let current = true;
    fetchAccount().then((result) => {
      if (!current) return;
      setState(result.ok ? { status: "ready", profile: result.value } : { status: "error", reason: result.reason });
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  // Après une activation ou un retrait : relire le profil, sans repasser par l'attente.
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  if (state.status === "error" && state.reason === "session_required") {
    forgetSessionKind();
    return <Navigate to={localizedPath(lang, "/compte/connexion")} replace />;
  }

  const leave = async () => {
    setLeaving(true);
    setLeaveFailed(false);
    const result = await endAccountSession();
    // Déjà déconnecté vaut déconnecté ; une panne, non : la session tient peut-être encore.
    if (result.ok || result.reason === "session_required") {
      forgetSessionKind();
      navigate(localizedPath(lang, "/compte/connexion"));
      return;
    }
    setLeaving(false);
    setLeaveFailed(true);
  };

  if (state.status === "loading") {
    return (
      <>
        <StepTitle>{t("compte.account.title")}</StepTitle>
        <p role="status" className="mt-6 text-[color:var(--pt-muted)]">
          {t("page.loading")}
        </p>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        <StepTitle>{t("compte.account.title")}</StepTitle>
        <div role="alert" className="mt-6 rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800">
          {t(accountFailureKey(state.reason))}
        </div>
        <button type="button" onClick={() => { setState({ status: "loading" }); reload(); }} className={SECONDARY_BUTTON + " mt-4"}>
          {t("page.retry")}
        </button>
      </>
    );
  }

  return (
    <>
      <StepTitle>{t("compte.account.title")}</StepTitle>

      <section aria-labelledby="compte-infos" className="mt-8 flex flex-col gap-3">
        <h2 id="compte-infos" className={H2}>
          {t("compte.account.infos")}
        </h2>
        <dl className="text-[length:var(--pt-body)]">
          <dt className="font-semibold text-[color:var(--pt-ink)]">{t("compte.email")}</dt>
          <dd className="break-all text-[color:var(--pt-ink)]">{state.profile.email}</dd>
        </dl>
        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("compte.register.identityLater")}</p>
      </section>

      <section aria-labelledby="compte-securite" className="mt-10 flex flex-col gap-8">
        <h2 id="compte-securite" className={H2}>
          {t("compte.account.security")}
        </h2>
        <div className="flex flex-col gap-4">
          <h3 className={H3}>{t("compte.account.password")}</h3>
          <ChangePasswordForm />
        </div>
        <div className="flex flex-col gap-4">
          <h3 className={H3}>{t("compte.account.totp")}</h3>
          <TotpSection enabled={state.profile.totpEnabled} onChanged={reload} />
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-3 border-t border-[color:var(--pt-border)] pt-6">
        {leaveFailed && (
          <p role="alert" className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800">
            {t("compte.error.unavailable")}
          </p>
        )}
        <div>
          <button type="button" onClick={leave} disabled={leaving} className={SECONDARY_BUTTON}>
            {t(leaving ? "compte.submitting" : "compte.account.logout")}
          </button>
        </div>
      </section>
    </>
  );
}
