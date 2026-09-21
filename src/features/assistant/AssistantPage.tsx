/**
 * La page de l'assistant conversationnel — `/assistant`. Un CADRE, rien de
 * plus : le fil lui-même est dans `AssistantThread`, partagé avec la bulle.
 *
 * Réutilise le cadre des autres écrans (`DemarcheShell`, `usePortal`) : même
 * charte, même en-tête, même façon de résoudre la langue servie.
 *
 * ⚠️ **Fermé au doute** : `tenant.assistant.enabled` gouverne tout — faux, et
 * la page ne fait AUCUNE requête vers `/v1/assistant*` (voir `domain/assistant.ts`
 * côté fonctions : un Socle d'avant ce contrat, ou une réponse abîmée, ferme).
 *
 * ⚠️ **Cette page est le REPLI GRAND FORMAT de la bulle**, et c'est ce qui rend
 * la bulle acceptable au regard du zoom (RGAA 10.4). Ici le fil est en flux
 * normal de page, sans cadre à hauteur fixe ni défilement interne : un zoom à
 * 200 % agrandit tout le contenu sans rien couper. Le panneau flottant, lui,
 * passe en plein écran sous 40rem — ce qu'un zoom à 200 % atteint mécaniquement
 * — et porte en permanence un lien « voir en grand » vers ici. Le fil et le
 * recueil vivant en `sessionStorage`, la conversation se poursuit à l'identique
 * d'un cadre à l'autre. ⚠️ Ne pas donner de hauteur fixe à cette page-ci : elle
 * ne serait plus un repli.
 */
import { useEffect } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "@/features/demarche/DemarcheShell.tsx";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { usePortal } from "@/features/portal/usePortal.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath, servedLanguage, splitScopedPath } from "@/i18n/localizedPath.ts";
import { assistantTitle, errorPageTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";
import { AssistantThread } from "./AssistantThread.tsx";
import { LINK_CLASS } from "./cardStyles.ts";


function AssistantDisabled({ lang }: { lang: string }) {
  const t = useT();
  return (
    <>
      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
        {t("assistant.disabled.title")}
      </h1>
      <p className="mt-3 text-[color:var(--pt-muted)]">{t("assistant.disabled.detail")}</p>
      <Link to={localizedPath(lang, "/")} className={LINK_CLASS + " mt-6 inline-flex"}>
        {t("demarche.backHome")}
      </Link>
    </>
  );
}

export function AssistantPage() {
  const [searchParams] = useSearchParams();
  // ⚠️ Non validé ici : un identifiant invalide ou périmé s'efface tout seul,
  // faute d'être trouvé dans `demarches` (le catalogue publié) — voir
  // `AssistantConversation`. Le serveur, de son côté, revalide aussi le sien
  // (`UUID_RE`, catalogue) avant de le lire.
  const focusDemarcheId = searchParams.get("demarche");
  const location = useLocation();
  const { organisme } = splitScopedPath(location.pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state, retry } = usePortal(lang);

  // Le serveur a tranché la langue : l'adresse s'y aligne, mais seulement sur
  // une réponse à jour (voir `PortalPage`, même motif).
  const served = servedLanguage(state.status === "ready" ? state : null, lang);
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  // Le titre de l'onglet (RGAA 8.6), posé avant tout retour anticipé.
  useDocumentTitle(
    state.status === "error"
      ? errorPageTitle(lang, errorMessageFor(state.reason, lang).title)
      : state.status !== "ready"
        ? t("page.title")
        : assistantTitle(lang, state.tenant.name),
  );

  // ⚠️ LA COLLECTIVITÉ ENTIÈRE, JAMAIS UN ORGANISME — même raison
  // qu'`AccessibilitePage` : l'assistant répond sur tout le catalogue publié,
  // pas sur celui d'un seul organisme, et n'a donc pas de page « à lui » sous
  // un périmètre. `/mairie-de-cahors/assistant` ramène à `/assistant`, en
  // conservant `?demarche=…` et le reste de la requête.
  if (organisme !== null) {
    return <Navigate to={localizedPath(lang, "/assistant") + location.search} replace />;
  }

  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        <Link to={localizedPath(lang, "/")} className={LINK_CLASS}>
          {t("demarche.backHome")}
        </Link>
      </DemarcheError>
    );
  }

  const { tenant, villes, demarches, branding } = state;

  return (
    <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
    >
      {tenant.assistant.enabled ? (
        <>
          <nav className="mb-6">
            <Link to={localizedPath(lang, "/")} className={LINK_CLASS}>
              {t("assistant.allDemarches")}
            </Link>
          </nav>
          <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
            {t("assistant.title")}
          </h1>
          <p className="mt-2 max-w-[62ch] text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
            {t("assistant.lead")}
          </p>
          <div className="mt-6">
            <AssistantThread
              demarches={demarches}
              lang={lang}
              focusDemarcheId={focusDemarcheId}
              depositEnabled={tenant.assistant.depositEnabled}
              variant="page"
            />
          </div>
        </>
      ) : (
        <AssistantDisabled lang={lang} />
      )}
    </DemarcheShell>
  );
}
