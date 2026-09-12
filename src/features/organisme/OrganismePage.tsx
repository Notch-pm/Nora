/**
 * La page d'un organisme : les démarches d'UNE seule commune ou d'UN seul
 * service de la collectivité, à ses couleurs et sous son logo — pas la page
 * composée par la collectivité, qui parle en son nom à elle et dont la prose
 * n'a rien à faire sous le logo d'une mairie qui n'en est que membre.
 *
 * ⚠️ PAS D'`OrganizationFilter` ICI : cette page EN EST un — elle ne montre
 * QUE les démarches de l'organisme visité, sans possibilité d'en choisir un
 * autre. Le filtre « Je suis… » reste, lui, pertinent : qui je suis et à qui
 * je m'adresse restent deux questions différentes.
 *
 * Le thème (formes, typographie, densité) vient de la collectivité —
 * `tenant.theme` — quand la charte (couleurs, logo) vient de l'organisme —
 * `branding`, déjà résolu côté serveur. C'est exactement la séparation que
 * `themeStyle` implémente ; ce composant ne fait que la lui laisser faire.
 *
 * Les liens vers une démarche restent sous le préfixe de l'organisme
 * (`/{slug}/demarches/{id}`, via la prop `basePath` de `DemarcheCard`) : un
 * usager qui commence une démarche depuis cette page ne doit pas se
 * retrouver sous l'adresse générale de la collectivité, qu'il n'a peut-être
 * jamais visitée.
 *
 * ⚠️ LE SLUG SE LIT DANS L'ADRESSE, PAS DANS UN PARAMÈTRE DE ROUTE : ce
 * composant appelle `splitScopedPath` (`i18n/localizedPath.ts`), la même
 * règle lexicale que le routage et les liens partagent. Il n'a donc pas à
 * connaître le nom que `App.tsx` donne à son paramètre de route, ni même
 * l'existence d'un tel paramètre.
 */
import { useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import { audiencesOffered, gridColumnsClass } from "@/features/portal/composition.ts";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { AccessibilityNotice } from "@/features/portal/AccessibilityNotice.tsx";
import { PageHeader } from "@/features/portal/PageHeader.tsx";
import { PortalLoader } from "@/features/portal/PortalLoader.tsx";
import { AudienceFilter } from "@/features/portal/sections/AudienceFilter.tsx";
import { DemarcheCard } from "@/features/portal/sections/DemarcheCard.tsx";
import { SearchIcon } from "@/features/portal/sections/RechercheSection.tsx";
import { headerLogoUrl, themeStyle } from "@/features/portal/themeStyle.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath, servedLanguage, splitScopedPath } from "@/i18n/localizedPath.ts";
import { organismeEmptyKey, visibleOrganismeDemarches } from "./composition.ts";
import { useOrganisme } from "./useOrganisme.ts";

/** Même gabarit que l'écran d'erreur du portail (`PortalPage`, non exporté). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-[color:var(--pt-ink)]">
      {children}
    </main>
  );
}

export function OrganismePage() {
  const location = useLocation();
  // Repli sur une chaîne vide, en théorie inatteignable : cette page n'est
  // rendue QUE sous une adresse d'organisme. Si elle l'était sans, ce slug
  // vide échouera au chargement comme n'importe quel slug inconnu, et
  // renverra tout aussi bien à l'accueil — voir la garde `organisme_unavailable`
  // plus bas.
  const slug = splitScopedPath(location.pathname).organisme ?? "";
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state, retry } = useOrganisme(lang, slug);

  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<Audience | null>(null);

  // ⚠️ Même garde que `PortalPage` : l'adresse ne s'aligne que sur une
  // réponse à jour (voir `servedLanguage`), jamais sur l'état « prêt » d'une
  // langue déjà quittée.
  const served = servedLanguage(state.status === "ready" ? state : null, lang);
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  if (state.status === "loading") return <PortalLoader />;

  if (state.status === "error") {
    // ⚠️ CE CAS NE S'EXPLIQUE PAS, IL SE CORRIGE : voir `errorMessages.ts`
    // (`organisme_unavailable` n'y est délibérément pas réessayable). Un slug
    // inventé, périmé, ou celui de la collectivité elle-même n'est pas une
    // panne à décrire — c'est une adresse à quitter, vers le portail général.
    // Il n'existe d'ailleurs pas de texte `error.organisme_unavailable.*` :
    // cette branche ne doit jamais tenter de l'afficher.
    if (state.reason === "organisme_unavailable") {
      return <Navigate to={localizedPath(lang, "/")} replace />;
    }
    const message = errorMessageFor(state.reason, lang);
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-slate-900">{message.title}</h1>
        <p className="mt-3 text-slate-600">{message.detail}</p>
        {message.retryable && (
          <button
            type="button"
            onClick={retry}
            className="mt-6 rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            {t("page.retry")}
          </button>
        )}
        <p className="mt-8 text-xs text-slate-400">{t("page.errorCode", { code: state.reason })}</p>
      </Shell>
    );
  }

  const { tenant, organisme, demarches, branding } = state;
  const logoUrl = headerLogoUrl(tenant.theme, branding);
  const audiences = audiencesOffered(demarches);
  const searchActive = query.trim() !== "";
  const visible = visibleOrganismeDemarches(demarches, query, audience);
  // ⚠️ Le slug SERVEUR (`organisme.slug`) prime sur celui de l'adresse : c'est
  // la valeur que l'organisme porte réellement. `organizationBySlug` (voir le
  // domaine) ne résout d'ailleurs jamais un organisme sans slug, donc ce
  // repli sur celui de l'adresse est un filet, pas un cas attendu.
  const basePath = "/" + encodeURIComponent(organisme.slug ?? slug) + "/demarches";

  return (
    <div style={themeStyle(tenant.theme, branding)} className="min-h-screen bg-white">
      <PageHeader
        tenantName={organisme.name}
        logoUrl={logoUrl}
        theme={tenant.theme}
        languages={tenant.languages}
      />

      {/* Le bloc d'identification : le logo de l'en-tête (28 px) ne suffit
          pas à le rendre « bien visible » — c'est ici, en plus grand, à côté
          du nom porté par le seul `h1` de la page. */}
      <section
        className="border-b border-[color:var(--pt-border)]"
        style={{ background: "var(--pt-surface)" }}
      >
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-6 py-10 text-center sm:flex-row sm:text-left">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-[var(--pt-radius-sm)] object-contain sm:h-20 sm:w-20"
            />
          ) : (
            <div
              className="h-16 w-16 shrink-0 rounded-[var(--pt-radius-sm)] sm:h-20 sm:w-20"
              style={{ background: "var(--pt-mark-bg)" }}
              aria-hidden="true"
            />
          )}
          <div>
            <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
              {organisme.name}
            </h1>
            <p className="mt-1 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
              {t("organisme.subtitle")}
            </p>
          </div>
        </div>
      </section>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-3 shadow-[var(--pt-shadow)]">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("search.placeholder")}
              aria-label={t("search.placeholder")}
              className="w-full border-0 bg-transparent p-0 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] outline-none placeholder:text-[color:var(--pt-muted)] focus:outline-none focus:ring-0"
            />
          </div>
          <AudienceFilter audiences={audiences} value={audience} onChange={setAudience} />
        </div>

        {visible.length === 0 ? (
          <p className="rounded-[var(--pt-radius-sm)] border border-dashed border-[color:var(--pt-border)] py-6 text-center text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
            {t(organismeEmptyKey(searchActive, audience))}
          </p>
        ) : (
          <ul className={"grid gap-3 " + gridColumnsClass(3)}>
            {visible.map((demarche) => (
              <DemarcheCard key={demarche.id} demarche={demarche} basePath={basePath} />
            ))}
          </ul>
        )}

        <Link
          to={localizedPath(lang, "/")}
          className="mt-4 self-center text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline focus-visible:underline"
        >
          {t("organisme.backToPortal")}
        </Link>
      </main>

      <AccessibilityNotice theme={tenant.theme} />
    </div>
  );
}
