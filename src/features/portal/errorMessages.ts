/**
 * Ce qu'un VISITEUR lit quand le portail ne peut pas afficher de démarches.
 *
 * Logique pure, séparée des composants pour être testée : le message d'erreur
 * est souvent la seule chose que verra un usager, et c'est aussi ce qu'on
 * relira le jour d'un incident.
 *
 * Deux principes :
 *   - on ne parle jamais du Socle, ni de clé, ni de tenant. Le visiteur ne sait
 *     pas ce que c'est, et l'apprendre ne l'aiderait pas ;
 *   - on dit s'il y a lieu de réessayer. « Cette adresse n'existe pas » et « le
 *     service est en panne » appellent deux gestes opposés.
 */
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";

export interface ErrorMessage {
  title: string;
  detail: string;
  /** Un rechargement a une chance d'aboutir : l'interface propose de réessayer. */
  retryable: boolean;
}

const MESSAGES: Record<PortalLoadFailure, ErrorMessage> = {
  unknown_domain: {
    title: "Cette adresse ne correspond à aucune collectivité",
    detail:
      "Le domaine utilisé n'est rattaché à aucune collectivité. Vérifiez l'adresse saisie, ou " +
      "rapprochez-vous de votre mairie pour obtenir le lien de son portail.",
    // Réessayer ne changera rien : le domaine n'existe pas, ce n'est pas une panne.
    retryable: false,
  },
  invalid_hostname: {
    title: "Cette adresse ne correspond à aucune collectivité",
    detail:
      "L'adresse utilisée ne permet pas d'identifier une collectivité. Utilisez le lien fourni " +
      "par votre mairie.",
    retryable: false,
  },
  tenant_unavailable: {
    title: "Collectivité momentanément indisponible",
    detail:
      "Cette collectivité existe, mais ses démarches ne peuvent pas être affichées pour " +
      "l'instant. Merci de réessayer dans quelques minutes.",
    retryable: true,
  },
  socle_unavailable: {
    title: "Service momentanément indisponible",
    detail:
      "Les démarches ne peuvent pas être affichées pour l'instant. Merci de réessayer dans " +
      "quelques minutes.",
    retryable: true,
  },
  // Une clé refusée est une panne d'exploitation. Du point de vue du visiteur,
  // c'est la même chose qu'un service coupé : même message, et surtout pas
  // « accès refusé », qui lui ferait croire qu'il n'a pas le droit d'être là.
  socle_misconfigured: {
    title: "Service momentanément indisponible",
    detail:
      "Les démarches ne peuvent pas être affichées pour l'instant. Merci de réessayer dans " +
      "quelques minutes.",
    retryable: true,
  },
  network: {
    title: "Connexion impossible",
    detail:
      "Le portail n'a pas pu être joint. Vérifiez votre connexion internet, puis réessayez.",
    retryable: true,
  },
  // Le seul message qui s'adresse à un exploitant plutôt qu'à un usager : en
  // production il ne devrait jamais s'afficher, et s'il s'affiche, il faut
  // qu'il dise quoi faire.
  demarche_unavailable: {
    title: "Cette démarche n'est plus proposée",
    detail:
      "Elle a peut-être été retirée du portail, ou sa période de publication est terminée. " +
      "Retournez à l'accueil pour voir les démarches disponibles.",
    // Ce n'est pas une panne : réessayer donnerait le même résultat.
    retryable: false,
  },
  submission_rejected: {
    title: "Votre demande n'a pas pu être enregistrée",
    detail:
      "Le service qui reçoit les demandes l'a refusée. Merci de contacter votre collectivité, " +
      "qui pourra la prendre par un autre moyen.",
    // Renvoyer à l'identique serait refusé de la même façon.
    retryable: false,
  },
  iris_unavailable: {
    title: "Votre demande n'a pas pu être envoyée",
    detail:
      "Le service qui reçoit les demandes n'a pas répondu. Vos réponses sont toujours à " +
      "l'écran : réessayez dans quelques instants. Si elle est déjà partie, ce second envoi " +
      "ne créera pas de doublon.",
    retryable: true,
  },
  iris_misconfigured: {
    title: "Votre demande n'a pas pu être envoyée",
    detail:
      "Le service qui reçoit les demandes n'a pas répondu. Vos réponses sont toujours à " +
      "l'écran : réessayez dans quelques instants.",
    retryable: true,
  },
  not_configured: {
    title: "Portail non configuré",
    detail:
      "L'adresse de l'API du portail n'est pas renseignée. Vérifiez la configuration du " +
      "déploiement (voir .env.example).",
    retryable: false,
  },
};

export function errorMessageFor(failure: PortalLoadFailure): ErrorMessage {
  return MESSAGES[failure];
}
