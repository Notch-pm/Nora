/**
 * Ce que l'écran dit d'un envoi de courrier refusé — le CODE vient du serveur,
 * la phrase d'ici. Logique pure, testée : c'est souvent la seule chose que
 * l'usager lira, et ce qu'on relira le jour d'un incident.
 *
 * ⚠️ Jamais le message brut du serveur, encore moins celui de Clara : il parle
 * à un exploitant. Un code inconnu retombe sur « réessayez ».
 */
import type { StringKey } from "@/i18n/strings.ts";
import type { CourrierSendFailure } from "@/services/portal/portalClient.ts";

export const COURRIER_SEND_ERROR_KEYS: Record<CourrierSendFailure, StringKey> = {
  // L'écran valide déjà : ces deux-là ne devraient pas arriver, sauf écart.
  invalid_courrier: "courrierLibre.error.invalid",
  file_too_large: "courrierLibre.error.invalid",
  file_unsupported: "courrierLibre.error.invalid",
  // La preuve de travail manquait ou a expiré : renvoyer suffit.
  challenge_required: "courrierLibre.error.unavailable",
  courrier_unavailable: "courrierLibre.error.closed",
  too_many_courriers: "courrierLibre.error.tooMany",
  courrier_undeliverable: "courrierLibre.error.undeliverable",
  courrier_rejected: "courrierLibre.error.rejected",
  courrier_not_configured: "courrierLibre.error.unavailable",
  clara_unavailable: "courrierLibre.error.unavailable",
  clara_misconfigured: "courrierLibre.error.unavailable",
  socle_unavailable: "courrierLibre.error.unavailable",
  not_configured: "courrierLibre.error.unavailable",
  network: "courrierLibre.error.unavailable",
};

export function courrierSendErrorKey(failure: CourrierSendFailure): StringKey {
  return COURRIER_SEND_ERROR_KEYS[failure] ?? "courrierLibre.error.unavailable";
}
