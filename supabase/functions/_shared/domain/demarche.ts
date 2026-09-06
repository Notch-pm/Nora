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

import type { FormSchema } from "./formSchema.ts";
import type { RequesterConfig } from "./requesterConfig.ts";

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

/** Catégorie d'une démarche : de quoi la situer, rien de plus. */
export interface DemarcheCategory {
  id: string;
  name: string;
}

/**
 * La démarche telle qu'on l'AFFICHE et qu'on la REMPLIT — ce que sert
 * `/v1/portal/procedures/{id}` du Socle, déjà traduit et déjà parsé.
 *
 * Les deux schémas arrivent ici sous leur forme du portail : `form` est un
 * `FormSchema` lu avec tolérance (les nœuds illisibles sont tombés en chemin),
 * `requester` un paramétrage complet aux valeurs par défaut du Socle. Les
 * écrans n'ont donc jamais à douter de la forme de ce qu'ils reçoivent.
 */
export interface DemarcheDetail extends Demarche {
  category: DemarcheCategory | null;
  /**
   * Le descriptif rédigé POUR l'usager, en entier. Distinct de `description`,
   * qui est le résumé de la carte (et qui retombe déjà sur celui-ci quand la
   * collectivité n'a pas écrit de résumé). Sur la page d'une démarche, les
   * deux se lisent l'un après l'autre — d'où deux champs et non un.
   */
  userDescription: string | null;
  /** `null` = démarche sans formulaire : elle s'affiche, sans saisie. */
  form: FormSchema | null;
  requester: RequesterConfig;
}
