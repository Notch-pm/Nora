/**
 * Ce que la collectivité demande au REQUÉRANT — publics admis et informations
 * à saisir.
 *
 * ⚠️ **Miroir volontaire** de `src/features/procedures/requesterFields.ts` du
 * Socle, qui possède le schéma (`procedures.requester_config`). Même motif que
 * `formSchema.ts` ; les tests des deux côtés l'épinglent.
 *
 * Les clés de champ (`courriel`, `nom_usuel`, `tel_portable`…) ne sont pas
 * décoratives : Iris les lit TELLES QUELLES pour rapprocher l'usager du
 * référentiel du Socle (`_shared/identity/declared.ts`, table `DECLARED_KEYS`).
 * Le portail n'a donc aucune correspondance à écrire — et ne doit surtout pas
 * en inventer une, qui deviendrait une troisième vérité.
 *
 * Défaut du Socle, repris ici : un public est **désactivé** et un champ est
 * **masqué** tant que la collectivité ne les a pas ouverts (minimisation des
 * données). Le portail ne demande donc jamais rien que la collectivité n'ait
 * demandé — quitte à ne rien demander du tout.
 */

/** Publics pouvant effectuer une démarche. */
export type Audience = "citoyen" | "entreprise" | "association";

/** État d'un champ demandé au requérant. */
export type FieldVisibility = "obligatoire" | "visible" | "masque";

export interface RequesterFieldDef {
  key: string;
  label: string;
}

const CITOYEN_FIELDS: RequesterFieldDef[] = [
  { key: "civilite", label: "Civilité" },
  { key: "nom_naissance", label: "Nom de naissance" },
  { key: "nom_usuel", label: "Nom usuel" },
  { key: "prenoms", label: "Prénom(s)" },
  { key: "adresse", label: "Adresse" },
  { key: "tel_portable", label: "Numéro de téléphone portable" },
  { key: "tel_fixe", label: "Numéro de téléphone fixe" },
  { key: "courriel", label: "Courriel" },
];

// Entreprises et associations partagent le même jeu de champs.
const ORGANISATION_FIELDS: RequesterFieldDef[] = [
  { key: "siret", label: "SIRET" },
  { key: "raison_sociale", label: "Raison sociale" },
  { key: "adresse", label: "Adresse" },
  { key: "tel_portable", label: "Numéro de téléphone portable" },
  { key: "tel_fixe", label: "Numéro de téléphone fixe" },
  { key: "courriel", label: "Courriel" },
];

/** Publics dans l'ordre d'affichage, avec leur libellé et leurs champs. */
export const AUDIENCES: { key: Audience; label: string; fields: RequesterFieldDef[] }[] = [
  { key: "citoyen", label: "En mon nom", fields: CITOYEN_FIELDS },
  { key: "entreprise", label: "Pour une entreprise", fields: ORGANISATION_FIELDS },
  { key: "association", label: "Pour une association", fields: ORGANISATION_FIELDS },
];

/**
 * Type de fiche usager, tel qu'Iris et le référentiel du Socle le nomment.
 * Le public `citoyen` du paramétrage y devient une `personne` : deux
 * vocabulaires pour la même chose, la traduction se fait ici, une fois.
 */
export const CONTACT_TYPES: Record<Audience, "personne" | "entreprise" | "association"> = {
  citoyen: "personne",
  entreprise: "entreprise",
  association: "association",
};

export interface AudienceConfig {
  enabled: boolean;
  fields: Record<string, FieldVisibility>;
}

export type RequesterConfig = Record<Audience, AudienceConfig>;

/** Un champ effectivement demandé à l'usager, dans l'ordre d'affichage. */
export interface RequesterField extends RequesterFieldDef {
  required: boolean;
}

const VISIBILITIES: readonly FieldVisibility[] = ["obligatoire", "visible", "masque"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toVisibility(value: unknown): FieldVisibility {
  return typeof value === "string" && VISIBILITIES.includes(value as FieldVisibility)
    ? (value as FieldVisibility)
    : "masque";
}

/**
 * Le paramétrage servi par le Socle, ramené à la forme que le portail lit.
 * Un bloc absent ou illisible vaut « public fermé, champs masqués » — le
 * défaut le moins bavard, comme au Socle.
 */
export function parseRequesterConfig(raw: unknown): RequesterConfig {
  const source = isRecord(raw) ? raw : {};
  const config = {} as RequesterConfig;
  for (const audience of AUDIENCES) {
    const block = isRecord(source[audience.key]) ? (source[audience.key] as Record<string, unknown>) : {};
    const fields: Record<string, FieldVisibility> = {};
    const declared = isRecord(block.fields) ? (block.fields as Record<string, unknown>) : {};
    for (const field of audience.fields) fields[field.key] = toVisibility(declared[field.key]);
    config[audience.key] = { enabled: block.enabled === true, fields };
  }
  return config;
}

/**
 * Les publics que la collectivité a ouverts, dans l'ordre d'affichage. Vide =
 * aucun : la démarche se dépose alors sans identité, et le portail le dit.
 * Il n'invente pas la question que la collectivité n'a pas posée.
 */
export function enabledAudiences(config: RequesterConfig): Audience[] {
  return AUDIENCES.filter((audience) => config[audience.key].enabled).map((audience) => audience.key);
}

/**
 * Les champs à demander pour un public : ceux qui ne sont pas masqués, dans
 * l'ordre du Socle, avec leur caractère obligatoire.
 */
export function requesterFieldsFor(config: RequesterConfig, audience: Audience): RequesterField[] {
  const definition = AUDIENCES.find((candidate) => candidate.key === audience);
  if (definition === undefined) return [];
  const visibilities = config[audience].fields;
  return definition.fields
    .filter((field) => visibilities[field.key] !== "masque")
    .map((field) => ({ ...field, required: visibilities[field.key] === "obligatoire" }));
}
