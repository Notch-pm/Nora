/**
 * Ce que l'usager lit quand le suivi échoue — une table, pas des phrases en dur.
 *
 * ⚠️ UN SEUL MESSAGE POUR TOUT REFUS (`suivi_refused`) : « référence inconnue »,
 * « code erroné » et « accès verrouillé » ne sont jamais distingués, sans quoi
 * la page servirait à deviner quelles demandes existent. Le serveur applique la
 * même règle ; l'interface ne la défait pas.
 */
import type { StringKey } from "@/i18n/strings.ts";
import type { SuiviClientFailure } from "@/services/portal/suiviClient.ts";

const KEYS: Record<SuiviClientFailure, StringKey> = {
  suivi_refused: "suivi.error.refused",
  suivi_too_many_attempts: "suivi.error.tooMany",
  suivi_unavailable: "suivi.error.unavailable",
  not_configured: "suivi.error.notConfigured",
  bad_request: "suivi.error.badRequest",
  suivi_closed: "suivi.error.closed",
  // Un accès qui n'existe plus : l'usager n'a rien fait de faux, il resaisit.
  session_required: "suivi.error.expired",
  // Un refus de forme qui n'est pas la faute de l'usager : indisponibilité.
  csrf_rejected: "suivi.error.unavailable",
  session_unavailable: "suivi.error.unavailable",
  network: "suivi.error.network",
};

export function suiviFailureKey(failure: SuiviClientFailure): StringKey {
  return KEYS[failure];
}

/** Réessayer a une chance d'aboutir (comportement, pas texte — voir `errorMessages.ts`). */
export function suiviFailureRetryable(failure: SuiviClientFailure): boolean {
  return failure === "suivi_unavailable" || failure === "session_unavailable" || failure === "network" ||
    failure === "csrf_rejected";
}
