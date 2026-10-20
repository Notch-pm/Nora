/**
 * Le cadre commun des écrans du compte citoyen (`/compte/*`).
 *
 * Ce que chaque page aurait sinon à refaire : lire la collectivité (même
 * instantané que `/suivi`), aligner l'adresse sur la langue servie, poser le
 * titre de l'onglet (RGAA 8.6, préfixé du nombre d'erreurs après une saisie
 * refusée), peindre la charte, et ramener un périmètre d'organisme à la
 * collectivité — le compte vaut pour la collectivité entière.
 *
 * ⚠️ Les pages du compte sont de la COLLECTIVITÉ, pas d'un organisme :
 * `/mairie-de-x/compte/connexion` ramène à `/compte/connexion`.
 */
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { useAccessibilite } from "@/features/accessibilite/useAccessibilite.ts";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "@/features/demarche/DemarcheShell.tsx";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath, servedLanguage, splitScopedPath } from "@/i18n/localizedPath.ts";
import { compteTitle, errorPageTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";

export const LINK_CLASS =
  "font-semibold text-[color:var(--brand-primary)] underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)]";

const TITLE = "text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)] focus:outline-none";

/** Le nombre d'erreurs de saisie affichées, remonté au cadre pour le titre de l'onglet. */
const ErrorCountContext = createContext<(count: number) => void>(() => {});

/** L'intitulé de l'écran (ou de l'étape) en cours, qui nomme l'onglet. */
const ScreenTitleContext = createContext<(title: string) => void>(() => {});

export function useScreenTitle(title: string): void {
  const set = useContext(ScreenTitleContext);
  useEffect(() => {
    set(title);
  }, [title, set]);
}

export function useReportErrorCount(count: number): void {
  const report = useContext(ErrorCountContext);
  useEffect(() => {
    report(count);
    return () => report(0);
  }, [count, report]);
}

/**
 * L'unique `h1` d'un écran.
 *
 * `focusOnMount` : le titre reçoit le focus à son apparition. À poser sur les
 * ÉTAPES qui en remplacent une autre (code de double authentification, courriel
 * envoyé, résultat d'un lien) — pas sur le premier affichage de la page, qui
 * ne doit pas voler le focus au lien d'évitement.
 */
export function StepTitle({ focusOnMount = false, children }: { focusOnMount?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);
  return (
    <h1 ref={ref} tabIndex={-1} className={TITLE}>
      {children}
    </h1>
  );
}

export function AccountFrame({ children }: {
  /** Reçoit le nom de la collectivité ; l'écran pose son titre d'onglet par `useScreenTitle`. */
  children: (tenantName: string) => ReactNode;
}) {
  const { organisme, path } = splitScopedPath(useLocation().pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state: tenantState, retry } = useAccessibilite(lang);
  const [errorCount, setErrorCount] = useState(0);
  const [title, setTitle] = useState("");

  const served = servedLanguage(
    tenantState.status === "ready" ? { requested: tenantState.requested, lang: tenantState.snapshot.lang } : null,
    lang,
  );
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  useDocumentTitle(
    tenantState.status === "error"
      ? errorPageTitle(lang, errorMessageFor(tenantState.reason, lang).title)
      : tenantState.status !== "ready"
        ? t("page.title")
        : title === ""
          ? t("page.title")
          : compteTitle(tenantState.snapshot.lang, title, tenantState.snapshot.tenant.name, errorCount),
  );

  if (organisme !== null) return <Navigate to={localizedPath(lang, path)} replace />;
  if (tenantState.status === "loading") return <DemarcheLoading />;
  if (tenantState.status === "error") {
    return (
      <DemarcheError reason={tenantState.reason} onRetry={retry}>
        <Link to={localizedPath(lang, "/")} className={LINK_CLASS}>
          {t("demarche.backHome")}
        </Link>
      </DemarcheError>
    );
  }

  const { tenant, villes, branding, tenantBranding } = tenantState.snapshot;
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
        <Link to={localizedPath(lang, "/")} className={LINK_CLASS}>
          {t("demarche.backHome")}
        </Link>
      </nav>
      <ScreenTitleContext.Provider value={setTitle}>
        <ErrorCountContext.Provider value={setErrorCount}>{children(tenant.name)}</ErrorCountContext.Provider>
      </ScreenTitleContext.Provider>
    </DemarcheShell>
  );
}
