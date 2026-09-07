/**
 * Les textes du PORTAIL LUI-MÊME — boutons, messages, étiquettes.
 *
 * À ne pas confondre avec ce que la collectivité écrit (noms de démarches,
 * blocs de la page d'accueil) : ceux-là sont traduits au Socle, par l'agent qui
 * les rédige, et arrivent déjà dans la bonne langue. Ici, ce sont les mots de
 * l'outil, que l'éditeur écrit une fois pour tout le monde.
 *
 * Un dictionnaire statique et une fonction de neuf lignes, comme la borne
 * d'Ariane (`src/lib/kiosk-i18n.ts`) : zéro dépendance, zéro appel réseau, zéro
 * coût, et un texte qui ne change pas d'une visite à l'autre. Deux défauts de
 * cette borne ne sont PAS repris, et c'est délibéré :
 *
 *  • son interpolation ne remplaçait que la PREMIÈRE occurrence d'un marqueur
 *    (`text.replace("{plural}", …)`), ce qui laissait « {plural} » à l'écran en
 *    espagnol et en italien. Ici le remplacement est global ;
 *  • son pluriel était « à la française » (`n > 1 ? "s" : ""`), injecté tel quel
 *    dans les sept langues — absurde en chinois, faux en arabe. Ici, c'est
 *    `Intl.PluralRules` qui décide, langue par langue.
 */
import { PIVOT_LANGUAGE } from "./localizedPath.ts";
import { STRINGS, type StringKey } from "./strings.ts";

/**
 * Un texte de l'interface, dans la langue demandée.
 *
 * ⚠️ LE REPLI EST PAR CLÉ, PAS PAR LANGUE — la même règle qu'au Socle pour les
 * traductions de contenu. Une langue couverte à 90 % affiche les 10 % restants
 * en français ; on ne rebascule pas tout le portail en français parce qu'une
 * clé manque. Le français est garanti **par le type** : `STRINGS[key].fr` ne
 * peut pas être absent.
 */
export function t(
  lang: string,
  key: StringKey,
  params?: Record<string, string | number>,
): string {
  const entry = STRINGS[key] as Record<string, string | undefined>;
  return interpolate(entry[lang] ?? STRINGS[key].fr, params);
}

/**
 * Remplace les marqueurs `{nom}` par leur valeur.
 *
 * ⚠️ Global (`/g`), et un marqueur non fourni reste VISIBLE : `{n}` à l'écran
 * se voit et se corrige, `undefined` se lit comme un bogue de l'usager.
 */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Un texte qui s'accorde en nombre.
 *
 * La clé de base porte les variantes (`…​.one`, `…​.other`) ; la règle vient de
 * `Intl.PluralRules`, qui connaît le duel arabe et l'absence de pluriel
 * chinois. Le nombre est exposé sous `{n}`.
 */
export function tn(
  lang: string,
  base: string,
  count: number,
  params: Record<string, string | number> = {},
): string {
  let rule = "other";
  try {
    rule = new Intl.PluralRules(lang).select(count);
  } catch {
    // Langue que le navigateur ne connaît pas : la forme générale fera l'affaire.
  }
  const exact = `${base}.${rule}`;
  const key = (exact in STRINGS ? exact : `${base}.other`) as StringKey;
  return t(lang, key, { ...params, n: count });
}

/**
 * Le texte d'une erreur de saisie, ou `null`.
 *
 * Les modules purs (`formulaire.ts`) rendent un CODE et ses paramètres ; c'est
 * ici que ça devient une phrase, et seulement ici.
 */
export function errorText(
  lang: string,
  error: { key: StringKey; params?: Record<string, string | number> } | null | undefined,
): string | null {
  return error ? t(lang, error.key, error.params) : null;
}

export { PIVOT_LANGUAGE };
