/**
 * La charte graphique de la collectivité — modèle du PORTAIL.
 *
 * Le Socle la sert déjà résolue (`GET /v1/organizations/{id}/branding`) :
 * l'héritage le long de la hiérarchie est fait chez lui, le portail reçoit ce
 * qui s'applique. Ici ne reste que ce que la page peint.
 *
 * Chaque champ est nul quand la collectivité ne l'a pas renseigné : le portail
 * retombe alors sur ses valeurs par défaut, champ par champ — une commune qui
 * n'a défini que sa couleur principale n'a pas à en perdre l'effet parce que
 * son logo manque.
 *
 * Les couleurs sont des valeurs CSS injectées dans la page : elles n'entrent
 * que sous la forme `#rrggbb`, vérifiée à la traduction. Les URL d'image
 * n'entrent qu'en `https` — une image servie en clair sur une page chiffrée
 * serait bloquée par le navigateur, autant ne pas la promettre.
 */
export interface Branding {
  /** Logo couleur, pour fond clair. */
  logoUrl: string | null;
  /** Logo blanc, pour fond sombre (bandeau « espace usager »). */
  logoWhiteUrl: string | null;
  /**
   * Favicon : l'icône de l'onglet du navigateur et des favoris.
   *
   * ⚠️ Le seul élément de la charte qui ne se peint PAS dans la page : il se
   * pose en `<link rel="icon">` dans l'en-tête du document. Son absence laisse
   * au navigateur l'icône qu'il voudra — le portail n'en fournit pas d'autre.
   */
  faviconUrl: string | null;
  /** Couleur principale, `#rrggbb` minuscule. */
  primaryColor: string | null;
  /** Couleur secondaire, `#rrggbb` minuscule. */
  secondaryColor: string | null;
}
