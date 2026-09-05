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
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";
import {
  getCurrentTenant,
  getHomePage,
  getPublicDemarches,
  PortalUnavailableError,
  resetPortalCache,
} from "@/services/portal/portalService.ts";

export type PortalState =
  | { status: "loading" }
  | { status: "ready"; tenant: Tenant; demarches: Demarche[]; page: HomePage | null }
  | { status: "error"; reason: PortalLoadFailure };

export function usePortal(): { state: PortalState; retry: () => void } {
  const [state, setState] = useState<PortalState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Un chargement obsolète ne doit pas écraser l'état d'un plus récent — le
    // cas se produit dès qu'on réessaie pendant que le premier appel court.
    let current = true;
    setState({ status: "loading" });

    Promise.all([getCurrentTenant(), getPublicDemarches(), getHomePage()])
      .then(([tenant, demarches, page]) => {
        if (current) setState({ status: "ready", tenant, demarches, page });
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
  }, [attempt]);

  return {
    state,
    retry: () => {
      // Réessayer doit vraiment réessayer : sans cela, on relirait le cache.
      resetPortalCache();
      setAttempt((n) => n + 1);
    },
  };
}
