/**
 * Le jeton `autocomplete` de chaque champ d'identité (RGAA 11.13) — une table
 * PURE, testée, plutôt qu'un `field.key === "…"` dispersé dans le JSX de
 * `RequesterSection.tsx`.
 *
 * Les clés sont celles de `requesterConfig.ts` (`civilite`, `nom_usuel`…),
 * posées par le Socle — voir son en-tête : elles ne se traduisent jamais,
 * Iris et le référentiel les lisent telles quelles. Cette table n'invente
 * donc rien, elle ne fait qu'associer à chacune le jeton `autocomplete` que le
 * standard HTML lui connaît.
 *
 * ⚠️ `adresse` EST UN SEUL CHAMP ICI (une ligne, complétée par la Base Adresse
 * Nationale — `AddressInput.tsx`), donc `street-address` — la subdivision
 * (`address-line1` / `postal-code` / `address-level2` / `country-name`) ne
 * s'applique qu'à des champs séparés, qui n'existent pas dans ce paramétrage. `date_naissance` n'existe pas non plus aujourd'hui
 * (aucun public n'a ce champ) : l'entrée est posée par avance, sans risque —
 * une clé absente du paramétrage ne rend simplement rien.
 *
 * `raison_sociale` a le sien, `organization` — il figure dans la liste des
 * finalités que le RGAA 11.13 contrôle. `siret` n'en a aucun : il reste sans
 * `autocomplete`, ce qui n'est pas un défaut — un navigateur n'a simplement
 * rien à proposer pour lui.
 */
export const AUTOCOMPLETE_BY_KEY: Readonly<Record<string, string>> = {
  civilite: "honorific-prefix",
  prenoms: "given-name",
  nom_naissance: "family-name",
  nom_usuel: "family-name",
  courriel: "email",
  tel_portable: "mobile tel",
  tel_fixe: "home tel",
  adresse: "street-address",
  raison_sociale: "organization",
  date_naissance: "bday",
};

/** Le jeton `autocomplete` d'un champ, ou `undefined` — un attribut absent plutôt qu'un attribut vide. */
export function autocompleteFor(key: string): string | undefined {
  return AUTOCOMPLETE_BY_KEY[key];
}
