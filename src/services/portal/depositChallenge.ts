/**
 * La décision qui suit `fetchDepositChallenge` — pure, testable sans réseau.
 *
 * ⚠️ Une panne de `POST /v1/defi` (portail pas encore déployé, portail sans
 * secret de signature, réseau, cadence) ne doit JAMAIS empêcher de TENTER le
 * dépôt : elle vaut seulement « pas de preuve à fournir », et `POST
 * /v1/demandes` part sans `challenge` — le serveur, tolérant tant qu'il ne
 * l'exige pas, l'accepte comme avant (`depositGate.ts`, côté fonctions). S'il
 * l'exige et qu'elle manque, il répond `428 challenge_required`, que
 * `sendDemande` mappe sur l'échec existant `iris_unavailable`.
 */
import type { AssistantChallenge } from "@fn/_shared/domain/assistantTurn.ts";
import type { DepositChallengeLoad } from "./portalClient.ts";

/** Le défi à résoudre avant un dépôt — `null` s'il n'y en a pas, jamais un échec bloquant. */
export function challengeToSolve(load: DepositChallengeLoad): AssistantChallenge | null {
  return load.ok ? load.challenge : null;
}
