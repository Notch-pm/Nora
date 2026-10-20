/**
 * « Dites-le nous une fois » : le profil du compte préremplit « Vos
 * informations » d'un dépôt connecté.
 *
 * Deux règles, et elles sont le contrat de l'écran :
 *   • on ne remplit QUE les champs que le paramétrage de la collectivité
 *     affiche (`visibleKeys`) — un champ masqué ne reçoit rien, il partirait
 *     dans la demande sans que l'usager l'ait vu ;
 *   • on n'ÉCRASE JAMAIS une saisie : un champ déjà renseigné (même par le
 *     pré-remplissage de l'assistant) garde sa valeur.
 */

/** Les valeurs fusionnées ; la MÊME référence si rien ne change (pas de rendu inutile). */
export function mergePrefill(
  current: Record<string, string>,
  fromProfil: Record<string, string>,
  visibleKeys: readonly string[],
): Record<string, string> {
  let next: Record<string, string> | null = null;
  for (const key of visibleKeys) {
    const proposed = fromProfil[key];
    if (typeof proposed !== "string" || proposed.trim() === "") continue;
    if ((current[key] ?? "").trim() !== "") continue;
    next ??= { ...current };
    next[key] = proposed;
  }
  return next ?? current;
}

/** Au moins un champ visible recevrait une valeur : la phrase « préremplies » n'a de sens que dans ce cas. */
export function hasPrefillFor(fromProfil: Record<string, string>, visibleKeys: readonly string[]): boolean {
  return visibleKeys.some((key) => (fromProfil[key] ?? "").trim() !== "");
}
