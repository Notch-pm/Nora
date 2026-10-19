/**
 * L'état du suivi d'une demande, pour les composants.
 *
 * Trois écrans possibles, et un seul à la fois : le formulaire d'accès, la vue
 * de la demande, ou une panne. Au montage on demande la demande à la session
 * en cours — c'est ce qui fait qu'un rechargement de page ne redemande pas le
 * code : le cookie tient la session, pas l'interface.
 *
 * Aucune règle métier ici : ce que vaut un refus, une session expirée ou un
 * statut est dit par le serveur ; ce hook ne fait que sérialiser les appels.
 */
import { useCallback, useEffect, useState } from "react";
import type { SuiviAccess, SuiviDemande } from "@fn/_shared/domain/suivi.ts";
import {
  endSuivi,
  fetchSuiviDemande,
  openSuivi,
  type SuiviClientFailure,
} from "@/services/portal/suiviClient.ts";

export type SuiviState =
  | { status: "loading" }
  /** `expired` : l'accès qu'on tenait n'existe plus — l'écran le dit. */
  | { status: "form"; expired: boolean }
  | { status: "ready"; demande: SuiviDemande }
  | { status: "error"; reason: SuiviClientFailure };

export function useSuivi(): {
  state: SuiviState;
  /** Ouvre l'accès puis charge la demande ; rend l'échec à afficher, ou `null`. */
  submit: (access: SuiviAccess) => Promise<SuiviClientFailure | null>;
  quit: () => Promise<void>;
  retry: () => void;
} {
  const [state, setState] = useState<SuiviState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    fetchSuiviDemande().then((result) => {
      if (!current) return;
      if (result.ok) setState({ status: "ready", demande: result.demande });
      // Pas (ou plus) de session invitée : le formulaire, sans reproche.
      else if (result.reason === "session_required") setState({ status: "form", expired: false });
      // 404 : l'accès a existé et n'existe plus (expiré, verrouillé).
      else if (result.reason === "suivi_refused") setState({ status: "form", expired: true });
      else setState({ status: "error", reason: result.reason });
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  const submit = useCallback(async (access: SuiviAccess): Promise<SuiviClientFailure | null> => {
    const opened = await openSuivi(access);
    if (!opened.ok) return opened.reason;
    const loaded = await fetchSuiviDemande();
    if (!loaded.ok) {
      // Un accès ouvert dont la lecture dit « pas de session » : le cookie n'a
      // pas été gardé. Pour l'usager, c'est une indisponibilité, pas un refus.
      return loaded.reason === "session_required" ? "suivi_unavailable" : loaded.reason;
    }
    setState({ status: "ready", demande: loaded.demande });
    return null;
  }, []);

  const quit = useCallback(async () => {
    // Quelle que soit la réponse, l'écran revient au formulaire VIDE : rien de
    // la demande ne doit rester affiché une fois que l'usager a dit partir.
    await endSuivi();
    setState({ status: "form", expired: false });
  }, []);

  return { state, submit, quit, retry: () => setAttempt((n) => n + 1) };
}
