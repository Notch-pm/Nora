/**
 * Le jeton d'un lien reçu par courriel (`/compte/confirmer#jeton=…`,
 * `/compte/mot-de-passe#jeton=…`).
 *
 * ⚠️ DANS LE FRAGMENT, PAS DANS LA REQUÊTE : un fragment n'est jamais envoyé au
 * serveur, ni au relais, ni aux journaux d'accès. Mais il reste dans la barre
 * d'adresse, l'historique et le presse-papiers — `takeFragmentToken` l'EFFACE
 * donc de l'adresse avant tout appel. Le jeton ne vit plus qu'en mémoire.
 */

/** Le jeton d'un fragment (`#jeton=…`), ou `null`. Pur. */
export function readFragmentToken(hash: string): string | null {
  const value = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get("jeton");
  return value !== null && value.trim() !== "" ? value.trim() : null;
}

/**
 * Lit le jeton dans l'adresse courante, puis l'en retire (`replaceState` : pas
 * d'entrée d'historique, et l'état du routeur est conservé).
 */
export function takeFragmentToken(): string | null {
  const token = readFragmentToken(window.location.hash);
  if (window.location.hash !== "") {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
  return token;
}
