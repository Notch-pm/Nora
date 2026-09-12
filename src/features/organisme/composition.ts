/**
 * Logique pure de la page d'un organisme — testée sans DOM.
 *
 * Cette page n'a qu'une seule grille et pas de filtre par organisme (elle EN
 * est un) : elle réutilise les filtres élémentaires de
 * `portal/composition.ts` plutôt que d'en récrire une variante, et n'ajoute
 * ici que ce qui lui est propre.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import {
  emptyDemarchesKey,
  filterDemarchesByAudience,
  filterDemarchesByQuery,
} from "@/features/portal/composition.ts";

/**
 * Les démarches de l'organisme après recherche et filtre « Je suis… ».
 *
 * La recherche s'applique en premier — c'est le geste le plus récent de
 * l'usager — et le public affine ensuite son résultat, comme le fait
 * `HomeComposition` pour ses grilles.
 */
export function visibleOrganismeDemarches(
  demarches: Demarche[],
  query: string,
  audience: Audience | null,
): Demarche[] {
  return filterDemarchesByAudience(filterDemarchesByQuery(demarches, query), audience);
}

/**
 * Un signal, pas un identifiant : cette page est déjà bornée à UN organisme,
 * il n'y a nulle part où en choisir un autre. Passer une valeur non nulle à
 * `emptyDemarchesKey` revient donc à lui dire « un organisme EST choisi, comme
 * toujours ici » — seule sa nullité compte pour le choix du texte, jamais sa
 * valeur.
 */
const ORGANISME_TOUJOURS_CHOISI = "organisme-de-cette-page";

/**
 * Ce que dit la grille vide de cette page.
 *
 * ⚠️ Réutilise `emptyDemarchesKey` plutôt que d'en dupliquer la priorité entre
 * recherche, organisme et public : avec le signal ci-dessus, elle retombe
 * d'elle-même sur « Aucune démarche n'est proposée en ligne par cet
 * organisme. » (au lieu du message générique de l'accueil) quand rien d'autre
 * n'est filtré, et sur le texte à deux filtres quand un public est choisi en
 * plus — exactement le comportement voulu ici, sans écrire une seconde fois
 * cette logique.
 */
export function organismeEmptyKey(
  searchActive: boolean,
  audience: Audience | null,
): ReturnType<typeof emptyDemarchesKey> {
  return emptyDemarchesKey(searchActive, ORGANISME_TOUJOURS_CHOISI, audience);
}
