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
