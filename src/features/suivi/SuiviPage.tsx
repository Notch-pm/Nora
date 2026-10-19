/**
 * Le suivi d'une demande déposée sans compte — `/suivi`.
 *
 * L'usager y saisit la référence, son courriel et le code d'accès reçus au
 * dépôt ; le serveur ouvre alors une session invitée limitée à CETTE demande
 * (cookie HttpOnly, voir `suiviClient.ts`). Cet écran ne sait rien de plus que
 * ce que le serveur lui rend : aucune règle d'accès, aucun statut calculé ici.
 *
 * ⚠️ **Page de la COLLECTIVITÉ, pas d'un organisme** : comme la déclaration
 * d'accessibilité, `/mairie-de-x/suivi` ramène à `/suivi`.
 *
 * Le cadre (charte, en-tête) vient du même instantané que la déclaration
 * d'accessibilité — `useAccessibilite` n'en tire que la collectivité, la
 * charte et les langues ; la déclaration elle-même n'est pas lue ici.
 */
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { SuiviAccess } from "@fn/_shared/domain/suivi.ts";
import { useAccessibilite } from "@/features/accessibilite/useAccessibilite.ts";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "@/features/demarche/DemarcheShell.tsx";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath, servedLanguage, splitScopedPath } from "@/i18n/localizedPath.ts";
import { errorPageTitle, suiviTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";
import { suiviFailureKey, suiviFailureRetryable } from "./failureMessage.ts";
import { SuiviForm } from "./SuiviForm.tsx";
import { SuiviView } from "./SuiviView.tsx";
import { useSuivi } from "./useSuivi.ts";

const TITLE = "text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]";

function BackToHome() {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <Link
      to={localizedPath(lang, "/")}
      className="text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)] hover:underline"
    >
      {t("demarche.backHome")}
    </Link>
  );
}

export function SuiviPage() {
  const { organisme } = splitScopedPath(useLocation().pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state: tenantState, retry: retryTenant } = useAccessibilite(lang);
  const { state, submit, quit, retry } = useSuivi();
  const [formErrors, setFormErrors] = useState(0);
  // Vrai entre la saisie réussie et l'affichage de la vue : c'est alors, et
  // alors seulement, que le focus va au titre (un rechargement n'y touche pas).
  const justOpened = useRef(false);

  // Le serveur a tranché la langue : l'adresse s'y aligne, mais seulement sur
  // une réponse à jour (voir `servedLanguage`).
  const served = servedLanguage(
    tenantState.status === "ready" ? { requested: tenantState.requested, lang: tenantState.snapshot.lang } : null,
    lang,
  );
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  // Le titre de l'onglet (RGAA 8.6), posé avant tout retour anticipé.
  useDocumentTitle(
    tenantState.status === "error"
      ? errorPageTitle(lang, errorMessageFor(tenantState.reason, lang).title)
      : tenantState.status !== "ready"
        ? t("page.title")
        : suiviTitle(tenantState.snapshot.lang, tenantState.snapshot.tenant.name, state.status === "form" ? formErrors : 0),
  );

  if (organisme !== null) return <Navigate to={localizedPath(lang, "/suivi")} replace />;
  if (tenantState.status === "loading") return <DemarcheLoading />;
  if (tenantState.status === "error") {
    return (
      <DemarcheError reason={tenantState.reason} onRetry={retryTenant}>
        <BackToHome />
      </DemarcheError>
    );
  }

  const { tenant, villes, branding, tenantBranding } = tenantState.snapshot;

  const open = async (access: SuiviAccess) => {
    justOpened.current = true;
    const failure = await submit(access);
    if (failure !== null) justOpened.current = false;
    return failure;
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
        <BackToHome />
      </nav>

      {state.status === "loading" && (
        <>
          <h1 className={TITLE}>{t("suivi.title")}</h1>
          {/* Annoncé aux lecteurs d'écran sans prendre le focus. */}
          <p role="status" aria-live="polite" className="mt-6 text-[color:var(--pt-muted)]">
            {t("suivi.loading")}
          </p>
        </>
      )}

      {state.status === "error" && (
        <>
          <h1 className={TITLE}>{t("suivi.title")}</h1>
          <div role="alert" className="mt-6 rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800">
            {t(suiviFailureKey(state.reason))}
          </div>
          {suiviFailureRetryable(state.reason) && (
            <button
              type="button"
              onClick={retry}
              className="mt-4 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
            >
              {t("page.retry")}
            </button>
          )}
        </>
      )}

      {state.status === "form" && (
        <>
          <h1 className={TITLE}>{t("suivi.title")}</h1>
          <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("suivi.intro")}</p>
          <SuiviForm expired={state.expired} onSubmit={open} onErrorCount={setFormErrors} />
        </>
      )}

      {state.status === "ready" && (
        <SuiviView
          demande={state.demande}
          focusTitle={justOpened.current}
          onQuit={() => {
            justOpened.current = false;
            void quit();
          }}
        />
      )}
    </DemarcheShell>
  );
}
