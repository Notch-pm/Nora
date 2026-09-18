/**
 * La déclaration d'accessibilité — `/accessibilite`.
 *
 * C'est la page vers laquelle mène la mention du pied de page, sur tous les
 * écrans du portail. La collectivité la rédige dans l'onglet « Contenus » de
 * l'éditeur du Socle ; le portail la rend, rien de plus.
 *
 * ⚠️ **Page de la COLLECTIVITÉ, pas d'un organisme.** La déclaration porte sur
 * le site entier : `/mairie-de-x/accessibilite` ramène à `/accessibilite`
 * plutôt que de laisser croire à une déclaration propre à la mairie.
 *
 * ⚠️ **Le texte est en français, et le dit** (RGAA 8.7) : servie dans une
 * autre langue, la page porte son titre traduit, mais la déclaration garde
 * `lang="fr"` — un lecteur d'écran la prononce alors correctement — et une
 * phrase prévient l'usager qu'elle n'est pas traduite.
 */
import { useEffect } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "@/features/demarche/DemarcheShell.tsx";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import {
  localizedPath,
  PIVOT_LANGUAGE,
  servedLanguage,
  splitScopedPath,
} from "@/i18n/localizedPath.ts";
import { accessibiliteTitle, errorPageTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";
import { Markdown } from "@/features/portal/Markdown.tsx";
import { useAccessibilite } from "./useAccessibilite.ts";

function BackToHome({ subtle = false }: { subtle?: boolean }) {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <Link
      to={localizedPath(lang, "/")}
      className={
        subtle
          ? "text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)] hover:underline"
          : "rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
      }
    >
      {t("demarche.backHome")}
    </Link>
  );
}

export function AccessibilitePage() {
  const { organisme } = splitScopedPath(useLocation().pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state, retry } = useAccessibilite(lang);

  // Le serveur a tranché la langue : l'adresse s'y aligne, mais seulement sur
  // une réponse à jour (voir `servedLanguage`).
  const served = servedLanguage(
    state.status === "ready" ? { requested: state.requested, lang: state.snapshot.lang } : null,
    lang,
  );
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  // Le titre de l'onglet (RGAA 8.6), posé avant tout retour anticipé.
  useDocumentTitle(
    state.status === "error"
      ? errorPageTitle(lang, errorMessageFor(state.reason, lang).title)
      : state.status !== "ready"
        ? t("page.title")
        : accessibiliteTitle(state.snapshot.lang, state.snapshot.tenant.name),
  );

  if (organisme !== null) return <Navigate to={localizedPath(lang, "/accessibilite")} replace />;
  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        <BackToHome />
      </DemarcheError>
    );
  }

  const { tenant, villes, statement, branding, tenantBranding } = state.snapshot;
  const translatedPage = state.snapshot.lang !== PIVOT_LANGUAGE;

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
        <BackToHome subtle />
      </nav>

      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
        {t("accessibilite.title")}
      </h1>

      {statement === null ? (
        <p className="mt-6 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
          {t("accessibilite.unpublished", { name: tenant.name })}
        </p>
      ) : (
        <>
          {translatedPage && (
            <p className="mt-4 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
              {t("accessibilite.frenchOnly")}
            </p>
          )}
          <article lang={translatedPage ? PIVOT_LANGUAGE : undefined} className="mt-4">
            <Markdown source={statement.body} />
          </article>
        </>
      )}
    </DemarcheShell>
  );
}
