/**
 * Le cadre commun aux deux pages d'une démarche : la charte de la
 * collectivité, son en-tête, et un conteneur centré.
 *
 * Les deux pages — la présentation et le formulaire — portent la même chrome
 * que l'accueil : un usager qui commence une démarche ne doit pas avoir
 * l'impression de quitter le site de sa collectivité.
 */
import type { ReactNode } from "react";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import type { Ville } from "@fn/_shared/domain/demarche.ts";
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { PageHeader } from "@/features/portal/PageHeader.tsx";
import { PortalLoader } from "@/features/portal/PortalLoader.tsx";
import { SkipLink } from "@/features/portal/SkipLink.tsx";
import { headerLogoUrl, themeStyle } from "@/features/portal/themeStyle.ts";
import { AccessibilityFooter } from "@/features/portal/AccessibilityNotice.tsx";
import { defaultTheme, type PortalTheme } from "@fn/_shared/domain/theme.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";

export function DemarcheShell({
  tenantName,
  branding,
  tenantBranding,
  theme,
  languages,
  villes = [],
  children,
}: {
  tenantName: string | null;
  /** Les langues de la collectivité, pour le sélecteur de l'en-tête. */
  languages?: readonly string[];
  /**
   * Les villes de la collectivité, pour le menu « Ma ville » de l'en-tête.
   * Vide tant que la collectivité n'est pas connue (attente, erreur).
   */
  villes?: Ville[];
  branding: Branding | null;
  /**
   * La charte de la COLLECTIVITÉ, pour la marque de l'en-tête. Sous le
   * périmètre d'un organisme, `branding` est la sienne et peint la page ;
   * l'en-tête, lui, continue de dire sur quel site on est. Absente (attente,
   * erreur, serveur d'avant) : on retombe sur la charte peinte, comme avant.
   */
  tenantBranding?: Branding | null;
  /**
   * Le thème du site. ⚠️ Il vaut pour TOUTES les pages, pas seulement pour
   * l'accueil composé : un usager qui dépose une demande ne doit pas avoir
   * l'impression de changer de site en cours de route. Absent tant que la
   * collectivité n'est pas connue — on prend alors les défauts.
   */
  theme?: PortalTheme;
  children: ReactNode;
}) {
  const applied: PortalTheme = theme ?? defaultTheme();
  return (
    // ⚠️ LE STYLE DU THÈME VIT SUR CETTE RACINE, PAS SUR `<main>` : header et
    // footer en dépendent aussi (leurs `--pt-*`), et un thème posé plus bas ne
    // les atteindrait plus (RGAA 9.2 / 12.6).
    <div
      className="flex min-h-screen flex-col bg-white"
      style={{ ...themeStyle(applied, branding), color: "var(--pt-ink)" }}
    >
      <SkipLink />
      {/* Tant que la collectivité n'est pas connue, l'en-tête reste neutre :
          mieux vaut une barre vide qu'un nom qui change sous les yeux. */}
      <PageHeader
        tenantName={tenantName ?? ""}
        logoUrl={headerLogoUrl(applied, tenantBranding ?? branding)}
        theme={theme}
        languages={languages}
        villes={villes}
      />
      <main id="contenu" tabIndex={-1} className="mx-auto w-full max-w-3xl flex-1 px-6 pb-12 pt-8 focus:outline-none">
        {children}
      </main>
      <AccessibilityFooter theme={theme} />
    </div>
  );
}

/**
 * L'attente — la même que celle de l'accueil.
 *
 * Le cadre n'est PAS rendu ici : sans la collectivité, son en-tête serait une
 * barre vide surmontant un écran vide. Le loader de l'accueil, lui, porte déjà
 * la marque de la collectivité — c'est plus juste que le nom qu'on n'a pas.
 */
export function DemarcheLoading() {
  return <PortalLoader />;
}

/**
 * L'échec, dit à un usager. Le code d'erreur reste affiché : c'est ce qu'il
 * peut citer au support, et ce qu'on cherche dans les journaux.
 */
export function DemarcheError({
  reason,
  onRetry,
  children,
}: {
  reason: PortalLoadFailure;
  onRetry: () => void;
  /** Le retour à l'accueil, que seule la page appelante sait construire. */
  children?: ReactNode;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const message = errorMessageFor(reason, lang);
  return (
    <DemarcheShell tenantName={null} branding={null}>
      <h1 className="text-[length:var(--pt-h2)] font-semibold text-[color:var(--pt-ink)]">{message.title}</h1>
      <p className="mt-3 text-[color:var(--pt-muted)]">{message.detail}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {message.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
          >
            {t("page.retry")}
          </button>
        )}
        {children}
      </div>
      <p className="mt-8 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{t("page.errorCode", { code: reason })}</p>
    </DemarcheShell>
  );
}
