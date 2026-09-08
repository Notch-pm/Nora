/**
 * La page d'accueil composée par la collectivité, rendue pour de vrai.
 *
 * Ce composant possède les trois filtres : la recherche — le champ de la
 * section `recherche`, s'il y en a une —, l'organisme choisi et le public
 * (« Je suis… »), portés par l'en-tête des grilles. Tous valent pour toutes les
 * sections `demarches` de la page ; un usager qui a choisi sa commune la garde
 * d'une grille à l'autre.
 *
 * ⚠️ UN FILTRE QU'AUCUNE GRILLE NE PROPOSE NE S'APPLIQUE PAS — même règle pour
 * la recherche (sans section `recherche`, il n'y a nulle part où la saisir) et
 * pour le public (aucune grille ne l'affichant, l'usager ne pourrait plus le
 * défaire). Sans cette garde, un choix fait sur une grille filtrerait en
 * silence une grille qui n'offre pas de quoi revenir en arrière.
 *
 * L'en-tête (pastille, nom de collectivité, nav, pilule « Mon compte ») est
 * décoratif à ce stade : aucune de ces pages n'existe encore, mieux vaut du
 * texte que des liens morts.
 */
import { useState } from "react";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import { brandingStyle } from "./theme.ts";
import {
  audiencesOffered,
  endsWithFooter,
  filterDemarchesByAudience,
  filterDemarchesByOrganization,
  filterDemarchesByQuery,
  organizationsOffering,
} from "./composition.ts";
import { PageHeader } from "./PageHeader.tsx";
import { CompteSection } from "./sections/CompteSection.tsx";
import { DemarchesSection } from "./sections/DemarchesSection.tsx";
import { FooterSection } from "./sections/FooterSection.tsx";
import { RechercheSection } from "./sections/RechercheSection.tsx";
import { TexteImageSection } from "./sections/TexteImageSection.tsx";
import { TexteSection } from "./sections/TexteSection.tsx";

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
  const [audience, setAudience] = useState<Audience | null>(null);

  const hasRecherche = page.sections.some((section) => section.kind === "recherche");
  const searchActive = hasRecherche && query.trim() !== "";
  const organizations = organizationsOffering(demarches, tenant.id);
  // Les choix se lisent sur le catalogue COMPLET : filtrer la liste des choix
  // par les choix déjà faits ferait disparaître celui qu'on vient de faire.
  const audiences = audiencesOffered(demarches);
  const hasAudienceFilter = page.sections.some(
    (section) => section.kind === "demarches" && section.audienceFilter,
  );
  const appliedAudience = hasAudienceFilter ? audience : null;
  const visibleDemarches = filterDemarchesByAudience(
    filterDemarchesByOrganization(
      hasRecherche ? filterDemarchesByQuery(demarches, query) : demarches,
      organizationId,
    ),
    appliedAudience,
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
      <PageHeader
        tenantName={tenant.name}
        logoUrl={branding?.logoUrl ?? null}
        languages={tenant.languages}
      />
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
                        audiences={audiences}
                        audience={appliedAudience}
                        onAudienceChange={setAudience}
                        searchActive={searchActive}
                      />
                    );
                  case "compte":
                    return <CompteSection section={section} />;
                  case "texte":
                    return <TexteSection section={section} />;
                  case "texte-image":
                    return <TexteImageSection section={section} />;
                }
              })()}
            </div>
          );
        })}
      </div>
    </main>
  );
}
