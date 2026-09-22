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
  /**
   * Le logo PROPRE de l'organisme — celui qu'il a lui-même, jamais celui dont
   * il hérite.
   *
   * ⚠️ C'est ce qui permet de le reconnaître dans une LISTE (le menu « Ma
   * ville »). Le Socle sert ici la valeur brute, à la différence de la charte
   * d'une page : un logo hérité donnerait la même image à chaque ligne, celle
   * de l'intercommunalité, et la liste ne distinguerait plus rien. `null` veut
   * donc dire « pas de logo à lui » — on affiche une pastille à sa couleur,
   * comme l'en-tête le fait déjà, jamais le logo de la collectivité.
   */
  logoUrl: string | null;
  /**
   * Le SERVICE INTERNE qui instruit, quand ce n'est pas l'organisme affiché.
   *
   * ⚠️ La vitrine et le guichet ne sont pas le même organisme. Le Socle nomme
   * ici le porteur — « Mairie de Rosny-sous-Bois », ce que l'usager voit et
   * choisit — et donne à part celui qui a activé la démarche, « Services
   * techniques ». C'est CE dernier qu'Iris attend au dépôt : il refuse toute
   * demande adressée à un organisme qui n'active pas la démarche, et le
   * porteur ne l'active pas — son service le fait pour lui. Constaté le
   * 2026-09-22 sur test2 : formulaire rempli, envoi refusé.
   *
   * Absent ou `null` : l'organisme affiché instruit lui-même. Le portail ne le
   * montre jamais — la collectivité a choisi de ne pas le montrer.
   */
  handlingOrganizationId?: string | null;
}

/** L'organisme auquel une demande s'ADRESSE — le service qui instruit, sinon l'affiché. */
export function handlingOrganizationOf(org: DemarcheOrganization): string {
  return org.handlingOrganizationId ?? org.id;
}

/**
 * Une VILLE au sens du portail : un organisme de la collectivité qui a une
 * page, tel que le menu « Ma ville » le propose.
 *
 * Le mot est celui de l'usager — « ma ville » — pas celui du référentiel, où
 * ce sont des organisations. Ce sont le plus souvent des communes ; ce peut
 * être un service externe qui tient son propre guichet. Un service INTERNE n'y
 * figure jamais : le Socle ne le nomme pas, c'est son porteur qui apparaît.
 */
export interface Ville {
  id: string;
  name: string;
  /** Jamais `null` ici : sans slug, pas d'adresse, donc pas d'entrée de menu. */
  slug: string;
  logoUrl: string | null;
}

import type { FormSchema } from "./formSchema.ts";
import type { Audience, RequesterConfig } from "./requesterConfig.ts";
import type { UserCommunication } from "./userCommunication.ts";

export interface Demarche {
  id: string;
  /** Intitulé de la démarche. */
  name: string;
  /**
   * Texte public à afficher, en TEXTE BRUT — `null` si la collectivité n'en a
   * rempli aucun.
   *
   * ⚠️ Sur une carte, c'est le résumé, ou à défaut le premier paragraphe du
   * descriptif (qui est du Markdown : ses marques sont retirées). Sur le
   * DÉTAIL, c'est le résumé seul — voir `DemarcheDetail.userDescription`.
   */
  description: string | null;
  /**
   * Temps pour REMPLIR le formulaire, en minutes.
   *
   * ⚠️ Pas le temps pour obtenir une RÉPONSE — c'est
   * `DemarcheDetail.userCommunication.responseDelay`, qui a son unité.
   */
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
   * Le descriptif rédigé POUR l'usager, en entier, en **MARKDOWN** (contrat
   * 1.24.0) — à rendre avec `Markdown.tsx`, jamais tel quel.
   *
   * Distinct de `description`, qui est ici le RÉSUMÉ SEUL : sur la page d'une
   * démarche, les deux se lisent l'un après l'autre. Le repli de la carte
   * (résumé absent → début du descriptif) n'a pas cours ici, sans quoi le
   * premier paragraphe s'afficherait deux fois.
   */
  userDescription: string | null;
  /** `null` = démarche sans formulaire : elle s'affiche, sans saisie. */
  form: FormSchema | null;
  requester: RequesterConfig;
  /**
   * Délai de traitement, public concerné, pièces annoncées, FAQ — voir
   * `userCommunication.ts`. Jamais `null` : rien d'écrit donne des blocs
   * vides, et l'écran n'affiche que ce qui est rempli.
   */
  userCommunication: UserCommunication;
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

/** Trie deux villes comme une liste se lit en français. */
const villeCollator = new Intl.Collator("fr", { sensitivity: "base" });

/**
 * Les villes de cette collectivité : les organismes qui ont une page, dans
 * l'ordre où une liste se lit.
 *
 * ⚠️ LA LISTE VIENT DU CATALOGUE, et c'est la même règle que pour les pages
 * elles-mêmes : un organisme y figure tant qu'il propose au moins une démarche
 * publiée. Lister le sous-arbre entier ferait des entrées de menu qui mènent à
 * une page inexistante — un lien mort dans une navigation.
 *
 * ⚠️ DEUX EXCLUSIONS, toutes deux pour la même raison — l'entrée doit mener
 * quelque part :
 *   · la collectivité elle-même, dont la page est l'accueil du portail ;
 *   · un organisme sans slug, qui n'a pas d'adresse.
 *
 * Proche parente de `organizationsOffering` (côté interface), qui sert le
 * FILTRE de l'accueil : celle-là garde la collectivité, en tête, parce que
 * filtrer sur elle a un sens. Ici, il s'agit d'aller ailleurs.
 */
export function villesOf(demarches: Demarche[], tenantId: string): Ville[] {
  const byId = new Map<string, Ville>();
  for (const demarche of demarches) {
    for (const org of demarche.organizations) {
      if (org.id === tenantId || org.slug === null || byId.has(org.id)) continue;
      byId.set(org.id, { id: org.id, name: org.name, slug: org.slug, logoUrl: org.logoUrl });
    }
  }
  return [...byId.values()].sort((a, b) => villeCollator.compare(a.name, b.name));
}
