/**
 * La page de l'assistant conversationnel — `/assistant`.
 *
 * Réutilise le cadre des autres écrans (`DemarcheShell`, `usePortal`) : même
 * charte, même en-tête, même façon de résoudre la langue servie.
 *
 * ⚠️ **CE N'EST PLUS LA PORTE D'ENTRÉE.** Depuis le 2026-09-21, l'assistant naît
 * du champ de recherche de l'accueil et s'y déroule SUR PLACE, sans changer
 * d'adresse (`HomeComposition`). Cette page reste pour trois usages : un lien
 * partagé ou mis en favori, un accueil sans section « recherche » d'où
 * l'assistant n'aurait sinon aucune porte, et `?demarche=` depuis la page d'une
 * démarche. La conversation elle-même est la même — `AssistantConversation`,
 * montée ici avec son chrome de page.
 *
 * ⚠️ **Fermé au doute** : `tenant.assistant.enabled` gouverne tout — faux, et la
 * page ne fait AUCUNE requête vers `/v1/assistant*` (voir `domain/assistant.ts`
 * côté fonctions : un Socle d'avant ce contrat, ou une réponse abîmée, ferme).
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
import { AssistantConversation } from "./AssistantConversation.tsx";
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
          <p className="mb-6 mt-2 max-w-[62ch] text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
            {t("assistant.lead")}
          </p>
          <AssistantConversation
            demarches={demarches}
            lang={lang}
            focusDemarcheId={focusDemarcheId}
            depositEnabled={tenant.assistant.depositEnabled}
          />
        </>
      ) : (
        <AssistantDisabled lang={lang} />
      )}
    </DemarcheShell>
  );
}
