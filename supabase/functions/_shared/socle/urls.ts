/**
 * Les URL que le portail accepte de poser dans une page publique.
 *
 * Une seule règle, et elle est de sécurité avant d'être de forme : **`https`
 * absolu, ou rien**. Ce qui n'est pas une URL https est ÉCARTÉ, jamais
 * « nettoyé » — `javascript:` et `data:` n'ont pas de forme inoffensive qu'on
 * saurait reconstituer, et une URL bricolée qu'on rafistolerait pointerait de
 * toute façon ailleurs que ce que la collectivité croyait.
 *
 * ⚠️ POURQUOI `http://` ET LES CHEMINS ABSOLUS SONT ÉCARTÉS EUX AUSSI :
 *
 *  • le portail est servi en **https** ; un `http://` y serait bloqué par le
 *    navigateur comme contenu mixte — l'accepter promettrait une image qui ne
 *    s'affiche jamais ;
 *  • un chemin absolu (`/media/x.jpg`) se résout sur le domaine **du portail**,
 *    qui n'héberge aucun média de collectivité : ce serait un 404 systématique.
 *
 * Le Socle applique la même règle à la saisie (`IMAGE_URL`) : une adresse
 * acceptée là-bas et écartée ici ne se découvrirait qu'en production, sur une
 * page où l'agent croyait avoir mis une image. La garde reste des deux côtés —
 * la colonne peut aussi avoir été écrite avant que l'éditeur ne la pose.
 */

/** URL absolue en https ; tout le reste → `null`. */
export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
