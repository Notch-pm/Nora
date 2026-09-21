/**
 * Le RECUEIL d'un formulaire dans la conversation — règles pures, partagées par
 * le serveur (qui encadre le modèle) et par l'écran (qui avance sans lui).
 *
 * Le partage des rôles, revu le 2026-09-21 :
 *
 *  • **Tout se dit**, sauf une pièce jointe et sauf une DATE. L'usager écrit
 *    « c'est devant le 12 rue de la Paix, des gravats » et le modèle en tire
 *    les champs qu'il reconnaît — y compris un choix, un oui/non. Le serveur
 *    n'en croit rien : `coerceUpdate` ramène ce qu'il rend à une valeur du
 *    schéma PUBLIÉ, et `applyUpdates` la soumet encore à la validation.
 *  • **Une pièce jointe et une date** restent des CARTES, faites des contrôles
 *    du formulaire. Un fichier ne transite pas par un modèle de langage ; et
 *    une date demande une horloge que le modèle n'a pas — « jeudi » ne se
 *    résout pas sans savoir quel jour on est. Les champs à options gardent
 *    leur contrôle en repli (`assist`), pour qui préfère choisir que décrire,
 *    et une carte ne coûte aucun appel au guichet.
 *  • **L'identité du demandeur** n'est PAS ici : elle se saisit dans sa propre
 *    carte, à la fin, et n'est jamais montrée au modèle.
 *  • **Toute valeur posée par l'assistant porte son ORIGINE** (`FieldOrigin`) :
 *    « ce que vous avez dit » / « ce que j'en ai déduit ». C'est ce qui rend le
 *    récapitulatif relisable sans tout relire — et c'est le SERVEUR qui tranche,
 *    sur les mots réellement prononcés, jamais le modèle sur parole.
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

/**
 * D'où vient une valeur posée par l'ASSISTANT.
 *
 * ⚠️ **C'est ce qui rend un récapitulatif relisable.** Sans la différence entre
 * « ce que vous avez dit » et « ce que j'en ai déduit », l'usager doit tout
 * relire — ou ne relit rien, et signe. L'origine n'est donc pas décorative :
 * elle voyage avec la valeur.
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
   * les réécrit plus jamais.
   *
   * ⚠️ Un champ reste `touched` même VIDÉ : « corriger » le rouvre, et sans
   * cette mémoire le modèle se précipiterait pour le remplir à nouveau au tour
   * suivant — exactement ce que le geste de correction voulait empêcher.
   */
  touched: string[];
}

/**
 * On répond en écrivant à tout, sauf à une pièce jointe et sauf à une DATE.
 *
 * ⚠️ **Une date demande une horloge que le modèle n'a pas.** « Jeudi »,
 * « demain », « la semaine dernière » ne se résolvent pas sans savoir quel jour
 * on est — et un modèle qui devine une date se trompe d'une semaine sans que
 * rien ne le signale. Le calendrier du formulaire, lui, sait. C'est le seul
 * type où le contrôle est plus SÛR que la conversation, pas seulement plus
 * rapide.
 */
export function isConversationField(field: Field): boolean {
  return field.type !== "attachment" && field.type !== "date";
}

/**
 * Les types dont le CONTRÔLE aide, sans être imposé : choisir dans une liste se
 * clique plus vite que ça ne se décrit. L'écran les offre en repli sous la
 * question, jamais à sa place. (Une date n'est pas ici : elle n'est pas un
 * repli, elle est le seul chemin — voir `isConversationField`.)
 */
const ASSISTED_TYPES: ReadonlySet<Field["type"]> = new Set([
  "select",
  "radio",
  "checkboxes",
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

  // Une origine ne survit pas à la valeur qu'elle explique : un champ purgé,
  // ou repris par l'usager, perd son badge du même coup.
  const known = new Set(Object.keys(values));
  const rawOrigins =
    typeof source.origins === "object" && source.origins !== null && !Array.isArray(source.origins)
      ? (source.origins as Record<string, unknown>)
      : {};
  const origins: Record<string, FieldOriginRecord> = {};
  for (const [id, entry] of Object.entries(rawOrigins)) {
    if (!known.has(id)) continue;
    const record = readOriginRecord(entry);
    if (record !== null) origins[id] = record;
  }

  // `touched` survit à la purge d'une valeur : c'est tout son intérêt (un champ
  // vidé à la main ne doit pas être rerempli par le modèle au tour suivant).
  const ids = new Set(fields.map((f) => f.id));
  const touched = Array.isArray(source.touched)
    ? [...new Set(source.touched.filter((id): id is string => typeof id === "string" && ids.has(id)))]
    : [];

  return { demarcheId, values, skipped, origins, touched };
}

const ORIGINS: ReadonlySet<string> = new Set(["extracted", "inferred", "generated"]);

/** Une origine sans clé vide : `{origin, source: undefined}` n'aide personne à relire. */
function record(origin: FieldOrigin, source?: string, reason?: string): FieldOriginRecord {
  const made: FieldOriginRecord = { origin };
  if (source !== undefined) made.source = source;
  if (reason !== undefined) made.reason = reason;
  return made;
}

/** Une note du modèle, bornée — ou rien. */
function note(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.trim();
  return clean === "" ? undefined : clean.slice(0, 300);
}

/** Une origine venue du navigateur — `inferred` au doute, jamais `extracted`. */
function readOriginRecord(raw: unknown): FieldOriginRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { origin, source, reason } = raw as Record<string, unknown>;
  if (typeof origin !== "string" || !ORIGINS.has(origin)) return null;
  return record(origin as FieldOrigin, note(source), note(reason));
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
  /**
   * Les contrôles que l'écran DOIT montrer : les champs demandés auxquels on
   * ne peut pas répondre en parlant (une date, une pièce jointe).
   */
  controls: Field[];
  /**
   * Les contrôles offerts en REPLI : les champs à options demandés, pour qui
   * préfère cliquer que décrire. La conversation reste le chemin principal.
   */
  assists: Field[];
  remaining: number;
  /**
   * TOUT ce qu'il reste à renseigner, dans l'ordre du formulaire — de quoi
   * NOMMER ce qui manque, au lieu d'en annoncer le nombre.
   *
   * ⚠️ C'est l'écran qui les nomme, pas le modèle. Une liste de libellés ne
   * coûte aucun jeton, ne se trompe jamais et ne s'oublie pas ; la même chose
   * demandée au modèle allongerait chaque réponse (donc l'attente) sans que le
   * serveur puisse en vérifier l'exactitude.
   *
   * `remainingFields.length === remaining` : les deux sortent du même tableau,
   * et un test l'épingle pour qu'ils ne puissent pas diverger.
   */
  remainingFields: Field[];
  /**
   * Ce qu'il reste d'OBLIGATOIRE — sous-ensemble de `remainingFields`. C'est
   * lui qui décide de `complete` ; les facultatifs, non.
   */
  remainingRequired: Field[];
  /**
   * Le formulaire peut être envoyé : le récapitulatif s'affiche.
   *
   * ⚠️ **Les champs FACULTATIFS laissés vides ne l'empêchent pas.** Ils l'ont
   * empêché, et c'était un blocage : un facultatif que personne n'a jamais
   * évoqué — « BTQ », « complément d'adresse » — n'est ni répondu ni passé, donc
   * éternellement « en attente ». Le modèle, lui, jugeait le signalement
   * complet et cessait de demander quoi que ce soit ; l'écran, lui, n'ouvrait
   * jamais le récapitulatif. Résultat : une conversation finie, un formulaire
   * rempli, et AUCUN bouton pour l'envoyer.
   *
   * Personne ne demande « quel est votre indice de répétition ? » : attendre un
   * refus explicite sur chaque facultatif, c'était faire de « facultatif » un
   * synonyme de « obligatoire à décliner ». Un facultatif vide est une réponse
   * valide — c'est ce que `validateForm` dit déjà, et c'est ce que fait le
   * formulaire classique.
   *
   * `validateForm(...) === {}` suffit donc, et couvre tout : il rend une erreur
   * pour chaque champ obligatoire vide ET pour chaque valeur mal formée. Les
   * facultatifs restants ne disparaissent pas pour autant — ils restent dans
   * `remainingFields`, le modèle peut encore les proposer, et le récapitulatif
   * les montre avec leur « Modifier ».
   */
  complete: boolean;
}

/**
 * Ce qu'il y a à montrer, et ce qu'il reste à faire.
 *
 * ⚠️ `asking` est ce que le MODÈLE dit demander dans son dernier message —
 * c'est lui qui mène la conversation, donc lui qui décide de l'ordre. L'écran
 * ne peut plus se contenter du premier champ en attente : si le modèle parle
 * de la date alors que deux champs écrits la précèdent, c'est le calendrier
 * qu'il faut afficher, pas autre chose.
 *
 * ⚠️ Rien n'est cru sur parole : un identifiant inventé, déjà répondu ou
 * masqué tombe en silence, exactement comme un `field_update` rejeté. Le
 * modèle ne peut donc jamais faire apparaître un contrôle qui n'a pas lieu
 * d'être.
 *
 * ⚠️ REPLI : sans `asking` (premier tour, rechargement de page, modèle muet),
 * on ne montre un contrôle que si le prochain champ en attente ne se dit pas.
 * Afficher un contrôle pour un champ qui se raconte redonnerait à l'écran la
 * parole qu'on vient de lui retirer.
 */
export function viewOf(schema: FormSchema, state: CollectionState, asking?: readonly string[]): CollectionView {
  const pending = pendingFields(schema, state);
  const next = pending[0] ?? null;

  const wanted = asking === undefined
    ? []
    : pending.filter((field) => asking.includes(field.id));
  const shown = wanted.length > 0
    ? wanted
    : next !== null && !isConversationField(next)
      ? [next]
      : [];

  return {
    pending: next,
    mode: next === null ? null : isConversationField(next) ? "conversation" : "card",
    assist: next !== null && isAssistedField(next),
    controls: shown.filter((field) => !isConversationField(field)),
    assists: shown.filter((field) => isConversationField(field) && isAssistedField(field)),
    remaining: pending.length,
    remainingFields: pending,
    remainingRequired: pending.filter((field) => isFieldRequired(field, state.values)),
    complete: Object.keys(validateForm(schema, state.values)).length === 0,
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
 * Sans `origin`, elle vient de l'USAGER — carte, repli du formulaire, ou
 * correction au récapitulatif : le champ perd son badge et devient `touched`,
 * et l'assistant n'y reviendra plus. Avec `origin`, elle vient de l'assistant.
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
  const next = sanitizeState(schema, state.demarcheId, {
    values: merged,
    skipped: state.skipped,
    origins,
    touched,
  });
  return { ...next, skipped: next.skipped.filter((id) => id !== fieldId) };
}

export interface FieldUpdate {
  id: string;
  /**
   * L'usager a refusé ou ignoré ce champ FACULTATIF : on le passe.
   *
   * ⚠️ Sans cela, un facultatif décliné reste en attente pour toujours : le
   * modèle le redemanderait, `view.complete` n'arriverait jamais, et le
   * récapitulatif ne s'ouvrirait pas. C'est le modèle qui mène la
   * conversation — il lui faut donc un moyen de dire « celui-là, on le passe ».
   * `skipField` refuse déjà un champ obligatoire.
   */
  skip?: true;
  /** Un tableau ne vaut que pour des cases à cocher. Absent quand `skip`. */
  value: string | string[];
  /** Ce que le modèle DIT de sa valeur. `applyUpdates` vérifie avant de le retenir. */
  origin: FieldOrigin;
  source?: string;
  reason?: string;
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
    const claimed: FieldOrigin =
      typeof origin === "string" && ORIGINS.has(origin) ? (origin as FieldOrigin) : "inferred";
    const common = { id, origin: claimed, source: note(source), reason: note(reason) };
    // Passer un champ ne demande pas de valeur : c'est le geste inverse.
    if ((entry as Record<string, unknown>).skip === true) {
      updates.push({ ...common, skip: true, value: "" });
      continue;
    }
    if (Array.isArray(value)) {
      const items = value.map(readScalar).filter((item): item is string => item !== null);
      if (items.length > 0) updates.push({ ...common, value: items });
      continue;
    }
    const scalar = readScalar(value);
    if (scalar !== null) updates.push({ ...common, value: scalar });
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

/** Ce que la valeur retenue donne à LIRE, pour vérifier une citation. */
function spoken(field: Field, value: unknown): string {
  if ("options" in field) {
    const chosen = Array.isArray(value) ? value : [value];
    return chosen
      .map((v) => field.options.find((option) => option.value === v)?.label ?? String(v))
      .join(" ");
  }
  return typeof value === "boolean" ? "" : String(value);
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
 * « des gravats » → « Dépôt sauvage » : le badge « à confirmer » est exactement
 * ce qu'il faut.
 *
 * ⚠️ Un OUI/NON n'est jamais « repris » : la valeur retenue est un booléen, il
 * n'y a pas de mots de l'usager à citer. Toujours une lecture, donc une déduction.
 */
function originOf(field: Field, update: FieldUpdate, heard: string, value: unknown): FieldOriginRecord {
  const quoted = spoken(field, value);
  if ("options" in field) {
    return quoted !== "" && heard.includes(fold(quoted))
      ? record("extracted", quoted)
      : record("inferred", undefined, update.reason);
  }
  if (field.type === "boolean") return record("inferred", undefined, update.reason);
  if (update.origin === "extracted") {
    const quote = update.source;
    if (quote !== undefined && heard.includes(fold(quote))) return record("extracted", quote);
    return record("inferred", undefined, update.reason);
  }
  if (update.origin === "generated" && field.type === "textarea") return record("generated");
  return record("inferred", undefined, update.reason);
}

/**
 * Ce que le modèle dit avoir compris — et ce qu'on en retient.
 *
 * ⚠️ Une valeur n'entre que si TOUT est vrai : le champ est EN ATTENTE (le
 * modèle ne réécrit pas une réponse déjà donnée — une correction est un geste
 * de l'usager, sur le récapitulatif) ; il n'appartient pas déjà à l'usager
 * (`touched`) ; `coerceUpdate` la reconnaît comme une valeur de CE champ
 * (jamais une pièce jointe, jamais une date) ; et elle passe la validation du
 * formulaire. Le reste tombe en silence dans `rejected`, et le champ reste
 * simplement à demander — l'usager a toujours son contrôle en repli.
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
  const heard = fold(said);
  for (const update of updates) {
    const field = pendingFields(schema, current).find((f) => f.id === update.id);
    if (field === undefined || current.touched.includes(update.id)) {
      rejected.push(update.id);
      continue;
    }

    // Passer un facultatif. `skipField` refuse un obligatoire et rend l'état
    // inchangé : on le constate plutôt que de le redire ici.
    if (update.skip === true) {
      const next = skipField(schema, current, field.id);
      if (next === current) rejected.push(update.id);
      else {
        current = next;
        accepted.push(field.id);
      }
      continue;
    }

    const value = coerceUpdate(field, update.value);
    if (value === null) {
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
      : answerField(schema, current, field.id, value, originOf(field, update, heard, value));
    accepted.push(field.id);
  }
  return { state: current, accepted, rejected };
}
