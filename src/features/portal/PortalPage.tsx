/**
 * Le portail, en une page.
 *
 * Ce composant ne connaît ni le Socle, ni `portal-api`, ni le domaine visité :
 * il lit un état et l'affiche. Une composition publiée est rendue telle
 * quelle (`HomeComposition`) ; sans elle, la liste de repli ci-dessous — les
 * mêmes cartes, le même filtre par organisme, sans mise en page composée.
 */
import { useEffect, useState } from "react";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import {
  emptyDemarchesMessage,
  filterDemarchesByOrganization,
  organizationsOffering,
} from "./composition.ts";
import { errorMessageFor } from "./errorMessages.ts";
import { HomeComposition } from "./HomeComposition.tsx";
import { DemarcheCard } from "./sections/DemarcheCard.tsx";
import { OrganizationFilter } from "./sections/OrganizationFilter.tsx";
import { usePortal } from "./usePortal.ts";
import { useLanguage } from "@/i18n/LanguageLayout.tsx";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-800">{children}</main>
  );
}

/**
 * La liste de repli, quand la collectivité n'a pas encore composé sa page
 * d'accueil. Elle possède son propre filtre par organisme : il n'y a pas de
 * page composée pour le porter.
 */
function DefaultCatalogue({ tenant, demarches }: { tenant: Tenant; demarches: Demarche[] }) {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const organizations = organizationsOffering(demarches, tenant.id);
  const visible = filterDemarchesByOrganization(demarches, organizationId);

  return (
    <Shell>
      <header className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{tenant.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Démarches en ligne</p>
      </header>

      <div className="mt-8 flex flex-col gap-4">
        <OrganizationFilter
          organizations={organizations}
          value={organizationId}
          onChange={setOrganizationId}
        />
        {visible.length === 0 ? (
          // Cas normal, pas une erreur : la collectivité existe, elle n'a
          // simplement rien publié. Le dire clairement évite un ticket de support.
          <p className="text-slate-600">{emptyDemarchesMessage(false, organizationId)}</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((demarche) => (
              <DemarcheCard key={demarche.id} demarche={demarche} />
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}

export function PortalPage() {
  const { lang, serve } = useLanguage();
  const { state, retry } = usePortal(lang);

  // ⚠️ LE SERVEUR A TRANCHÉ : l'adresse doit dire ce qui est affiché. Une
  // langue mémorisée mais désactivée depuis revient au français ici, et le
  // préfixe se pose quand la langue venait de la mémoire et non de l'adresse.
  const served = state.status === "ready" ? state.lang : null;
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  if (state.status === "loading") {
    return (
      <Shell>
        <p className="text-slate-500">Chargement…</p>
      </Shell>
    );
  }

  if (state.status === "error") {
    const message = errorMessageFor(state.reason);
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
            Réessayer
          </button>
        )}
        {/* Le code d'erreur n'est pas décoratif : c'est ce qu'un usager peut
            citer au support, et ce qu'on cherche dans les journaux. */}
        <p className="mt-8 text-xs text-slate-400">Code : {state.reason}</p>
      </Shell>
    );
  }

  // Une composition publiée existe : le portail la rend telle quelle. Elle
  // porte son propre en-tête, hors du `Shell` étroit du repli.
  if (state.page !== null) {
    return (
      <HomeComposition
        tenant={state.tenant}
        demarches={state.demarches}
        page={state.page}
        branding={state.branding}
      />
    );
  }

  return <DefaultCatalogue tenant={state.tenant} demarches={state.demarches} />;
}
