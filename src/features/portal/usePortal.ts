/**
 * État de chargement du portail, pour les composants.
 *
 * Le hook n'appelle que `getCurrentTenant()` et `getPublicDemarches()` : il ne
 * connaît ni `fetch`, ni URL, ni Socle. Les deux appels partagent un même
 * chargement mémoïsé — deux questions, un seul aller-retour.
 */
import { useEffect, useState } from "react";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";
import {
  getBranding,
  getCurrentTenant,
  getHomePage,
  getPublicDemarches,
  getServedLanguage,
  PortalUnavailableError,
  resetPortalCache,
} from "@/services/portal/portalService.ts";

export type PortalState =
  | { status: "loading" }
  | {
    status: "ready";
    /** La langue réellement servie — pas forcément celle demandée. */
    lang: string;
    tenant: Tenant;
    demarches: Demarche[];
    page: HomePage | null;
    branding: Branding | null;
  }
  | { status: "error"; reason: PortalLoadFailure };

export function usePortal(lang: string): { state: PortalState; retry: () => void } {
  const [state, setState] = useState<PortalState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Un chargement obsolète ne doit pas écraser l'état d'un plus récent — le
    // cas se produit dès qu'on réessaie pendant que le premier appel court.
    let current = true;
    setState({ status: "loading" });

    Promise.all([
      getCurrentTenant(lang),
      getPublicDemarches(lang),
      getHomePage(lang),
      getBranding(lang),
      getServedLanguage(lang),
    ])
      .then(([tenant, demarches, page, branding, served]) => {
        if (current) setState({ status: "ready", lang: served, tenant, demarches, page, branding });
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState({
          status: "error",
          reason: error instanceof PortalUnavailableError ? error.reason : "network",
        });
      });

    return () => {
      current = false;
    };
  }, [attempt, lang]);

  return {
    state,
    retry: () => {
      // Réessayer doit vraiment réessayer : sans cela, on relirait le cache.
      resetPortalCache();
      setAttempt((n) => n + 1);
    },
  };
}
