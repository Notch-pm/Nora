/**
 * État de chargement de la déclaration d'accessibilité, pour les composants.
 *
 * Calqué sur `useDemarche` : l'appel direct au client, sans service mémoïsé —
 * une page qu'on consulte rarement n'a pas de cache à partager, celui du
 * navigateur (que `portal-api` autorise) suffit.
 *
 * Pas de `rememberBranding` : la charte reçue est celle de la collectivité,
 * déjà retenue par l'accueil. L'icône de l'onglet, elle, suit la page ouverte.
 */
import { useEffect, useState } from "react";
import {
  type AccessibiliteSnapshot,
  fetchAccessibilite,
  type PortalLoadFailure,
} from "@/services/portal/portalClient.ts";
import { applyFavicon } from "@/features/portal/favicon.ts";

export type AccessibiliteState =
  | { status: "loading" }
  // `requested` : la langue de CE chargement — voir `usePortal`, même raison.
  | { status: "ready"; requested: string; snapshot: AccessibiliteSnapshot }
  | { status: "error"; reason: PortalLoadFailure };

export function useAccessibilite(lang: string): { state: AccessibiliteState; retry: () => void } {
  const [state, setState] = useState<AccessibiliteState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });

    fetchAccessibilite(lang)
      .then((result) => {
        if (result.ok) applyFavicon(result.snapshot.branding);
        if (!current) return;
        setState(
          result.ok
            ? { status: "ready", requested: lang, snapshot: result.snapshot }
            : { status: "error", reason: result.reason },
        );
      })
      .catch(() => {
        if (current) setState({ status: "error", reason: "network" });
      });

    return () => {
      current = false;
    };
  }, [lang, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
