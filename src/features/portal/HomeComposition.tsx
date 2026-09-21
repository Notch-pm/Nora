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
import type { FooterSection as FooterSectionData, HomePage } from "@fn/_shared/domain/page.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import { AssistantConversation } from "@/features/assistant/AssistantConversation.tsx";
import { AssistantEntryLink } from "@/features/assistant/AssistantEntryLink.tsx";
import { headerLogoUrl, themeStyle } from "./themeStyle.ts";
import { AccessibilityNotice, hasAccessibilityDeclaration } from "./AccessibilityNotice.tsx";
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
import { SkipLink } from "./SkipLink.tsx";
import { CompteSection } from "./sections/CompteSection.tsx";
import { DemarchesSection } from "./sections/DemarchesSection.tsx";
import { FooterSection } from "./sections/FooterSection.tsx";
import { RechercheSection } from "./sections/RechercheSection.tsx";
import { TexteImageSection } from "./sections/TexteImageSection.tsx";
import { TexteSection } from "./sections/TexteSection.tsx";
import { LINK_CLASS } from "@/features/assistant/cardStyles.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { homeTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";

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
  const { lang } = useLanguage();
  const t = useT();
  // RGAA 8.6 : le titre d'onglet identifie la page (ici, la collectivité)
  // puis le site — jamais figé sur « Démarches en ligne », et traduit.
  useDocumentTitle(homeTitle(lang, tenant.name));

  const [query, setQuery] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [audience, setAudience] = useState<Audience | null>(null);

  /**
   * La phrase qui a ouvert la conversation — `null` tant qu'on est sur le
   * catalogue. C'est TOUT l'état de la bascule.
   *
   * ⚠️ **AUCUN CHANGEMENT D'ADRESSE**, et c'est délibéré : la conversation est
   * la continuité de la recherche, pas une nouvelle destination. Rien n'est
   * poussé dans l'historique du navigateur avant que l'usager n'ouvre une
   * démarche — le bouton « page précédente » ne doit jamais casser une
   * conversation en cours. Et le catalogue n'est pas détruit : `query`,
   * `organizationId` et `audience` survivent, donc revenir le retrouve intact.
   */
  const [assistantSeed, setAssistantSeed] = useState<string | null>(null);
  // ⚠️ `undefined` quand l'assistant est fermé : `RechercheSection` n'affiche
  // alors RIEN de neuf, et le champ se comporte exactement comme avant. C'est
  // ce qui rend ce lot inoffensif pour une collectivité qui n'en veut pas.
  const startAssistant = tenant.assistant.enabled ? setAssistantSeed : undefined;

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
  // au bord. Seule la mention d'accessibilité se pose sous lui — elle
  // n'appartient pas à la composition, elle est due sur toutes les pages.
  const footerLast = endsWithFooter(page.sections);
  // ⚠️ Le pied composé EN DERNIÈRE POSITION migre hors de `main`, dans le pied
  // de premier niveau (RGAA 9.2 / 12.6) : c'est lui qui doit être le
  // `contentinfo` de la page. Un pied composé qui n'est PAS en dernière
  // position reste dans `main`, comme avant cette correction — voir la boucle
  // ci-dessous.
  const lastSection = page.sections[page.sections.length - 1];
  const topFooterSection: FooterSectionData | null =
    footerLast && lastSection !== undefined && lastSection.kind === "footer" ? lastSection : null;
  // Pas de repère `contentinfo` vide : ni pied composé, ni déclaration
  // d'accessibilité écrite → pas de `<footer>` du tout.
  const showTopFooter = topFooterSection !== null || hasAccessibilityDeclaration(tenant.theme);

  return (
    // ⚠️ LE STYLE DU THÈME VIT SUR CETTE RACINE, PAS SUR `<main>` : header et
    // footer en dépendent aussi (leurs `--pt-*`).
    <div
      className="flex min-h-screen flex-col bg-white"
      // ⚠️ TOUT LE THÈME TIENT DANS CET OBJET. Les sections ne le reçoivent pas
      // en props : elles lisent des variables CSS. C'est ce qui rend le thème
      // gratuit — quelques centaines d'octets de style, pas une requête.
      style={{ ...themeStyle(tenant.theme, branding), color: "var(--pt-ink)" }}
    >
      <SkipLink />
      <PageHeader
        tenantName={tenant.name}
        logoUrl={headerLogoUrl(tenant.theme, branding)}
        theme={tenant.theme}
        languages={tenant.languages}
        villes={villes}
        // DÉCISION PRODUIT DE LAURENT (RGAA 9.1) : sur l'accueil composé
        // SEULEMENT, le nom de la collectivité EST le `h1` de la page — jamais
        // un bloc personnalisable de la composition, qui pourrait manquer ou
        // changer de sens d'une collectivité à l'autre. Rendu identique,
        // seule la balise change.
        nameAsHeading
      />
      {/* ⚠️ LE DERNIER RECOURS, ET RIEN D'AUTRE. L'assistant naît normalement du
          champ de recherche (`RechercheSection` → `AssistantSearchPrompt`), au
          moment de l'hésitation : c'est la porte unique, et ce lien isolé en
          haut de page est exactement ce que cette intégration supprime. Mais
          une collectivité peut n'avoir composé AUCUNE section « recherche » —
          il n'existe alors aucun champ d'où naître, et sans ce repli
          l'assistant serait simplement injoignable. */}
      {tenant.assistant.enabled && !hasRecherche && assistantSeed === null && (
        <div className="mx-auto w-full max-w-5xl px-6 pt-[var(--pt-pad)]">
          <AssistantEntryLink enabled />
        </div>
      )}
      <main
        id="contenu"
        tabIndex={-1}
        className="flex flex-1 flex-col focus:outline-none"
        style={{
          gap: "var(--pt-gap)",
          // Un bandeau pleine largeur en tête de page touche l'en-tête — voir
          // `startsWithFullWidthBanner`. Même geste que le pied de page collé
          // au bas, à l'autre bout.
          paddingTop: startsWithFullWidthBanner(page.sections) ? 0 : "var(--pt-pad)",
          // Sans pied composé, la dernière section garde sa respiration. Avec
          // lui, c'est l'écart entre deux sections qui la sépare du pied.
          // ⚠️ Cet écart était le `gap` du conteneur, quand le pied vivait
          // dedans. Sorti de `main` pour devenir le `contentinfo`, il ne le
          // reçoit plus : le rendre ici, sinon la dernière section touche le
          // pied. L'espacement suit la densité du thème.
          paddingBottom: footerLast ? "var(--pt-gap)" : "var(--pt-pad)",
        }}
      >
        {/* ⚠️ LA CONVERSATION PREND LA PLACE DU CATALOGUE, sur la même surface
            et à la même adresse. Les sections ne sont pas démontées « pour de
            bon » : l'état des filtres vit ici, au-dessus, donc revenir les
            retrouve tels quels. */}
        {assistantSeed !== null ? (
          <div className="mx-auto w-full max-w-5xl px-6">
            <nav className="mb-6">
              <button type="button" onClick={() => setAssistantSeed(null)} className={LINK_CLASS}>
                {t("assistant.allDemarches")}
              </button>
            </nav>
            <AssistantConversation
              demarches={demarches}
              lang={lang}
              focusDemarcheId={null}
              depositEnabled={tenant.assistant.depositEnabled}
              initialMessage={assistantSeed}
            />
          </div>
        ) : (
          page.sections.map((section, index) => {
          if (section.kind === "footer") {
            // Extrait vers le pied de premier niveau, sous `main` : rendu
            // là-bas, pas ici.
            if (footerLast && index === page.sections.length - 1) return null;
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
                onStartAssistant={startAssistant}
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
                        onStartAssistant={startAssistant}
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
          })
        )}
      </main>
      {/* Le pied de page de premier niveau (`contentinfo`) : le pied composé
          quand il termine la page, puis la mention d'accessibilité — due sur
          toutes les pages, pas un bloc de la composition.
          ⚠️ Pas de `mt-auto` ici : `main` porte déjà `flex-1` et absorbe tout
          l'espace restant, ce qui pousse ce pied au bord exactement comme
          avant cette correction — lui en ajouter referait le même geste deux
          fois. */}
      {showTopFooter && (
        <footer>
          {topFooterSection !== null && <FooterSection section={topFooterSection} />}
          <AccessibilityNotice theme={tenant.theme} />
        </footer>
      )}
    </div>
  );
}
