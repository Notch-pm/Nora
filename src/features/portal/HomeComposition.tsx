/**
 * La page d'accueil composée par la collectivité, rendue pour de vrai.
 *
 * Ce composant possède les deux filtres : la recherche — le champ de la
 * section `recherche`, s'il y en a une — et l'organisme choisi, porté par
 * l'en-tête de chaque grille. Tous deux valent pour toutes les sections
 * `demarches` de la page ; un usager qui a choisi sa commune la garde d'une
 * grille à l'autre. Sans section `recherche`, aucune recherche ne s'applique
 * — il n'y a nulle part où la saisir.
 *
 * L'en-tête (pastille, nom de collectivité, nav, pilule « Mon compte ») est
 * décoratif à ce stade : aucune de ces pages n'existe encore, mieux vaut du
 * texte que des liens morts.
 */
import { useState } from "react";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import { brandingStyle } from "./theme.ts";
import {
  endsWithFooter,
  filterDemarchesByOrganization,
  filterDemarchesByQuery,
  organizationsOffering,
} from "./composition.ts";
import { CompteSection } from "./sections/CompteSection.tsx";
import { DemarchesSection } from "./sections/DemarchesSection.tsx";
import { FooterSection } from "./sections/FooterSection.tsx";
import { RechercheSection } from "./sections/RechercheSection.tsx";
import { TexteSection } from "./sections/TexteSection.tsx";

function PageHeader({ tenantName, logoUrl }: { tenantName: string; logoUrl: string | null }) {
  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-5xl items-center gap-3.5 px-6 py-4">
        {/* Le logo de la collectivité quand elle en a un ; sinon une pastille à
            sa couleur — la page reste reconnaissable sans image. */}
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-7 w-auto max-w-[160px] shrink-0 object-contain" />
        ) : (
          <div
            className="h-[26px] w-[26px] shrink-0 rounded-md bg-[color:var(--brand-primary)]"
            aria-hidden="true"
          />
        )}
        <span className="text-sm font-extrabold tracking-tight text-slate-900">{tenantName}</span>
        <div className="flex-1" />
        {/* Décoratif : ces pages n'existent pas encore, ce ne sont pas des liens. */}
        <div className="hidden items-center gap-4 sm:flex" aria-hidden="true">
          <span className="text-sm text-slate-500">Démarches</span>
          <span className="text-sm text-slate-500">Contact</span>
        </div>
        <span className="rounded-full border border-[color:var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-[color:var(--brand-primary)]">
          Mon compte
        </span>
      </div>
    </header>
  );
}

export function HomeComposition({
  tenant,
  demarches,
  page,
  branding,
}: {
  tenant: Tenant;
  demarches: Demarche[];
  page: HomePage;
  branding: Branding | null;
}) {
  const [query, setQuery] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const hasRecherche = page.sections.some((section) => section.kind === "recherche");
  const searchActive = hasRecherche && query.trim() !== "";
  const organizations = organizationsOffering(demarches, tenant.id);
  const visibleDemarches = filterDemarchesByOrganization(
    hasRecherche ? filterDemarchesByQuery(demarches, query) : demarches,
    organizationId,
  );

  // Un pied de page en dernière position EST le bas de la page : il est poussé
  // au bord (`mt-auto`) et rien ne le suit. Sans lui, la page garde une marge
  // basse. Les autres sections vivent dans le conteneur centré.
  const footerLast = endsWithFooter(page.sections);

  return (
    <main
      className={"flex min-h-screen flex-col bg-white text-slate-800 " + (footerLast ? "" : "pb-8")}
      style={brandingStyle(branding)}
    >
      <PageHeader tenantName={tenant.name} logoUrl={branding?.logoUrl ?? null} />
      <div className="flex flex-1 flex-col gap-6 pt-8">
        {page.sections.map((section) => {
          if (section.kind === "footer") {
            return (
              <div key={section.id} className="mt-auto">
                <FooterSection section={section} />
              </div>
            );
          }
          return (
            <div key={section.id} className="mx-auto w-full max-w-5xl px-6">
              {(() => {
                switch (section.kind) {
                  case "recherche":
                    return (
                      <RechercheSection
                        section={section}
                        demarches={demarches}
                        query={query}
                        onQueryChange={setQuery}
                      />
                    );
                  case "demarches":
                    return (
                      <DemarchesSection
                        section={section}
                        demarches={visibleDemarches}
                        organizations={organizations}
                        organizationId={organizationId}
                        onOrganizationChange={setOrganizationId}
                        searchActive={searchActive}
                      />
                    );
                  case "compte":
                    return <CompteSection section={section} />;
                  case "texte":
                    return <TexteSection section={section} />;
                }
              })()}
            </div>
          );
        })}
      </div>
    </main>
  );
}
