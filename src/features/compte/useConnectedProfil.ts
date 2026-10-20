/**
 * Qui est connecté, et ce que son profil dit — pour les écrans de dépôt
 * (garde des démarches réservées, préremplissage « Dites-le nous une fois »).
 *
 * Le profil n'est lu QUE pour une session de compte, et seulement si l'écran en
 * a besoin (`enabled`) : un visiteur anonyme ne déclenche aucun appel de plus.
 * Rien n'est gardé au-delà de la vie du composant.
 *
 * ⚠️ Commodité d'affichage : le serveur reste juge (`account_required`).
 */
import { useEffect, useState } from "react";
import type { Profil } from "@fn/_shared/domain/profil.ts";
import { fetchProfil } from "@/services/portal/profilClient.ts";
import type { SessionKind } from "@/services/portal/accountClient.ts";
import type { ProfilStatus } from "@/features/demarche/accessGate.ts";
import { useSessionKind } from "./sessionKind.ts";

export interface ConnectedProfil {
  /** `null` tant que le serveur n'a pas répondu. */
  session: SessionKind | null;
  status: ProfilStatus;
  /** Le profil rempli, sinon `null`. */
  profil: Profil | null;
}

export function useConnectedProfil(enabled = true): ConnectedProfil {
  const session = useSessionKind();
  const [loaded, setLoaded] = useState<{ status: ProfilStatus; profil: Profil | null }>({
    status: "unknown",
    profil: null,
  });

  useEffect(() => {
    if (!enabled || session !== "account") return;
    let current = true;
    fetchProfil().then((result) => {
      if (!current) return;
      if (result.ok) {
        setLoaded(result.value === null ? { status: "empty", profil: null } : { status: "filled", profil: result.value });
      } else {
        // Session perdue, panne : le serveur tranchera à l'envoi.
        setLoaded({ status: "unavailable", profil: null });
      }
    });
    return () => {
      current = false;
    };
  }, [enabled, session]);

  return { session, ...loaded };
}
