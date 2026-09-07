/**
 * Le cadre commun aux deux pages d'une démarche : la charte de la
 * collectivité, son en-tête, et un conteneur centré.
 *
 * Les deux pages — la présentation et le formulaire — portent la même chrome
 * que l'accueil : un usager qui commence une démarche ne doit pas avoir
 * l'impression de quitter le site de sa collectivité.
 */
import type { ReactNode } from "react";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { PageHeader } from "@/features/portal/PageHeader.tsx";
import { brandingStyle } from "@/features/portal/theme.ts";

export function DemarcheShell({
  tenantName,
  branding,
  languages,
  children,
}: {
  tenantName: string | null;
  /** Les langues de la collectivité, pour le sélecteur de l'en-tête. */
  languages?: readonly string[];
  branding: Branding | null;
  children: ReactNode;
}) {
  return (
    <main
      className="flex min-h-screen flex-col bg-white pb-12 text-slate-800"
      style={brandingStyle(branding)}
    >
      {/* Tant que la collectivité n'est pas connue, l'en-tête reste neutre :
          mieux vaut une barre vide qu'un nom qui change sous les yeux. */}
      <PageHeader
        tenantName={tenantName ?? ""}
        logoUrl={branding?.logoUrl ?? null}
        languages={languages}
      />
      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pt-8">{children}</div>
    </main>
  );
}

/** L'attente. Le cadre est déjà là : seule la zone de contenu est vide. */
export function DemarcheLoading() {
  return (
    <DemarcheShell tenantName={null} branding={null}>
      <p className="text-slate-500">Chargement…</p>
    </DemarcheShell>
  );
}

/**
 * L'échec, dit à un usager. Le code d'erreur reste affiché : c'est ce qu'il
 * peut citer au support, et ce qu'on cherche dans les journaux.
 */
export function DemarcheError({
  reason,
  onRetry,
  children,
}: {
  reason: PortalLoadFailure;
  onRetry: () => void;
  /** Le retour à l'accueil, que seule la page appelante sait construire. */
  children?: ReactNode;
}) {
  const message = errorMessageFor(reason);
  return (
    <DemarcheShell tenantName={null} branding={null}>
      <h1 className="text-xl font-semibold text-slate-900">{message.title}</h1>
      <p className="mt-3 text-slate-600">{message.detail}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {message.retryable && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
          >
            Réessayer
          </button>
        )}
        {children}
      </div>
      <p className="mt-8 text-xs text-slate-400">Code : {reason}</p>
    </DemarcheShell>
  );
}
