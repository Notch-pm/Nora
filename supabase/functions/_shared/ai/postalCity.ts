/**
 * La VILLE se déduit du CODE POSTAL — par le serveur, jamais par le modèle.
 *
 * Constaté en test : le modèle demande « le code postal et la ville ? »,
 * l'usager répond « 44000 ». Personne ne répond « 44000 Nantes » à un humain
 * qui sait lire un code postal ; redemander la ville, c'est faire payer à
 * l'usager le découpage du formulaire.
 *
 * ⚠️ Un modèle de langage « sait » que 44000 est Nantes, et se trompe sur une
 * commune de 800 habitants sans que rien ne le signale. Une adresse fausse sur
 * un signalement envoie une équipe au mauvais endroit : c'est un RÉFÉRENTIEL
 * qui répond (la base officielle des codes postaux, via `geo.api.gouv.fr`), et
 * la valeur porte quand même le badge « déduit » — l'usager la relit.
 *
 * ⚠️ Un code postal couvre souvent PLUSIEURS communes. On ne remplit que s'il
 * n'y en a qu'une ; sinon on les donne au modèle, qui demande laquelle.
 *
 * Ce fichier est pur : le réseau est reçu en paramètre par `turn.ts`.
 */
import type { Field, FormSchema } from "../domain/formSchema.ts";
import { allFields } from "../domain/formSchema.ts";

/**
 * Les deux champs se reconnaissent à leur CLÉ machine — la seule chose stable
 * d'un formulaire (un libellé se traduit et se réécrit). Le bloc d'adresse du
 * Socle les nomme `<préfixe>_code_postal` et `<préfixe>_ville` : c'est le
 * préfixe commun qui les apparie, pour qu'un formulaire à deux adresses ne
 * croise pas l'une avec l'autre.
 */
const POSTAL_KEY = /^(.*?)(?:code_?postal|postal_?code|zip_?code)$/i;
const CITY_KEY = /^(.*?)(?:ville|commune|city|localite)$/i;

export interface PostalCityPair {
  postal: Field;
  city: Field;
}

export function postalCityPairs(schema: FormSchema): PostalCityPair[] {
  const fields = allFields(schema).filter((field) => field.type === "text");
  const pairs: PostalCityPair[] = [];
  for (const postal of fields) {
    const prefix = POSTAL_KEY.exec(postal.key)?.[1];
    if (prefix === undefined) continue;
    const city = fields.find((field) => CITY_KEY.exec(field.key)?.[1] === prefix);
    if (city !== undefined) pairs.push({ postal, city });
  }
  return pairs;
}

const POSTAL_CODE = /^\d{5}$/;

/** Un code postal français bien formé, ou `null`. */
export function readPostalCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, "");
  return POSTAL_CODE.test(clean) ? clean : null;
}

/**
 * LE code postal d'un message — seulement s'il n'y en a qu'un. Deux nombres à
 * cinq chiffres, et on ne sait plus lequel est le code postal : on s'abstient,
 * le modèle tranchera et la déduction se fera au tour suivant.
 */
export function postalCodeIn(text: string): string | null {
  const found = [...new Set(text.match(/(?<!\d)\d{5}(?!\d)/g) ?? [])];
  return found.length === 1 ? found[0] : null;
}

const MAX_COMMUNES = 12;

/** La réponse de `geo.api.gouv.fr/communes?codePostal=…`, ramenée à des noms. */
export function readCommunes(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const names: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const name = (entry as Record<string, unknown>).nom;
    if (typeof name !== "string") continue;
    const clean = name.trim().slice(0, 80);
    if (clean !== "" && !names.includes(clean)) names.push(clean);
  }
  return names.slice(0, MAX_COMMUNES);
}

/** Ce que le prompt dit au modèle de ce que le référentiel a répondu. */
export interface CityHint {
  postalCode: string;
  /** Le champ « ville » concerné — de quoi le désigner dans la liste. */
  cityFieldId: string;
  communes: string[];
}

/**
 * La justification affichée sous le badge « déduit ». Écrite par le serveur,
 * donc à traduire ici : le modèle, lui, écrit les siennes dans la langue servie.
 */
const REASONS: Record<string, (code: string) => string> = {
  fr: (code) => `D'après le code postal ${code}.`,
  en: (code) => `From the postcode ${code}.`,
  es: (code) => `Según el código postal ${code}.`,
  de: (code) => `Anhand der Postleitzahl ${code}.`,
};

export function cityReason(lang: string, postalCode: string): string {
  return (REASONS[lang.slice(0, 2).toLowerCase()] ?? REASONS.fr)(postalCode);
}

// ── Le sens inverse : le CODE POSTAL se déduit de la VILLE ──────────────────
//
// Constaté en test (2026-09-22) : « au 1 rue de la République à Rosny sous
// bois » — le modèle retient la rue, puis demande le code postal. L'usager
// répond « Rosny sous bois ! », excédé : il l'a déjà dit. Et le modèle écrit
// alors « 93110 » de sa propre autorité — juste ici, faux ailleurs. Même
// règle que pour la ville : c'est le référentiel qui répond, jamais le modèle.

/**
 * Le nom d'une commune tel qu'on accepte de l'ENVOYER au référentiel : des
 * lettres, des espaces, des traits d'union, des apostrophes — jamais un chiffre.
 * ⚠️ C'est la barrière qui garantit qu'une adresse entière rangée par erreur
 * dans le champ ville (« 12 rue X, Rosny ») ne sort pas d'ici.
 */
const CITY_NAME = /^\p{L}[\p{L}\s'’.-]{0,59}$/u;

export function readCityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/\s+/g, " ");
  return CITY_NAME.test(clean) ? clean : null;
}

const MAX_CODES = 20;

export interface CommuneEntry {
  nom: string;
  codesPostaux: string[];
}

/** La réponse de `geo.api.gouv.fr/communes?nom=…&fields=nom,codesPostaux`, ramenée à l'essentiel. */
export function readCommuneEntries(raw: unknown): CommuneEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const entries: CommuneEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { nom, codesPostaux } = entry as Record<string, unknown>;
    if (typeof nom !== "string" || !Array.isArray(codesPostaux)) continue;
    const name = nom.trim().slice(0, 80);
    const codes = [...new Set(codesPostaux.map(readPostalCode).filter((c): c is string => c !== null))];
    if (name !== "" && codes.length > 0) entries.push({ nom: name, codesPostaux: codes.slice(0, MAX_CODES) });
  }
  return entries.slice(0, MAX_COMMUNES);
}

/** « Rosny sous bois », « ROSNY-SOUS-BOIS », « St-Denis » et « Saint-Denis » : la même graphie. */
function foldName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .trim();
}

/**
 * LA commune qui porte ce nom — exactement, sinon rien. « Rosny » seul ne
 * désigne aucune des communes rendues par la recherche, et deux communes
 * homonymes (Saint-Denis, 93 et 974) ne se départagent pas ici : on s'abstient,
 * et le code postal se demande.
 */
export function matchCommune(entries: CommuneEntry[], city: string): CommuneEntry | null {
  const wanted = foldName(city);
  const matches = entries.filter((entry) => foldName(entry.nom) === wanted);
  return matches.length === 1 ? matches[0] : null;
}

/** Ce que le prompt dit au modèle de ce que le référentiel a répondu pour une commune. */
export interface PostalHint {
  /** La commune telle que le référentiel la nomme. */
  commune: string;
  /** Le champ « code postal » concerné. */
  postalFieldId: string;
  codes: string[];
}

const POSTAL_REASONS: Record<string, (commune: string) => string> = {
  fr: (commune) => `D'après la commune ${commune}.`,
  en: (commune) => `From the commune ${commune}.`,
  es: (commune) => `Según el municipio ${commune}.`,
  de: (commune) => `Anhand der Gemeinde ${commune}.`,
};

export function postalReason(lang: string, commune: string): string {
  return (POSTAL_REASONS[lang.slice(0, 2).toLowerCase()] ?? POSTAL_REASONS.fr)(commune);
}
