/**
 * Les règles du formulaire d'une démarche — pures, testées sans rendu.
 *
 * Les composants affichent ; ce qui est visible, ce qui est obligatoire, ce
 * qui est valide et ce qui part dans la demande se décide ici. C'est la partie
 * qu'on veut pouvoir relire sans lancer un navigateur, parce que s'y tromper
 * envoie à un agent une demande fausse plutôt qu'une page laide.
 *
 * Trois règles gouvernent tout le reste :
 *
 *  1. **Un champ masqué n'existe pas.** Il n'est ni affiché, ni validé, ni
 *     déposé. Une réponse à une question qu'on a cessé de poser n'est pas une
 *     réponse — la conserver ferait arriver dans la demande des données que
 *     l'usager croyait retirées.
 *  2. **On saisit par `id`, on dépose par `key`.** Les conditions du Socle
 *     s'évaluent sur l'identifiant du champ ; la demande, elle, est indexée
 *     par la clé machine, la seule que lise un agent.
 *  3. **Une pièce justificative est un fichier DÉJÀ déposé** (2026-09-08). Le
 *     fichier part dans Iris dès sa sélection (`portal-api /v1/demandes/pieces`,
 *     qui le vérifie et le garde en attente) ; le formulaire ne retient que
 *     son identifiant. Une pièce obligatoire est donc obligatoire comme n'importe
 *     quel champ, et le nombre de fichiers est borné par la démarche.
 */
import type { Condition, FormValues } from "./conditions.ts";
import { evaluateCondition } from "./conditions.ts";
import type { AttachmentRef } from "./demande.ts";
import type { Field, FormNode, FormSchema, Section } from "./formSchema.ts";
import { isSection } from "./formSchema.ts";
import type { RequesterField } from "./requesterConfig.ts";

/** Erreurs de saisie, indexées par `id` de champ (ou clé de champ requérant). */
/**
 * Une erreur de saisie : un CODE et ses paramètres, pas une phrase.
 *
 * ⚠️ Ce module est pur et le reste : il ne connaît ni la langue du visiteur, ni
 * le dictionnaire. C'est l'écran qui rend la phrase (`t(lang, e.key, e.params)`),
 * et les tests assertent sur des codes — plus robustes que sur de la prose.
 */
export interface FieldError {
  key:
    | "validation.required"
    | "validation.email"
    | "validation.number"
    | "validation.maxLength"
    | "validation.maxFiles";
  params?: Record<string, string | number>;
}

export type FieldErrors = Record<string, FieldError>;

const REQUIRED: FieldError = { key: "validation.required" };

/** Un fichier déposé dans Iris — ce que le formulaire retient d'une pièce. */
export interface UploadedPiece {
  uploadId: string;
  name: string;
  size: number;
}

/** La valeur d'un champ « pièce » : les fichiers déposés, ou rien. */
export function piecesOf(value: unknown): UploadedPiece[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is UploadedPiece =>
      typeof v === "object" && v !== null && typeof (v as UploadedPiece).uploadId === "string",
  );
}

/** Vrai si la valeur saisie ne dit rien : vide, blanche, ou aucun choix. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "boolean") return value === false;
  return false;
}

function visibleFieldsOf(fields: Field[], values: FormValues): Field[] {
  return fields.filter((field) => evaluateCondition(field.visibleIf, values));
}

/**
 * Les nœuds à rendre, dans l'ordre, conditions appliquées. Une section dont
 * tous les champs sont masqués disparaît avec eux : son titre n'annoncerait
 * plus rien.
 */
export function visibleNodes(schema: FormSchema, values: FormValues): FormNode[] {
  const nodes: FormNode[] = [];
  for (const node of schema.content) {
    if (!evaluateCondition(node.visibleIf, values)) continue;
    if (!isSection(node)) {
      nodes.push(node);
      continue;
    }
    const fields = visibleFieldsOf(node.fields, values);
    if (fields.length === 0) continue;
    nodes.push({ ...node, fields } satisfies Section);
  }
  return nodes;
}

/** Tous les champs effectivement affichés, sections aplaties. */
export function visibleFields(schema: FormSchema, values: FormValues): Field[] {
  const fields: Field[] = [];
  for (const node of visibleNodes(schema, values)) {
    if (isSection(node)) fields.push(...node.fields);
    else fields.push(node);
  }
  return fields;
}

/**
 * Un champ est-il obligatoire ici et maintenant ? Une pièce justificative l'est
 * par condition (`requiredIf`) autant que par drapeau ; les autres champs par
 * leur seul `required`.
 */
export function isFieldRequired(field: Field, values: FormValues): boolean {
  if (field.type === "attachment") {
    const byCondition = field.requiredIf !== undefined
      ? evaluateCondition(field.requiredIf as Condition, values)
      : false;
    return field.required === true || byCondition;
  }
  return field.required === true;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Une erreur pour ce champ, ou `null`. Le premier motif rencontré suffit. */
function fieldError(field: Field, values: FormValues): FieldError | null {
  const value = values[field.id];

  // Une pièce est un fichier déjà déposé : obligatoire comme un autre champ,
  // et jamais plus de fichiers que la démarche n'en demande.
  if (field.type === "attachment") {
    const pieces = piecesOf(value);
    if (pieces.length === 0) return isFieldRequired(field, values) ? REQUIRED : null;
    if (pieces.length > field.maxFiles) {
      return { key: "validation.maxFiles", params: { n: field.maxFiles } };
    }
    return null;
  }

  if (isBlank(value)) {
    return isFieldRequired(field, values) ? REQUIRED : null;
  }

  if (field.type === "email" && typeof value === "string" && !EMAIL_RE.test(value.trim())) {
    return { key: "validation.email" };
  }
  if (field.type === "number" && typeof value === "string" && !Number.isFinite(Number(value))) {
    return { key: "validation.number" };
  }
  if (
    typeof value === "string" &&
    "maxLength" in field &&
    typeof field.maxLength === "number" &&
    value.trim().length > field.maxLength
  ) {
    return { key: "validation.maxLength", params: { n: field.maxLength } };
  }
  return null;
}

/**
 * Les erreurs du formulaire, indexées par `id`. Seuls les champs VISIBLES sont
 * examinés : un champ masqué par une condition ne peut pas retenir l'envoi
 * d'une réponse que l'usager ne voit pas.
 */
export function validateForm(schema: FormSchema, values: FormValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of visibleFields(schema, values)) {
    const error = fieldError(field, values);
    if (error !== null) errors[field.id] = error;
  }
  return errors;
}

/**
 * Les pièces telles qu'elles partent dans la demande : l'identifiant de dépôt
 * de chaque fichier, rattaché à la clé machine de son champ — et seulement
 * pour les champs visibles (une pièce jointe à une question qu'on a cessé de
 * poser n'est pas une réponse). Le fichier lui-même est déjà chez Iris.
 */
export function toAttachments(schema: FormSchema, values: FormValues): AttachmentRef[] {
  const refs: AttachmentRef[] = [];
  for (const field of visibleFields(schema, values)) {
    if (field.type !== "attachment") continue;
    for (const piece of piecesOf(values[field.id])) {
      refs.push({ uploadId: piece.uploadId, fieldKey: field.key });
    }
  }
  return refs;
}

/**
 * Les réponses telles qu'elles partent dans la demande : indexées par la
 * **clé machine** des champs, et limitées aux champs visibles.
 *
 * Les pièces justificatives n'y figurent pas : elles voyagent à part
 * (`toAttachments`), et une clé vide vaudrait « répondu, mais rien ».
 */
export function toFormData(schema: FormSchema, values: FormValues): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of visibleFields(schema, values)) {
    if (field.type === "attachment") continue;
    const value = values[field.id];
    if (isBlank(value)) continue;
    if (field.type === "number" && typeof value === "string") {
      const parsed = Number(value);
      data[field.key] = Number.isFinite(parsed) ? parsed : value;
      continue;
    }
    data[field.key] = typeof value === "string" ? value.trim() : value;
  }
  return data;
}

/** Erreurs du bloc « Vos informations », indexées par clé de champ. */
export function validateRequester(
  fields: RequesterField[],
  values: Record<string, string>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of fields) {
    const value = values[field.key];
    if (isBlank(value)) {
      if (field.required) errors[field.key] = REQUIRED;
      continue;
    }
    if (field.key === "courriel" && !EMAIL_RE.test(value.trim())) {
      errors[field.key] = { key: "validation.email" };
    }
  }
  return errors;
}

/**
 * L'identité déclarée, prête pour la demande : les clés du paramétrage du
 * Socle, telles quelles — Iris les rapproche du référentiel sans traduction.
 * Les champs laissés vides ne sont pas envoyés : une chaîne vide écraserait
 * une information connue par un blanc.
 */
export function toRequester(
  contactType: string,
  fields: RequesterField[],
  values: Record<string, string>,
): Record<string, string> {
  const requester: Record<string, string> = { contact_type: contactType };
  for (const field of fields) {
    const value = values[field.key];
    if (typeof value !== "string" || value.trim() === "") continue;
    requester[field.key] = value.trim();
  }
  return requester;
}
