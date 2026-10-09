/**
 * État de chargement de la page « Envoyer un courrier libre ».
 *
 * Calqué sur `useAccessibilite` : l'appel direct au client, sans service
 * mémoïsé — une page qu'on ouvre pour écrire une fois n'a pas de cache à
 * partager, celui du navigateur (que `portal-api` autorise) suffit. L'icône de
 * l'onglet suit l'organisme auquel on écrit, comme sur sa page.
 */
import { useEffect, useState } from "react";
import { type CourrierSnapshot, fetchCourrier, type PortalLoadFailure } from "@/services/portal/portalClient.ts";
import { applyFavicon } from "@/features/portal/favicon.ts";

export type CourrierState =
  | { status: "loading" }
  // `requested` : la langue de CE chargement — voir `usePortal`, même raison.
  | { status: "ready"; requested: string; snapshot: CourrierSnapshot }
  | { status: "error"; reason: PortalLoadFailure };

export function useCourrier(
  lang: string,
  organisme: string | null,
): { state: CourrierState; retry: () => void } {
  const [state, setState] = useState<CourrierState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });

    fetchCourrier(organisme, lang)
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
  }, [lang, organisme, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
