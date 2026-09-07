/**
 * La collectivité derrière le domaine visité — modèle du PORTAIL.
 *
 * Volontairement défini ici, et pas recopié d'un DTO du Socle : le portail doit
 * pouvoir survivre à un renommage de colonne, à un champ qui disparaît du
 * référentiel ou à un changement de contrat. Le seul endroit qui connaisse la
 * forme des réponses du Socle est `socle/tenantService.ts`, qui traduit vers ce
 * type. Tout le reste du portail — interface comprise — ne voit que celui-ci.
 */
export interface Tenant {
  /** Identifiant de la collectivité au Socle. Sert à demander ses démarches. */
  id: string;
  /** Nom affichable, tel que la collectivité l'a défini. */
  name: string;
  /** Identifiant lisible, quand la collectivité en a un. */
  slug: string | null;
  /** Domaine par lequel la collectivité a été reconnue (forme canonique). */
  hostname: string;
  /**
   * Les langues dans lesquelles la collectivité s'adresse à ses usagers, codes
   * BCP 47, **français toujours compris et toujours en tête**. C'est de quoi
   * bâtir le sélecteur de langue — et rien d'autre : qu'une langue soit
   * activée ne dit pas que tout est traduit dedans, le repli sur le français se
   * fait texte par texte.
   */
  languages: string[];
}
