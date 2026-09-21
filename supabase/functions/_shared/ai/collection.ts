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
 *  • **Ce qui se choisit UNE FOIS** — `select`, `radio` — peut aussi être
 *    DÉDUIT depuis le 2026-09-21 : leurs libellés d'options voyagent au modèle,
 *    qui répond par un libellé, jamais par un code machine. Le serveur résout le
 *    libellé vers sa valeur (`resolveOption`) et `plausible` reste le dernier
 *    verrou : une option qui n'existe pas n'entre pas.
 *  • **Ce qui se coche, se date ou se joint** reste une CARTE : cases multiples,
 *    oui/non, date, pièce jointe. Une case se tape plus vite qu'elle ne se
 *    devine ; une date demande une horloge que le modèle n'a pas ; un fichier ne
 *    transite pas par un modèle de langage. Une carte ne coûte aucun appel IA.
 *  • **L'identité du demandeur** n'est PAS ici : elle se saisit dans sa propre
 *    carte, à la fin, et n'est jamais montrée au modèle.
 *
 * ⚠️ **Toute valeur posée par l'assistant porte son ORIGINE** (`FieldOrigin`),
 * et l'écran en fait un badge. La distinction « ce que vous avez dit » / « ce
 * que j'en ai déduit » est ce qui rend la relecture possible sans tout relire :
 * elle ne peut donc pas être décorative, elle voyage avec la valeur.
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

/**
 * D'où vient une valeur POSÉE PAR L'ASSISTANT.
 *
 *  • `extracted` — les mots de l'usager, repris tels quels. `source` porte la
 *    citation, et l'écran la rappelle sous le champ. ⚠️ Cet état se MÉRITE : le
 *    serveur vérifie que la citation figure vraiment dans ce que l'usager a
 *    écrit (`applyUpdates`), sans quoi elle retombe en `inferred`.
 *  • `inferred` — une interprétation : une catégorie choisie dans une liste, une
 *    adresse complétée. `reason` dit laquelle, et l'écran marque « à confirmer ».
 *    C'est le seul état qui demande un regard — et c'est le défaut au doute.
 *  • `generated` — une prose composée à partir de plusieurs messages (la
 *    description libre, « rédigé pour vous »). Réservée aux champs `textarea` :
 *    c'est le seul endroit où le modèle écrit du texte que l'usager signera.
 *
 * ⚠️ Une valeur saisie par l'USAGER n'a pas d'origine : l'absence d'entrée EST
 * l'information. C'est ce qui fait qu'un champ corrigé à la main perd son badge
 * sans qu'on ait à l'effacer nulle part.
 */
export type FieldOrigin = "extracted" | "inferred" | "generated";

export interface FieldOriginRecord {
  origin: FieldOrigin;
  /** La citation de l'usager, vérifiée — `extracted` seulement. */
  source?: string;
  /** La justification de la déduction — `inferred` seulement. */
  reason?: string;
}

/** Ce que le navigateur tient, et renvoie à chaque tour. */
export interface CollectionState {
  demarcheId: string;
  /** Réponses, indexées par `id` de champ — la forme exacte de `FormulairePage`. */
  values: FormValues;
  /** Champs FACULTATIFS que l'usager a choisi de passer. */
  skipped: string[];
  /** L'origine des valeurs posées par l'ASSISTANT. Celles de l'usager n'y sont pas. */
  origins: Record<string, FieldOriginRecord>;
  /**
   * Les champs que l'usager a renseignés ou corrigés LUI-MÊME — l'assistant ne
   * les réécrit plus jamais (premier des deux garde-fous).
   *
   * ⚠️ Un champ reste `touched` même VIDÉ : « corriger » le rouvre, et sans
   * cette mémoire le modèle se précipiterait pour le remplir à nouveau au tour
   * suivant — exactement ce que le geste de correction voulait empêcher.
   */
  touched: string[];
}

/** Les types auxquels on répond en écrivant. */
const CONVERSATION_TYPES: ReadonlySet<Field["type"]> = new Set([
  "text",
  "textarea",
  "number",
  "email",
  "phone",
]);

/**
 * Les types qu'une DÉDUCTION peut atteindre en plus : un choix unique. Leurs
 * options voyagent au modèle en LIBELLÉS (voir `prompt.ts`) — il ne voit ni
 * n'émet jamais un code machine, qu'il pourrait fabriquer d'allure crédible.
 */
const INFERABLE_CHOICE_TYPES: ReadonlySet<Field["type"]> = new Set(["select", "radio"]);

export function isConversationField(field: Field): boolean {
  return CONVERSATION_TYPES.has(field.type);
}

/** Un champ que le modèle a le droit de renseigner. Le reste passe par une carte. */
export function isModelWritable(field: Field): boolean {
  return isConversationField(field) || INFERABLE_CHOICE_TYPES.has(field.type);
}

/** Minuscules, sans accents, espaces réduits : de quoi rapprocher deux libellés. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Le libellé rendu par le modèle → la valeur de l'option. `null` si aucune
 * option ne correspond : le modèle a inventé, et le champ reste à demander.
 */
function resolveOption(field: Field, text: string): string | null {
  if (!("options" in field)) return null;
  const wanted = normalize(text);
  if (wanted === "") return null;
  const byLabel = field.options.find((option) => normalize(option.label) === wanted);
  if (byLabel !== undefined) return byLabel.value;
  // Repli : un modèle recopie parfois la valeur plutôt que le libellé.
  return field.options.find((option) => normalize(option.value) === wanted)?.value ?? null;
}

const MAX_TEXT_CHARS = 5000;
const MAX_UPDATES = 20;

/** Ce champ porte-t-il une réponse ? Exporté : la progression du co-pilote s'en sert. */
export function isAnswered(field: Field, values: FormValues): boolean {
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

  const visible = visibleFields(schema, values);
  const optional = new Set(visible.filter((f) => !isFieldRequired(f, values)).map((f) => f.id));
  const skipped = Array.isArray(source.skipped)
    ? [...new Set(source.skipped.filter((id): id is string => typeof id === "string" && optional.has(id)))]
    : [];

  // Une origine ne survit qu'attachée à une valeur : la valeur purgée, le badge
  // n'a plus rien à qualifier.
  const origins: Record<string, FieldOriginRecord> = {};
  if (typeof source.origins === "object" && source.origins !== null && !Array.isArray(source.origins)) {
    for (const [id, entry] of Object.entries(source.origins as Record<string, unknown>)) {
      if (!(id in values)) continue;
      const record = readOriginRecord(entry);
      if (record !== null) origins[id] = record;
    }
  }

  // ⚠️ `touched` se filtre sur les champs VISIBLES, pas sur ceux qui portent une
  // valeur : un champ vidé par « corriger » reste celui de l'usager.
  const visibleIds = new Set(visible.map((f) => f.id));
  const touched = Array.isArray(source.touched)
    ? [...new Set(source.touched.filter((id): id is string => typeof id === "string" && visibleIds.has(id)))]
    : [];

  return { demarcheId, values, skipped, origins, touched };
}

const ORIGINS: ReadonlySet<string> = new Set<FieldOrigin>(["extracted", "inferred", "generated"]);
const MAX_NOTE_CHARS = 300;

function note(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.trim().slice(0, MAX_NOTE_CHARS);
  return clean === "" ? undefined : clean;
}

/** Une origine rangée par le navigateur — forme seulement, `inferred` au doute. */
function readOriginRecord(raw: unknown): FieldOriginRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.origin !== "string" || !ORIGINS.has(entry.origin)) return null;
  const origin = entry.origin as FieldOrigin;
  return {
    origin,
    ...(origin === "extracted" ? { source: note(entry.source) } : {}),
    ...(origin === "inferred" ? { reason: note(entry.reason) } : {}),
  };
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

/**
 * Une réponse posée sur un champ.
 *
 * Sans `origin`, c'est l'USAGER qui répond — par une carte, par le formulaire,
 * ou en corrigeant au récapitulatif : le champ devient le sien (`touched`) et
 * perd son badge. Avec `origin`, c'est l'assistant, et seul `applyUpdates`
 * l'appelle ainsi.
 */
export function answerField(
  schema: FormSchema,
  state: CollectionState,
  fieldId: string,
  value: unknown,
  origin?: FieldOriginRecord,
): CollectionState {
  const merged = { ...state.values, [fieldId]: value };
  const origins = { ...state.origins };
  if (origin === undefined) delete origins[fieldId];
  else origins[fieldId] = origin;
  const touched =
    origin === undefined && !state.touched.includes(fieldId)
      ? [...state.touched, fieldId]
      : state.touched;
  // Repasser par `sanitizeState` purge ce qu'une nouvelle réponse vient de masquer.
  const next = sanitizeState(schema, state.demarcheId, { values: merged, skipped: state.skipped, origins, touched });
  return { ...next, skipped: next.skipped.filter((id) => id !== fieldId) };
}

export interface FieldUpdate {
  id: string;
  value: string;
  /** Ce que le modèle DIT de sa valeur. `applyUpdates` vérifie avant de le retenir. */
  origin: FieldOrigin;
  source?: string;
  reason?: string;
}

/**
 * Les `field_updates` d'une réponse du modèle — forme seulement.
 *
 * ⚠️ **`inferred` au doute.** Une origine absente, mal écrite ou inconnue ne
 * vaut pas « repris » : elle vaut « à confirmer ». Se tromper vers le badge
 * jaune fait relire une valeur juste ; se tromper vers le vert fait signer une
 * valeur inventée.
 */
export function readFieldUpdates(raw: unknown): FieldUpdate[] {
  if (!Array.isArray(raw)) return [];
  const updates: FieldUpdate[] = [];
  for (const entry of raw.slice(0, MAX_UPDATES)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, value, origin, source, reason } = entry as Record<string, unknown>;
    if (typeof id !== "string") continue;
    // Un modèle rend parfois un nombre pour un champ numérique : on l'accepte.
    const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
    if (typeof text !== "string" || text.trim() === "") continue;
    updates.push({
      id,
      value: text.trim(),
      origin: typeof origin === "string" && ORIGINS.has(origin) ? (origin as FieldOrigin) : "inferred",
      source: note(source),
      reason: note(reason),
    });
  }
  return updates;
}

/**
 * L'origine RETENUE — qui n'est pas forcément celle que le modèle annonce.
 *
 * « Repris » se MÉRITE : la citation doit figurer dans ce que l'usager a
 * réellement écrit. « Rédigé pour vous » ne vaut que pour un texte long. Tout
 * le reste retombe en « déduit », le seul état qui demande un regard.
 *
 * ⚠️ Un CHOIX n'est « repris » que si l'usager a prononcé le libellé lui-même.
 * Sinon c'est un rapprochement entre ses mots et notre liste — donc une
 * déduction, même quand le modèle jure le contraire. C'est tout le cas
 * « gravats » → « Dépôt sauvage » : le badge jaune est exactement ce qu'il faut.
 */
function originOf(field: Field, update: FieldUpdate, heard: string, value: string): FieldOriginRecord {
  if ("options" in field) {
    const label = field.options.find((option) => option.value === value)?.label ?? value;
    return heard.includes(normalize(label))
      ? { origin: "extracted", source: label }
      : { origin: "inferred", reason: update.reason };
  }
  if (update.origin === "extracted") {
    const quote = update.source;
    if (quote !== undefined && heard.includes(normalize(quote))) return { origin: "extracted", source: quote };
    return { origin: "inferred", reason: update.reason };
  }
  if (update.origin === "generated" && field.type === "textarea") return { origin: "generated" };
  return { origin: "inferred", reason: update.reason };
}

/**
 * Ce que le modèle dit avoir compris — et ce qu'on en retient.
 *
 * ⚠️ Une valeur n'entre que si TOUT est vrai : le champ est EN ATTENTE ; il
 * n'appartient pas déjà à l'usager (`touched` — premier garde-fou) ; le modèle
 * a le droit d'y écrire (`isModelWritable` : jamais une case, une date ou une
 * pièce) ; un choix se résout vers une option RÉELLE ; et la valeur passe la
 * validation du formulaire. Le reste tombe en silence dans `rejected`, et le
 * champ reste simplement à demander.
 */
export function applyUpdates(
  schema: FormSchema,
  state: CollectionState,
  updates: FieldUpdate[],
  /** Ce que l'usager a réellement écrit — c'est là que « repris » se vérifie. */
  said: string,
): { state: CollectionState; accepted: string[]; rejected: string[] } {
  let current = state;
  const accepted: string[] = [];
  const rejected: string[] = [];
  const heard = normalize(said);
  for (const update of updates) {
    const field = pendingFields(schema, current).find((f) => f.id === update.id);
    if (field === undefined || !isModelWritable(field) || current.touched.includes(update.id)) {
      rejected.push(update.id);
      continue;
    }
    // Un choix arrive en LIBELLÉ : il se résout vers sa valeur, ou il n'entre pas.
    const value = "options" in field ? resolveOption(field, update.value) : update.value;
    if (value === null || value.length > MAX_TEXT_CHARS) {
      rejected.push(update.id);
      continue;
    }
    const trial = { ...current.values, [field.id]: value };
    if (validateForm(schema, trial)[field.id] !== undefined) {
      rejected.push(update.id);
      continue;
    }
    current = answerField(schema, current, field.id, value, originOf(field, update, heard, value));
    accepted.push(field.id);
  }
  return { state: current, accepted, rejected };
}
