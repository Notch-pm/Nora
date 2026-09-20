/**
 * Le RECUEIL d'un formulaire dans la conversation — règles pures, partagées par
 * le serveur (qui encadre le modèle) et par l'écran (qui avance sans lui).
 *
 * Le partage des rôles, décidé le 2026-09-20 :
 *
 *  • **Ce qui se dit** passe par la conversation : texte court, texte long,
 *    nombre, courriel, téléphone. L'usager écrit « c'est devant le 12 rue de la
 *    Paix, il y a des gravats », le modèle en tire les champs qu'il reconnaît —
 *    et le serveur n'en croit rien (`applyUpdates`).
 *  • **Ce qui se choisit ou se joint** passe par une CARTE insérée dans le fil,
 *    faite des contrôles du formulaire : listes, cases, dates, pièces jointes.
 *    Une valeur hors options n'existe pas ; un fichier ne transite pas par un
 *    modèle de langage. Une carte ne coûte aucun appel au guichet IA.
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
import type { Field, FormSchema } from "../domain/formSchema.ts";
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

/** Les types auxquels on répond en écrivant. Tout le reste est une carte. */
const CONVERSATION_TYPES: ReadonlySet<Field["type"]> = new Set([
  "text",
  "textarea",
  "number",
  "email",
  "phone",
]);

export function isConversationField(field: Field): boolean {
  return CONVERSATION_TYPES.has(field.type);
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
  value: string;
}

/** Les `field_updates` d'une réponse du modèle — forme seulement. */
export function readFieldUpdates(raw: unknown): FieldUpdate[] {
  if (!Array.isArray(raw)) return [];
  const updates: FieldUpdate[] = [];
  for (const entry of raw.slice(0, MAX_UPDATES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, value } = entry as Record<string, unknown>;
    if (typeof id !== "string") continue;
    // Un modèle rend parfois un nombre pour un champ numérique : on l'accepte.
    const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    if (typeof text !== "string" || text.trim() === "") continue;
    updates.push({ id, value: text.trim() });
  }
  return updates;
}

/**
 * Ce que le modèle dit avoir compris — et ce qu'on en retient.
 *
 * ⚠️ Une valeur n'entre que si : le champ est EN ATTENTE (le modèle ne réécrit
 * pas une réponse déjà donnée — une correction est un geste de l'usager, sur le
 * récapitulatif) ; c'est un champ auquel on répond en écrivant (jamais un choix,
 * jamais une pièce) ; et elle passe la validation du formulaire. Le reste tombe
 * en silence dans `rejected`, et le champ reste simplement à demander.
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
    if (field === undefined || !isConversationField(field) || update.value.length > MAX_TEXT_CHARS) {
      rejected.push(update.id);
      continue;
    }
    const trial = { ...current.values, [field.id]: update.value };
    if (validateForm(schema, trial)[field.id] !== undefined) {
      rejected.push(update.id);
      continue;
    }
    current = answerField(schema, current, field.id, update.value);
    accepted.push(field.id);
  }
  return { state: current, accepted, rejected };
}
