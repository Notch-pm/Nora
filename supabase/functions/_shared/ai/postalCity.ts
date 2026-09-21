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
