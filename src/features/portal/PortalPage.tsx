/**
 * Le portail, en une page.
 *
 * Délibérément minimal : cette étape valide le mécanisme
 * `domaine → collectivité → démarches`, pas l'interface finale. La charte
 * graphique par collectivité (le Socle la sert déjà, héritage résolu, sur
 * `/v1/organizations/{id}/branding`) viendra ensuite.
 *
 * Ce composant ne connaît ni le Socle, ni `portal-api`, ni le domaine visité :
 * il lit un état et l'affiche.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import { errorMessageFor } from "./errorMessages.ts";
import { usePortal } from "./usePortal.ts";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 text-slate-800">{children}</main>
  );
}

function DemarcheCard({ demarche }: { demarche: Demarche }) {
  return (
    <li className="rounded-lg border border-slate-200 p-4">
      <h3 className="font-medium text-slate-900">{demarche.name}</h3>
      {demarche.description !== null && (
        <p className="mt-1 text-sm text-slate-600">{demarche.description}</p>
      )}
      {demarche.estimatedMinutes !== null && (
        <p className="mt-2 text-xs text-slate-500">
          Environ {demarche.estimatedMinutes} minutes
        </p>
      )}
    </li>
  );
}

export function PortalPage() {
  const { state, retry } = usePortal();

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

  return (
    <Shell>
      <header className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-semibold text-slate-900">{state.tenant.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Démarches en ligne</p>
      </header>

      {state.demarches.length === 0 ? (
        // Cas normal, pas une erreur : la collectivité existe, elle n'a
        // simplement rien publié. Le dire clairement évite un ticket de support.
        <p className="mt-8 text-slate-600">
          Aucune démarche n'est proposée en ligne pour le moment.
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {state.demarches.map((demarche) => (
            <DemarcheCard key={demarche.id} demarche={demarche} />
          ))}
        </ul>
      )}
    </Shell>
  );
}
