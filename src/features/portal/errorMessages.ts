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
 *
 * ⚠️ `retryable` est un COMPORTEMENT, pas un texte : il reste ici, dans une
 * table, quand les phrases sont parties au dictionnaire. Le mettre dans les
 * traductions en ferait une décision de traducteur.
 */
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";
import { t } from "@/i18n/t.ts";
import type { StringKey } from "@/i18n/strings.ts";

export interface ErrorMessage {
  title: string;
  detail: string;
  /** Un rechargement a une chance d'aboutir : l'interface propose de réessayer. */
  retryable: boolean;
}

/**
 * Ce qu'on propose à l'usager face à chaque panne. Les phrases vivent dans le
 * dictionnaire (`error.<code>.title` / `.detail`) ; ici, seulement la conduite
 * à tenir.
 */
const RETRYABLE: Record<PortalLoadFailure, boolean> = {
  // Réessayer ne changera rien : le domaine n'existe pas, ce n'est pas une panne.
  unknown_domain: false,
  invalid_hostname: false,
  tenant_unavailable: true,
  socle_unavailable: true,
  // Une clé refusée est une panne d'exploitation. Du point de vue du visiteur,
  // c'est la même chose qu'un service coupé — et surtout pas « accès refusé »,
  // qui lui ferait croire qu'il n'a pas le droit d'être là.
  socle_misconfigured: true,
  network: true,
  // Ce n'est pas une panne : réessayer donnerait le même résultat.
  demarche_unavailable: false,
  // Idem, et de toute façon l'interface ramène le visiteur à l'accueil plutôt
  // que de lui afficher ce message : une adresse d'organisme périmée doit
  // rendre le portail, pas une explication.
  organisme_unavailable: false,
  // Renvoyer à l'identique serait refusé de la même façon.
  submission_rejected: false,
  iris_unavailable: true,
  iris_misconfigured: true,
  not_configured: false,
};

export function errorMessageFor(failure: PortalLoadFailure, lang: string): ErrorMessage {
  return {
    title: t(lang, `error.${failure}.title` as StringKey),
    detail: t(lang, `error.${failure}.detail` as StringKey),
    retryable: RETRYABLE[failure],
  };
}
