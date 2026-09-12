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
import type { Demarche, Ville } from "@fn/_shared/domain/demarche.ts";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import { headerLogoUrl, themeStyle } from "./themeStyle.ts";
import { AccessibilityNotice } from "./AccessibilityNotice.tsx";
import {
  audiencesOffered,
  endsWithFooter,
  filterDemarchesByAudience,
  filterDemarchesByOrganization,
  filterDemarchesByQuery,
  organizationsOffering,
  startsWithFullWidthBanner,
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
  villes,
  demarches,
  page,
  branding,
}: {
  tenant: Tenant;
  /** Les villes de la collectivité, pour le menu « Ma ville » de l'en-tête. */
  villes: Ville[];
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
  // au bord (`mt-auto`). Seule la mention d'accessibilité se pose sous lui —
  // elle n'appartient pas à la composition, elle est due sur toutes les pages.
  const footerLast = endsWithFooter(page.sections);

  return (
    <main
      className="flex min-h-screen flex-col bg-white"
      // ⚠️ TOUT LE THÈME TIENT DANS CET OBJET. Les sections ne le reçoivent pas
      // en props : elles lisent des variables CSS. C'est ce qui rend le thème
      // gratuit — quelques centaines d'octets de style, pas une requête.
      style={{ ...themeStyle(tenant.theme, branding), color: "var(--pt-ink)" }}
    >
      <PageHeader
        tenantName={tenant.name}
        logoUrl={headerLogoUrl(tenant.theme, branding)}
        theme={tenant.theme}
        languages={tenant.languages}
        villes={villes}
      />
      <div
        className="flex flex-1 flex-col"
        style={{
          gap: "var(--pt-gap)",
          // Un bandeau pleine largeur en tête de page touche l'en-tête — voir
          // `startsWithFullWidthBanner`. Même geste que le pied de page collé
          // au bas, à l'autre bout.
          paddingTop: startsWithFullWidthBanner(page.sections) ? 0 : "var(--pt-pad)",
          // Un pied de page composé va au bord ; sans lui, la dernière section
          // garde sa respiration. L'espacement suit la densité du thème.
          paddingBottom: footerLast ? 0 : "var(--pt-pad)",
        }}
      >
        {page.sections.map((section) => {
          if (section.kind === "footer") {
            return (
              <div key={section.id} className="mt-auto">
                <FooterSection section={section} />
              </div>
            );
          }
          // ⚠️ Le conteneur centré est ce qui EMPÊCHE un fond d'atteindre les
          // bords de l'écran : un bandeau « pleine largeur » se rend donc hors
          // de lui, comme le pied de page. Le bloc remet lui-même les marges
          // pour son contenu — sans quoi le champ de recherche s'étalerait sur
          // toute la largeur.
          if (section.kind === "recherche" && section.imageFullWidth) {
            return (
              <RechercheSection
                key={section.id}
                section={section}
                demarches={demarches}
                query={query}
                onQueryChange={setQuery}
              />
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
      {/* Sous le pied de page composé, et sur toutes les pages du site :
          c'est une mention obligatoire, pas un bloc de contenu. */}
      <AccessibilityNotice theme={tenant.theme} />
    </main>
  );
}
