/**
 * Ce que le navigateur décide avant d'annoncer une page vue — pur, testé.
 *
 * Trois questions, et rien d'autre : quel écran est affiché (`pageOf`), est-ce
 * une ARRIVÉE sur le site (`isArrival`), et cette page a-t-elle déjà été
 * comptée (`pageKey`) ?
 *
 * ⚠️ RIEN N'EST ÉCRIT SUR LE POSTE DU VISITEUR. Pas de cookie, pas de
 * `localStorage`, pas de `sessionStorage`. La déduplication tient dans une
 * variable de l'onglet, qui meurt avec lui — c'est tout ce dont on a besoin,
 * puisqu'on ne cherche pas à reconnaître un visiteur d'une visite à l'autre.
 * C'est cette absence, et elle seule, qui dispense d'un bandeau de
 * consentement (article 82 de la loi Informatique et Libertés).
 *
 * ⚠️ LE RÉFÉRENT NE SORT PAS D'ICI : il est lu, réduit à un oui/non, et jeté.
 * Le serveur ne saura donc jamais d'où vient un visiteur — la provenance a été
 * écartée du périmètre de la mesure.
 */

export const AUDIENCE_PAGES = ["accueil", "demarche", "formulaire"] as const;
export type AudiencePage = (typeof AUDIENCE_PAGES)[number];

export interface PageIdentity {
  page: AudiencePage;
  demarcheId: string | null;
}

/**
 * Quel écran l'adresse désigne, préfixe de langue compris.
 *
 * ⚠️ `null` POUR TOUTE AUTRE ADRESSE, et c'est volontaire : une route qu'on
 * ajouterait demain ne se compterait pas toute seule sous un nom approximatif.
 * Les trois pages sont un contrat partagé avec le Socle (la contrainte
 * `portal_audience_pages_page_check`) ; en ajouter une passe par une migration.
 *
 * ⚠️ CHANGER DE LANGUE SUR LA MÊME PAGE N'EST PAS UNE NOUVELLE PAGE VUE : le
 * préfixe est retiré avant toute comparaison, et `pageKey` n'en tient pas
 * compte. Sans cela, un visiteur qui bascule en breton doublerait les
 * compteurs de la page qu'il est en train de lire.
 */
export function pageOf(pathname: string): PageIdentity | null {
  const segments = pathname.split("/").filter((s) => s !== "");
  // Un premier segment de deux ou trois lettres est un code de langue : les
  // routes du portail commencent toutes par « demarches ».
  if (segments.length > 0 && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(segments[0]) && segments[0] !== "demarches") {
    segments.shift();
  }

  if (segments.length === 0) return { page: "accueil", demarcheId: null };
  if (segments[0] !== "demarches") return null;
  if (segments.length === 2) return { page: "demarche", demarcheId: segments[1] };
  if (segments.length === 3 && segments[2] === "formulaire") {
    return { page: "formulaire", demarcheId: segments[1] };
  }
  return null;
}

export interface ArrivalInput {
  /** `document.referrer` — lu ici, jamais transmis. */
  referrer: string;
  /** `location.host` de la page courante. */
  host: string;
  /** `performance.getEntriesByType("navigation")[0].type`, quand il existe. */
  navigationType: string | null;
}

/**
 * Une ARRIVÉE sur le site : la première page d'une navigation.
 *
 * La règle, telle qu'elle a été décidée : le référent n'est pas le site
 * lui-même (sinon c'est une navigation interne, ou un retour) et ce n'est pas
 * un rechargement.
 *
 * ⚠️ CE N'EST PAS UN VISITEUR UNIQUE, et le vocabulaire compte : quelqu'un qui
 * revient trois fois dans la journée compte trois visites. Sans identifiant, il
 * n'y a aucun moyen — ni aucune envie — de savoir que c'est la même personne.
 *
 * ⚠️ Un référent VIDE compte comme une arrivée : c'est le cas d'une adresse
 * tapée à la main, d'un favori, d'un lien ouvert depuis un courriel ou une
 * application. C'est la majorité des vraies arrivées, et les exclure viderait
 * la mesure de son sens.
 */
export function isArrival({ referrer, host, navigationType }: ArrivalInput): boolean {
  if (navigationType === "reload" || navigationType === "back_forward") return false;
  if (referrer === "") return true;
  try {
    return new URL(referrer).host !== host;
  } catch {
    // Un référent illisible n'est pas le site : on compte l'arrivée plutôt que
    // de la perdre.
    return true;
  }
}

/**
 * L'identité d'une page pour la déduplication, dans l'onglet courant.
 *
 * Elle ignore délibérément la langue (voir `pageOf`) et la chaîne de requête :
 * un filtre appliqué sur la grille de démarches ne change pas la page qu'on
 * regarde.
 */
export function pageKey(identity: PageIdentity): string {
  return identity.demarcheId === null ? identity.page : `${identity.page}:${identity.demarcheId}`;
}
