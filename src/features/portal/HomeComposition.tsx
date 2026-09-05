/**
 * La page d'accueil composée par la collectivité, rendue pour de vrai.
 *
 * Ce composant possède l'état de recherche : le champ de la section
 * `recherche` (s'il y en a une) filtre les démarches affichées par toutes
 * les sections `demarches` de la page. Sans section `recherche`, aucun filtre
 * ne s'applique — il n'y a nulle part où le saisir.
 *
 * L'en-tête (pastille, nom de collectivité, nav, pilule « Mon compte ») est
 * décoratif à ce stade : aucune de ces pages n'existe encore, mieux vaut du
 * texte que des liens morts.
 */
import { useState } from "react";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import { filterDemarchesByQuery } from "./composition.ts";
import { CompteSection } from "./sections/CompteSection.tsx";
import { DemarchesSection } from "./sections/DemarchesSection.tsx";
import { RechercheSection } from "./sections/RechercheSection.tsx";
import { TexteSection } from "./sections/TexteSection.tsx";

function PageHeader({ tenantName }: { tenantName: string }) {
  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-5xl items-center gap-3.5 px-6 py-4">
        <div
          className="h-[26px] w-[26px] shrink-0 rounded-md bg-[hsl(153_90%_32%)]"
          aria-hidden="true"
        />
        <span className="text-sm font-extrabold tracking-tight text-slate-900">{tenantName}</span>
        <div className="flex-1" />
        {/* Décoratif : ces pages n'existent pas encore, ce ne sont pas des liens. */}
        <div className="hidden items-center gap-4 sm:flex" aria-hidden="true">
          <span className="text-sm text-slate-500">Démarches</span>
          <span className="text-sm text-slate-500">Contact</span>
        </div>
        <span className="rounded-full border border-[hsl(153_90%_32%)] px-3 py-1.5 text-sm font-semibold text-[hsl(153_90%_32%)]">
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
}: {
  tenant: Tenant;
  demarches: Demarche[];
  page: HomePage;
}) {
  const [query, setQuery] = useState("");

  const hasRecherche = page.sections.some((section) => section.kind === "recherche");
  const searchActive = hasRecherche && query.trim() !== "";
  const visibleDemarches = hasRecherche ? filterDemarchesByQuery(demarches, query) : demarches;

  return (
    <main className="min-h-screen bg-white text-slate-800">
      <PageHeader tenantName={tenant.name} />
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        {page.sections.map((section) => {
          switch (section.kind) {
            case "recherche":
              return (
                <RechercheSection
                  key={section.id}
                  section={section}
                  demarches={demarches}
                  query={query}
                  onQueryChange={setQuery}
                />
              );
            case "demarches":
              return (
                <DemarchesSection
                  key={section.id}
                  section={section}
                  demarches={visibleDemarches}
                  searchActive={searchActive}
                />
              );
            case "compte":
              return <CompteSection key={section.id} section={section} />;
            case "texte":
              return <TexteSection key={section.id} section={section} />;
          }
        })}
      </div>
    </main>
  );
}
