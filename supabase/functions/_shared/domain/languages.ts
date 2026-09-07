/**
 * La langue du visiteur — modèle du PORTAIL.
 *
 * Une collectivité choisit au Socle les langues dans lesquelles elle s'adresse
 * à ses usagers ; le portail en fait un sélecteur, et sert ses textes dans
 * celle que le visiteur a choisie.
 *
 * ⚠️ LE FRANÇAIS EST LA LANGUE PIVOT, ici comme au Socle. Il porte les colonnes
 * elles-mêmes (`name`, `short_description`, `title`…) et n'a **jamais** d'entrée
 * dans `translations` : l'y écrire créerait une seconde source de vérité pour un
 * même texte. Il est donc toujours disponible, toujours en tête, et c'est lui
 * qu'on sert quand on ne sait pas quoi servir d'autre.
 *
 * ⚠️ LE REPLI SE FAIT CHAMP PAR CHAMP, jamais langue par langue. Une démarche
 * peut avoir son intitulé traduit en breton sans son résumé : c'est le cas
 * normal, pas une traduction inachevée. Replier la langue entière parce qu'un
 * champ manque masquerait un travail que la collectivité a bel et bien fait.
 *
 * Module PUR : pas de Deno, pas de réseau. Miroir volontaire de
 * `Socle/src/features/languages/{languages,translations}.ts` et de
 * `readLanguages` dans son `public-api/_shared/serializers.ts` — même motif que
 * `formSchema.ts` et `requesterConfig.ts`, et testé des deux côtés.
 */

/** La langue qui n'est jamais une traduction. */
export const PIVOT_LANGUAGE = "fr";

/**
 * Forme d'un code de langue — miroir du CHECK `is_valid_language_set` en base.
 * Volontairement plus large que le catalogue du Socle : c'est la collectivité
 * qui fait autorité sur SA liste, pas cette expression.
 */
export const LANGUAGE_CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/**
 * Les langues écrites de droite à gauche.
 *
 * ⚠️ `ku` N'EN FAIT PAS PARTIE : le catalogue du Socle nomme ainsi le kurde
 * kurmandji, écrit en alphabet latin en Turquie et en Europe. C'est le sorani
 * (`ckb`, absent du catalogue) qui s'écrit en alphabet arabe.
 */
const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur", "ps"]);

/** Cette langue s'écrit-elle de droite à gauche ? */
export function isRtl(code: string): boolean {
  return RTL_LANGUAGES.has(code.trim().toLowerCase().split("-")[0]);
}

/**
 * Les langues d'une collectivité, lues avec tolérance.
 *
 * Le français y est **toujours** et **en tête**, même si le Socle ne l'a pas
 * servi : un portail sans langue par défaut n'aurait rien à afficher. Les codes
 * mal formés et les doublons sont écartés un à un — une entrée abîmée ne prive
 * pas la collectivité de ses autres langues.
 */
export function parseLanguages(value: unknown): string[] {
  const out = [PIVOT_LANGUAGE];
  if (!Array.isArray(value)) return out;
  for (const item of value) {
    if (typeof item !== "string") continue;
    const code = item.trim().toLowerCase();
    if (!LANGUAGE_CODE_RE.test(code) || out.includes(code)) continue;
    out.push(code);
  }
  return out;
}

/**
 * La langue à servir : celle demandée si la collectivité l'a activée, le
 * français sinon.
 *
 * ⚠️ C'EST LE SERVEUR QUI TRANCHE, jamais le navigateur. Une langue mémorisée
 * dans un navigateur puis désactivée par la collectivité, un préfixe d'URL
 * inventé, un code mal formé : tous retombent ici sur le français, et la
 * réponse dit laquelle a été servie pour que l'adresse cesse de mentir.
 */
export function resolveLang(asked: string | null | undefined, available: readonly string[]): string {
  if (typeof asked !== "string") return PIVOT_LANGUAGE;
  const code = asked.trim().toLowerCase();
  if (!LANGUAGE_CODE_RE.test(code)) return PIVOT_LANGUAGE;
  return available.includes(code) ? code : PIVOT_LANGUAGE;
}

/**
 * Le texte à afficher dans une langue donnée, **repli sur le français**.
 *
 * Miroir de `localizedField` au Socle. `translations` est la colonne servie
 * telle quelle par l'API (`{ "<code>": { "<champ>": "…" } }`) ; une chaîne vide
 * y vaut **absence**, pas texte vide — le Socle garantit ne jamais en stocker,
 * mais la règle appartient au lecteur, et un JSON écrit à la main pourrait en
 * porter.
 *
 * Rend `null` quand ni la traduction ni le français n'existent : les champs du
 * portail sont facultatifs, et `null` se compose (`?? autreChamp`) là où `""`
 * afficherait un vide.
 */
export function localizedText(
  source: string | null | undefined,
  translations: unknown,
  code: string,
  field: string,
): string | null {
  const fallback = typeof source === "string" && source.trim() !== "" ? source.trim() : null;
  if (code === PIVOT_LANGUAGE) return fallback;
  if (typeof translations !== "object" || translations === null || Array.isArray(translations)) {
    return fallback;
  }
  const entry = (translations as Record<string, unknown>)[code];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return fallback;
  const translated = (entry as Record<string, unknown>)[field];
  if (typeof translated !== "string" || translated.trim() === "") return fallback;
  return translated.trim();
}
