/**
 * État de chargement d'une démarche, pour les composants.
 *
 * Contrairement à `usePortal`, ce hook ne passe pas par le service mémoïsé :
 * un instantané est propre à UNE démarche, et deux démarches consultées à la
 * suite ne partagent rien. Le cache utile est ici celui du navigateur, que
 * `portal-api` autorise par son en-tête.
 */
import { useEffect, useState } from "react";
import {
  fetchDemarche,
  type DemarcheSnapshot,
  type PortalLoadFailure,
} from "@/services/portal/portalClient.ts";
import { rememberBranding } from "@/features/portal/theme.ts";
import { applyFavicon } from "@/features/portal/favicon.ts";

export type DemarcheState =
  | { status: "loading" }
  // `requested` : la langue de CE chargement — voir `usePortal`, même raison.
  | { status: "ready"; requested: string; snapshot: DemarcheSnapshot }
  | { status: "error"; reason: PortalLoadFailure };

export function useDemarche(
  demarcheId: string,
  lang: string,
  /** L'organisme sous lequel la démarche est consultée, `null` sinon. */
  organisme: string | null = null,
): { state: DemarcheState; retry: () => void } {
  const [state, setState] = useState<DemarcheState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Un chargement obsolète ne doit pas écraser l'état d'un plus récent — le
    // cas se produit dès qu'on change de démarche pendant que la première
    // requête court.
    let current = true;
    setState({ status: "loading" });

    fetchDemarche(demarcheId, lang, organisme)
      .then((result) => {
        // La charte arrive avec la démarche : on la retient pour l'attente de
        // la prochaine visite (voir `theme.ts`), qu'elle soit encore utile ici
        // ou non.
        //
        // ⚠️ SAUF SOUS UN ORGANISME : la charte reçue est alors la SIENNE, et
        // la retenir peindrait l'attente de la prochaine visite — y compris
        // celle de l'accueil de la collectivité — aux couleurs d'une mairie.
        // L'icône de l'onglet, elle, suit la page qu'on regarde.
        if (result.ok) {
          if (organisme === null) rememberBranding(result.snapshot.branding);
          applyFavicon(result.snapshot.branding);
        }
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
  }, [demarcheId, lang, organisme, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
