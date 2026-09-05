/**
 * Les seules façons dont le portail peut ne pas rendre de démarches.
 *
 * Union fermée, partagée par l'edge function et l'interface : le serveur en
 * choisit une, l'interface l'affiche. Sans ce type, chaque écran redécouvrirait
 * les cas d'erreur — et en oublierait.
 */
export type PortalFailure =
  /** Le nom d'hôte visité n'a pas pu être déterminé, ou n'est pas un domaine. */
  | "invalid_hostname"
  /** Domaine bien formé, mais rattaché à aucune collectivité dans le Socle. */
  | "unknown_domain"
  /** Le domaine résout, mais la collectivité n'a pas pu être lue au Socle. */
  | "tenant_unavailable"
  /** Le Socle est injoignable, ou a répondu quelque chose d'inattendu. */
  | "socle_unavailable"
  /** La clé du portail est refusée par le Socle — panne de configuration. */
  | "socle_misconfigured"
  /** Le portail lui-même n'a pas sa configuration (secrets absents). */
  | "not_configured";

/**
 * Statut HTTP d'un échec.
 *
 * `unknown_domain` est un **404** et non une erreur serveur : un domaine qui
 * n'appartient à personne est une adresse qui n'existe pas, pas une panne.
 * `socle_misconfigured` est un **502** comme `socle_unavailable` : de la place
 * du visiteur, une clé refusée est une dépendance en panne — le distinguer
 * dans le code d'erreur suffit à l'exploitant, l'exposer en 403 laisserait
 * croire à l'usager qu'il n'a pas le droit d'être là.
 */
export function httpStatusForFailure(failure: PortalFailure): number {
  switch (failure) {
    case "invalid_hostname":
      return 400;
    case "unknown_domain":
    case "tenant_unavailable":
      return 404;
    case "socle_unavailable":
    case "socle_misconfigured":
      return 502;
    case "not_configured":
      return 503;
  }
}
