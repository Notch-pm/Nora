/**
 * Pose `document.title` — la seule API pour ça, hors du rendu React.
 *
 * ⚠️ Appelé sans condition, à chaque rendu du composant qui l'utilise : la
 * valeur reçue doit déjà couvrir tous les états de l'écran (chargement, erreur,
 * prêt). C'est ce qui permet de le poser avant les retours anticipés d'un
 * composant à plusieurs états, sans enfreindre l'ordre des hooks.
 *
 * `null` ne touche à rien — le cas d'un composant qui DÉLÈGUE son titre à un
 * enfant plus précis (`PortalPage` → `HomeComposition` / `DefaultCatalogue`) :
 * les effets s'exécutent enfant d'abord, parent ensuite, donc un parent qui
 * poserait quand même un titre générique écraserait celui de l'enfant après
 * coup. `null` évite cette course.
 */
import { useEffect } from "react";

export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title !== null) document.title = title;
  }, [title]);
}
