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

/**
 * Un organisme de la collectivité qui propose une démarche : de quoi le nommer,
 * et de quoi l'atteindre.
 *
 * `slug` est l'identifiant lisible que le Socle lui a donné — celui qui ouvre
 * sa page sur le portail (`/{slug}`).
 *
 * ⚠️ `null` EST UN CAS NORMAL, pas une anomalie : un organisme sans slug n'a
 * pas d'adresse propre, et reste ce qu'il était — une entrée du filtre de
 * l'accueil, une puce sur les cartes. Un Socle d'avant le contrat 1.22.0 n'en
 * envoie aucun, et le portail continue de fonctionner sans page d'organisme.
 */
export interface DemarcheOrganization {
  id: string;
  name: string;
  slug: string | null;
}

import type { FormSchema } from "./formSchema.ts";
import type { Audience, RequesterConfig } from "./requesterConfig.ts";

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
  /**
   * Les publics auxquels la démarche est ouverte — citoyen, entreprise,
   * association — dans l'ordre du Socle. De quoi filtrer une liste (« Je
   * suis… ») sans charger le détail de chaque démarche.
   *
   * ⚠️ **Peut être vide**, et ce n'est pas une anomalie : la collectivité n'a
   * pas rempli les publics de cette démarche. Elle ne répond alors à AUCUN
   * choix du filtre — elle reste visible tant que l'usager ne filtre pas. La
   * lire comme « tous publics » la ferait apparaître sous chaque choix, y
   * compris là où elle n'est pas ouverte.
   */
  audiences: Audience[];
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

/**
 * L'organisme qu'un slug d'adresse désigne, cherché dans le catalogue lui-même.
 *
 * ⚠️ C'EST LE CATALOGUE QUI DIT QUI A UNE PAGE, et non une liste à tenir à
 * jour : un organisme n'est atteignable que s'il propose au moins une démarche
 * publiée. Le jour où il n'en propose plus, son adresse s'éteint d'elle-même
 * au lieu de mener à une page vide — et le jour où il publie, elle s'ouvre
 * sans que personne n'ait rien à activer.
 *
 * ⚠️ LA COLLECTIVITÉ ELLE-MÊME EST ÉCARTÉE (`tenantId`) : sa page, c'est
 * l'accueil du portail. La servir aussi sous son slug ferait deux adresses
 * pour la même page, donc deux façons de la partager et de la compter.
 */
export function organizationBySlug(
  demarches: Demarche[],
  slug: string,
  tenantId: string,
): DemarcheOrganization | null {
  const wanted = slug.trim().toLowerCase();
  if (wanted === "") return null;
  for (const demarche of demarches) {
    for (const org of demarche.organizations) {
      if (org.id === tenantId) continue;
      if (org.slug !== null && org.slug.toLowerCase() === wanted) return org;
    }
  }
  return null;
}

/**
 * Les démarches que cet organisme propose.
 *
 * ⚠️ Définie ICI, dans le domaine, et pas dans l'interface : le serveur (qui
 * sert la page d'un organisme) et l'interface (qui porte le filtre de
 * l'accueil) doivent filtrer de la même façon. Deux définitions divergeraient
 * au premier cas limite — et personne ne s'en apercevrait, puisque les deux
 * listes ne s'affichent jamais côte à côte.
 */
export function demarchesOfOrganization(
  demarches: Demarche[],
  organizationId: string,
): Demarche[] {
  return demarches.filter((demarche) =>
    demarche.organizations.some((org) => org.id === organizationId)
  );
}
