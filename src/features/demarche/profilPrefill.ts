/**
 * « Dites-le nous une fois » : le profil du compte remplit « Vos
 * informations » d'un dépôt connecté.
 *
 * Ces champs sont VERROUILLÉS, pas proposés : au dépôt connecté, le serveur
 * déclare l'identité de la fiche du Socle et ignore ce que le formulaire en dit
 * (relecture de sécurité L3c, M1/A3). Les laisser modifiables faisait croire
 * qu'une correction partirait avec la demande (recette du 2026-10-20). Une
 * correction passe par « Mon compte ».
 *
 * Deux règles, et elles sont le contrat de l'écran :
 *   • on ne verrouille QUE les champs que le paramétrage de la collectivité
 *     affiche (`visibleKeys`) — un champ masqué ne reçoit rien ;
 *   • un champ que la fiche ne renseigne pas reste libre : le serveur garde
 *     alors la saisie de l'usager.
 */

/** Les champs visibles que la fiche renseigne, avec leur valeur. */
export function lockedFromProfil(fromProfil: Record<string, string>, visibleKeys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of visibleKeys) {
    const value = fromProfil[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

/** Les saisies, champs verrouillés imposés ; la MÊME référence si rien ne change (pas de rendu inutile). */
export function applyLocked(current: Record<string, string>, locked: Record<string, string>): Record<string, string> {
  return Object.entries(locked).every(([key, value]) => current[key] === value) ? current : { ...current, ...locked };
}
