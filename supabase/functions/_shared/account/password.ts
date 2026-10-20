/**
 * La politique de mot de passe du compte citoyen (CCTP Sceaux 6.3) — logique
 * pure, partagée avec l'écran par `@fn` : l'usager voit les mêmes règles que
 * celles que le serveur applique, écrites une fois.
 *
 * 12 caractères au moins, au moins une lettre, un chiffre et un caractère
 * spécial. Plafond à 72 OCTETS : GoTrue hache en bcrypt, qui ignore tout ce qui
 * dépasse — un mot de passe plus long serait accepté mais tronqué en silence.
 */

export type PasswordRule = "length" | "letter" | "digit" | "special" | "too_long";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

/** Les règles NON respectées, dans l'ordre d'affichage. Vide = accepté. */
export function unmetPasswordRules(password: string): PasswordRule[] {
  const unmet: PasswordRule[] = [];
  if ([...password].length < PASSWORD_MIN_LENGTH) unmet.push("length");
  if (!/\p{L}/u.test(password)) unmet.push("letter");
  if (!/\p{Nd}/u.test(password)) unmet.push("digit");
  if (!/[^\p{L}\p{Nd}\s]/u.test(password)) unmet.push("special");
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) unmet.push("too_long");
  return unmet;
}
