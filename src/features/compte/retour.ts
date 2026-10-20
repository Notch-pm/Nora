/**
 * Le « retour » d'une connexion : où ramener l'usager une fois connecté
 * (`/compte/connexion?retour=/demarches/abc`).
 *
 * ⚠️ ANTI REDIRECTION OUVERTE. Le paramètre vient de l'adresse, donc de
 * n'importe qui : un lien piégé `?retour=https://autre-site.example` ferait
 * atterrir un usager fraîchement connecté sur un faux portail. Seul un chemin
 * RELATIF INTERNE est accepté — il commence par un seul `/`. Sont refusés :
 *   • `//hote` et `/\hote` (les navigateurs les lisent comme « même schéma,
 *     autre hôte ») ;
 *   • tout ce qui n'est pas un chemin (`https:`, `javascript:`, `hote/chemin`) ;
 *   • les caractères de contrôle et les antislashs, et une longueur
 *     déraisonnable.
 * Tout le reste retombe sur « Mon compte » (c'est l'appelant qui choisit).
 */

const MAX_LENGTH = 512;

/** Le chemin à suivre, ou `null` s'il n'est pas sûr. */
export function safeRetour(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw === "" || raw.length > MAX_LENGTH) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Contrôles (tabulation et retour ligne, que les navigateurs retirent d'une URL) et antislashs.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  return raw;
}

/** L'adresse de la connexion qui ramènera à `retourPath` ; `connexionPath` est déjà localisée. */
export function connexionUrl(connexionPath: string, retourPath: string): string {
  return safeRetour(retourPath) === null
    ? connexionPath
    : connexionPath + "?retour=" + encodeURIComponent(retourPath);
}
