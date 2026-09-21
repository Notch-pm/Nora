/**
 * Le RECUEIL d'un formulaire dans la conversation — règles pures, partagées par
 * le serveur (qui encadre le modèle) et par l'écran (qui avance sans lui).
 *
 * Le partage des rôles, revu le 2026-09-21 :
 *
 *  • **Tout se dit**, sauf les pièces jointes. L'usager écrit « c'est devant le
 *    12 rue de la Paix, des gravats, jeudi » et le modèle en tire les champs
 *    qu'il reconnaît — y compris un choix, une date, un oui/non. Le serveur
 *    n'en croit rien : `coerceUpdate` ramène ce qu'il rend à une valeur du
 *    schéma PUBLIÉ, et `applyUpdates` la soumet encore à la validation.
 *  • **Une pièce jointe** reste une CARTE, faite des contrôles du formulaire :
 *    un fichier ne transite pas par un modèle de langage. Les champs à options
 *    et les dates gardent leur contrôle en repli (`assist`), pour l'usager qui
 *    préfère choisir que décrire — et une carte ne coûte aucun appel au guichet.
 *  • **L'identité du demandeur** n'est PAS ici : elle se saisit dans sa propre
 *    carte, à la fin, et n'est jamais montrée au modèle.
 *
 * ⚠️ **L'état du recueil vit dans le navigateur** (le serveur n'a pas de
 * mémoire) et n'est pas signé : il n'en a pas besoin. Il ne contient que ce que
 * l'usager pourrait taper dans le formulaire, et le dépôt — `POST /v1/demandes`,
 * inchangé — refiltre tout contre la démarche publiée. `sanitizeState` sert à ne
 * pas raisonner sur n'importe quoi, pas à se défendre.
 *
 * Les trois règles de `formulaire.ts` valent ici telles quelles : un champ
 * masqué n'existe pas ; on saisit par `id`, on dépose par `key` ; une pièce est
 * un fichier déjà déposé.
 */
import type { FormValues } from "../domain/conditions.ts";
import type { ChoiceField, Field, FormSchema } from "../domain/formSchema.ts";
import { allFields } from "../domain/formSchema.ts";
import { isBlank, isFieldRequired, piecesOf, validateForm, visibleFields } from "../domain/formulaire.ts";

/** Ce que le navigateur tient, et renvoie à chaque tour. */
export interface CollectionState {
  demarcheId: string;
  /** Réponses, indexées par `id` de champ — la forme exacte de `FormulairePage`. */
  values: FormValues;
  /** Champs FACULTATIFS que l'usager a choisi de passer. */
  skipped: string[];
}

/** On répond en écrivant à tout, sauf à une pièce jointe. */
export function isConversationField(field: Field): boolean {
  return field.type !== "attachment";
}

/**
 * Les types dont le CONTRÔLE aide, sans être imposé : choisir dans une liste ou
 * cliquer une date reste plus sûr que de les décrire. L'écran les offre en
 * repli sous la question, jamais à sa place.
 */
const ASSISTED_TYPES: ReadonlySet<Field["type"]> = new Set([
  "select",
  "radio",
  "checkboxes",
  "date",
  "boolean",
]);

export function isAssistedField(field: Field): boolean {
  return ASSISTED_TYPES.has(field.type);
}

const MAX_TEXT_CHARS = 5000;
const MAX_UPDATES = 20;

function isAnswered(field: Field, values: FormValues): boolean {
  if (field.type === "attachment") return piecesOf(values[field.id]).length > 0;
  return !isBlank(values[field.id]);
}

/** Une valeur du navigateur a-t-elle au moins la FORME de ce que ce champ accepte ? */
function plausible(field: Field, value: unknown): boolean {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean";
    case "select":
    case "radio":
      return typeof value === "string" && field.options.some((o) => o.value === value);
    case "checkboxes":
      return (
        Array.isArray(value) &&
        value.length <= field.options.length &&
        value.every((v) => typeof v === "string" && field.options.some((o) => o.value === v))
      );
    case "attachment":
      return Array.isArray(value) && value.length <= field.maxFiles && piecesOf(value).length === value.length;
    default:
      return typeof value === "string" && value.length <= MAX_TEXT_CHARS;
  }
}

/**
 * L'état tel qu'on accepte de raisonner dessus : des champs de CE formulaire,
 * des valeurs de la bonne forme, et rien sous un champ masqué. La purge boucle
 * parce que retirer une réponse peut en masquer une autre (conditions en chaîne).
 */
export function sanitizeState(schema: FormSchema, demarcheId: string, raw: unknown): CollectionState {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawValues =
    typeof source.values === "object" && source.values !== null && !Array.isArray(source.values)
      ? (source.values as Record<string, unknown>)
      : {};
  const fields = allFields(schema);

  let values: FormValues = {};
  for (const field of fields) {
    const value = rawValues[field.id];
    if (value !== undefined && plausible(field, value)) values[field.id] = value;
  }
  for (let pass = 0; pass <= fields.length; pass++) {
    const visible = new Set(visibleFields(schema, values).map((f) => f.id));
    const kept = Object.fromEntries(Object.entries(values).filter(([id]) => visible.has(id)));
    if (Object.keys(kept).length === Object.keys(values).length) break;
    values = kept;
  }

  const optional = new Set(
    visibleFields(schema, values).filter((f) => !isFieldRequired(f, values)).map((f) => f.id),
  );
  const skipped = Array.isArray(source.skipped)
    ? [...new Set(source.skipped.filter((id): id is string => typeof id === "string" && optional.has(id)))]
    : [];
  return { demarcheId, values, skipped };
}

/** Ce qu'il reste à demander, dans l'ordre du formulaire. */
export function pendingFields(schema: FormSchema, state: CollectionState): Field[] {
  return visibleFields(schema, state.values).filter(
    (field) => !isAnswered(field, state.values) && !state.skipped.includes(field.id),
  );
}

export interface CollectionView {
  /** Le prochain champ à renseigner — `null` quand il n'y en a plus. */
  pending: Field | null;
  /** `conversation` : l'usager répond en écrivant ; `card` : l'écran montre le contrôle. */
  mode: "conversation" | "card" | null;
  /** Le contrôle du formulaire mérite d'être offert EN PLUS de la question. */
  assist: boolean;
  remaining: number;
  /** Plus rien à demander ET le formulaire est valide : le récapitulatif peut s'afficher. */
  complete: boolean;
}

export function viewOf(schema: FormSchema, state: CollectionState): CollectionView {
  const pending = pendingFields(schema, state);
  const next = pending[0] ?? null;
  return {
    pending: next,
    mode: next === null ? null : isConversationField(next) ? "conversation" : "card",
    assist: next !== null && isAssistedField(next),
    remaining: pending.length,
    complete: pending.length === 0 && Object.keys(validateForm(schema, state.values)).length === 0,
  };
}

/** Passer un champ FACULTATIF. Un champ obligatoire ne se passe pas. */
export function skipField(schema: FormSchema, state: CollectionState, fieldId: string): CollectionState {
  const field = visibleFields(schema, state.values).find((f) => f.id === fieldId);
  if (field === undefined || isFieldRequired(field, state.values) || state.skipped.includes(fieldId)) {
    return state;
  }
  return { ...state, skipped: [...state.skipped, fieldId] };
}

/** Une réponse donnée par une CARTE (ou corrigée au récapitulatif) — sans modèle. */
export function answerField(
  schema: FormSchema,
  state: CollectionState,
  fieldId: string,
  value: unknown,
): CollectionState {
  const merged = { ...state.values, [fieldId]: value };
  // Repasser par `sanitizeState` purge ce qu'une nouvelle réponse vient de masquer.
  const next = sanitizeState(schema, state.demarcheId, { values: merged, skipped: state.skipped });
  return { ...next, skipped: next.skipped.filter((id) => id !== fieldId) };
}

export interface FieldUpdate {
  id: string;
  /** Un tableau ne vaut que pour des cases à cocher. */
  value: string | string[];
}

/** Une valeur simple rendue par le modèle, ramenée à du texte non vide. */
function readScalar(value: unknown): string | null {
  // Un modèle rend parfois un nombre pour un champ numérique, ou un booléen
  // pour un oui/non : les deux se lisent comme du texte.
  const text = typeof value === "number" && Number.isFinite(value) ? String(value)
    : typeof value === "boolean" ? String(value)
    : value;
  if (typeof text !== "string" || text.trim() === "") return null;
  return text.trim();
}

/** Les `field_updates` d'une réponse du modèle — forme seulement. */
export function readFieldUpdates(raw: unknown): FieldUpdate[] {
  if (!Array.isArray(raw)) return [];
  const updates: FieldUpdate[] = [];
  for (const entry of raw.slice(0, MAX_UPDATES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, value } = entry as Record<string, unknown>;
    if (typeof id !== "string") continue;
    if (Array.isArray(value)) {
      const items = value.map(readScalar).filter((item): item is string => item !== null);
      if (items.length > 0) updates.push({ id, value: items });
      continue;
    }
    const scalar = readScalar(value);
    if (scalar !== null) updates.push({ id, value: scalar });
  }
  return updates;
}

/** Comparer sans se soucier de la casse, des accents ni des espaces de bord. */
function fold(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * La valeur d'option qui correspond — par sa `value`, sinon par son LIBELLÉ.
 * Le modèle voit les deux et rend souvent le libellé ; ce qu'on retient reste
 * toujours une `value` lue dans le schéma publié.
 */
function optionValue(field: ChoiceField, raw: string): string | null {
  const wanted = fold(raw);
  const match = field.options.find((option) => fold(option.value) === wanted)
    ?? field.options.find((option) => fold(option.label) === wanted);
  return match?.value ?? null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YES: ReadonlySet<string> = new Set(["true", "oui", "yes"]);
const NO: ReadonlySet<string> = new Set(["false", "non", "no"]);

/** Un jour qui existe vraiment — `2026-02-31` n'en est pas un. */
function isRealDate(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

/**
 * Ce que le modèle a rendu, ramené à une valeur que CE champ accepte — ou
 * `null`, et il ne se passe rien.
 *
 * ⚠️ C'est la seule barrière pour un choix et pour une date : `validateForm` ne
 * vérifie ni les options ni le format d'un jour. Un modèle ne peut donc pas
 * inventer une option — la valeur retenue sort toujours du schéma publié.
 */
export function coerceUpdate(field: Field, raw: string | string[]): unknown | null {
  if (field.type === "attachment") return null;

  if (Array.isArray(raw)) {
    if (field.type !== "checkboxes") return null;
    const values: string[] = [];
    for (const entry of raw) {
      const value = optionValue(field, entry);
      // Une seule case inventée et on ne retient rien : mieux vaut reposer la
      // question que déposer une réponse à moitié comprise.
      if (value === null) return null;
      if (!values.includes(value)) values.push(value);
    }
    return values.length === 0 ? null : values;
  }

  switch (field.type) {
    case "select":
    case "radio":
      return optionValue(field, raw);
    case "checkboxes": {
      const value = optionValue(field, raw);
      return value === null ? null : [value];
    }
    case "boolean": {
      const folded = fold(raw);
      return YES.has(folded) ? true : NO.has(folded) ? false : null;
    }
    case "date":
      return ISO_DATE.test(raw) && isRealDate(raw) ? raw : null;
    case "number":
      return Number.isFinite(Number(raw)) ? raw : null;
    default:
      return raw.length > MAX_TEXT_CHARS ? null : raw;
  }
}

/**
 * Ce que le modèle dit avoir compris — et ce qu'on en retient.
 *
 * ⚠️ Une valeur n'entre que si : le champ est EN ATTENTE (le modèle ne réécrit
 * pas une réponse déjà donnée — une correction est un geste de l'usager, sur le
 * récapitulatif) ; `coerceUpdate` la reconnaît comme une valeur de CE champ
 * (jamais une pièce jointe) ; et elle passe la validation du formulaire. Le
 * reste tombe en silence dans `rejected`, et le champ reste simplement à
 * demander — l'usager a toujours son contrôle en repli sous la question.
 */
export function applyUpdates(
  schema: FormSchema,
  state: CollectionState,
  updates: FieldUpdate[],
): { state: CollectionState; accepted: string[]; rejected: string[] } {
  let current = state;
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const update of updates) {
    const field = pendingFields(schema, current).find((f) => f.id === update.id);
    const value = field === undefined ? null : coerceUpdate(field, update.value);
    if (field === undefined || value === null) {
      rejected.push(update.id);
      continue;
    }
    const trial = { ...current.values, [field.id]: value };
    if (validateForm(schema, trial)[field.id] !== undefined) {
      rejected.push(update.id);
      continue;
    }
    // ⚠️ `isBlank(false)` est VRAI : un « non » rangé tel quel laisserait le
    // champ en attente et la question reviendrait sans fin. Un « non » à une
    // question facultative est une réponse — on la note comme passée. À une
    // question obligatoire, `validateForm` l'a déjà écartée plus haut.
    current = value === false
      ? skipField(schema, current, field.id)
      : answerField(schema, current, field.id, value);
    accepted.push(field.id);
  }
  return { state: current, accepted, rejected };
}
