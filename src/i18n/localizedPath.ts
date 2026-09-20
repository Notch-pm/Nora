/**
 * La langue dans l'ADRESSE — la partie pure.
 *
 * Le portail porte la langue choisie dans un préfixe de chemin : `/en`,
 * `/en/demarches/{id}`. Deux raisons, et aucune n'est technique :
 *
 *  • une page publique se partage et s'indexe. Un lien envoyé par un habitant
 *    doit rouvrir la page dans la langue où il l'a lue ;
 *  • ⚠️ LE FRANÇAIS N'A PAS DE PRÉFIXE. C'est la langue pivot, pas une
 *    traduction — la même règle qu'au Socle, où `translations` n'a jamais de
 *    clé `fr`. Bénéfice pratique : toutes les adresses déjà partagées, déjà
 *    indexées, déjà en favori continuent de fonctionner à l'identique.
 *
 * ⚠️ Un segment de route ne peut pas être pris pour une langue : `demarches`
 * fait neuf lettres et ne passe pas `LANG_SEGMENT_RE`. C'est ce qui permet de
 * lire le préfixe sans connaître la table des routes.
 */

/**
 * La langue sur laquelle l'ADRESSE doit s'aligner — ou `null` s'il n'y a rien à
 * en conclure.
 *
 * ⚠️ CETTE FONCTION EXISTE POUR UN BOGUE PRÉCIS, vu en production le
 * 2026-09-07 : choisir l'anglais rechargeait la page et laissait l'adresse en
 * français. Entre le clic et le départ du nouveau chargement, l'état « prêt »
 * est encore celui de la langue PRÉCÉDENTE ; l'effet qui aligne l'adresse se
 * rejouait dessus et ramenait le visiteur à la langue qu'il venait de quitter.
 *
 * D'où la comparaison : une réponse ne vaut que pour la question qu'elle a
 * reçue. Tant que `requested` n'est pas la langue demandée maintenant, on ne
 * touche à rien — et surtout pas à l'adresse.
 */
export function servedLanguage(
  answer: { requested: string; lang: string } | null,
  asked: string,
): string | null {
  if (answer === null) return null;
  return answer.requested === asked ? answer.lang : null;
}

/** Forme d'un code de langue — miroir de celle du serveur et du Socle. */
export const LANG_SEGMENT_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/** La langue qui n'apparaît jamais dans l'adresse. */
export const PIVOT_LANGUAGE = "fr";

/**
 * Sépare le préfixe de langue du chemin réel.
 *
 * `lang` est ce que l'adresse DEMANDE, pas ce qui sera servi : la collectivité
 * peut ne pas avoir activé cette langue, et c'est le serveur qui tranche. On ne
 * valide donc ici que la FORME.
 */
export function splitLangPath(pathname: string): { lang: string | null; path: string } {
  const cleaned = pathname.startsWith("/") ? pathname : "/" + pathname;
  const [, first = "", ...rest] = cleaned.split("/");
  if (!LANG_SEGMENT_RE.test(first)) return { lang: null, path: cleaned };
  const path = "/" + rest.join("/");
  return { lang: first, path: path === "/" ? "/" : path.replace(/\/$/, "") };
}

/**
 * Le chemin d'une page dans une langue donnée. `path` est le chemin NU (sans
 * préfixe), tel que `splitLangPath` le rend.
 */
export function localizedPath(lang: string, path: string): string {
  const bare = path.startsWith("/") ? path : "/" + path;
  if (lang === PIVOT_LANGUAGE || !LANG_SEGMENT_RE.test(lang)) return bare;
  return bare === "/" ? "/" + lang : "/" + lang + bare;
}

/**
 * Les segments de route du portail — ceux qu'un slug d'organisme ne peut pas
 * être. Une constante, parce qu'ils étaient écrits en dur à deux endroits, où
 * ils ne pouvaient que se désynchroniser.
 *
 * ⚠️ `accessibilite` (2026-09-18) : sans lui, `/accessibilite` se lirait comme
 * la page d'un organisme de ce nom. Le Socle l'interdit d'ailleurs comme slug
 * depuis le 2026-09-12 (`organizations_slug_url_form`) — les deux listes se
 * lisent ensemble.
 *
 * ⚠️ `assistant` (2026-09-20) : même raison, pour `/assistant`. Le Socle ne
 * l'interdit pas encore comme slug d'organisme au moment d'écrire ceci — à
 * signaler côté référentiel, sur le modèle d'`accessibilite`.
 */
export const ROUTE_SEGMENTS: readonly string[] = ["demarches", "accessibilite", "assistant"];

/**
 * Sépare un éventuel préfixe d'ORGANISME du chemin réel. `path` est le chemin
 * nu, tel que `splitLangPath` le rend — la langue en a déjà été retirée.
 *
 * ⚠️ LA RÈGLE EST LEXICALE, comme celle des langues, et c'est tout l'intérêt :
 * elle permet de lire une adresse sans connaître la liste des organismes, donc
 * sans attendre le serveur pour savoir quel écran afficher. Un premier segment
 * est un organisme s'il n'est ni un segment de route (`demarches`) ni lisible
 * comme un code de langue (deux ou trois lettres).
 *
 * ⚠️ LE SOCLE TIENT L'AUTRE BOUT DE CETTE RÈGLE : un slug d'organisme y fait au
 * moins quatre caractères, précisément pour ne jamais pouvoir être pris pour
 * une langue. Les deux contraintes se lisent ensemble ou pas du tout — c'est
 * pourquoi `LANG_SEGMENT_RE` est citée dans la migration qui la pose.
 */
export function splitOrganismePath(path: string): { organisme: string | null; path: string } {
  const cleaned = path.startsWith("/") ? path : "/" + path;
  const [, first = "", ...rest] = cleaned.split("/");
  if (first === "" || ROUTE_SEGMENTS.includes(first) || LANG_SEGMENT_RE.test(first)) {
    return { organisme: null, path: cleaned };
  }
  const bare = "/" + rest.join("/");
  return { organisme: first, path: bare === "/" ? "/" : bare.replace(/\/$/, "") };
}

/**
 * Ce qu'une adresse du portail dit d'elle-même : la langue demandée,
 * l'organisme visité, et l'écran. Une seule fonction pour tout le portail —
 * le routage, les liens et la mesure la partagent, si bien qu'une règle
 * d'adresse ne peut pas exister en deux versions.
 */
export function splitScopedPath(
  pathname: string,
): { lang: string | null; organisme: string | null; path: string } {
  const { lang, path } = splitLangPath(pathname);
  const { organisme, path: bare } = splitOrganismePath(path);
  return { lang, organisme, path: bare };
}

/**
 * Le chemin d'une page dans le périmètre d'un organisme, langue comprise.
 * `organisme` à `null` rend simplement le chemin de la collectivité : c'est ce
 * qui permet aux écrans partagés (une démarche, son formulaire) de construire
 * leurs liens sans savoir s'ils sont ou non sous un organisme.
 */
export function organismePath(lang: string, organisme: string | null, path: string): string {
  const bare = path.startsWith("/") ? path : "/" + path;
  const scoped = organisme === null ? bare : "/" + organisme + (bare === "/" ? "" : bare);
  return localizedPath(lang, scoped);
}
