/**
 * Une démarche telle que le PORTAIL la manipule.
 *
 * Le vocabulaire est celui du portail, pas celui du Socle : le référentiel
 * distingue `short_description` (résumé) et `user_description` (descriptif
 * usager), tous deux facultatifs. Une page publique n'a besoin que d'« un texte
 * à afficher » — la règle de choix est appliquée une fois, à la traduction, et
 * l'interface n'a pas à connaître l'existence des deux champs.
 *
 * C'est ce que veut dire « le portail ne dépend pas de la structure du Socle » :
 * pas seulement qu'il ne lit pas ses tables, mais qu'il ne parle pas sa langue.
 */

/** Un organisme de la collectivité qui propose une démarche : de quoi le nommer. */
export interface DemarcheOrganization {
  id: string;
  name: string;
}

export interface Demarche {
  id: string;
  /** Intitulé de la démarche. */
  name: string;
  /** Texte public à afficher, `null` si la collectivité n'en a rempli aucun. */
  description: string | null;
  /** Durée de saisie estimée, en minutes. */
  estimatedMinutes: number | null;
  /**
   * Les organismes de la collectivité qui proposent la démarche — elle-même
   * ou ses communes et services — dans l'ordre de l'arbre. Le Socle décide
   * qui propose quoi (activation par organisation) et ne sert jamais une
   * démarche que personne ne propose ; la carte les nomme, le filtre s'y
   * adosse.
   */
  organizations: DemarcheOrganization[];
}
