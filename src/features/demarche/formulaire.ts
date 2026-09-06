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
 *  3. **Les pièces justificatives ne bloquent jamais** tant que leur dépôt
 *     n'existe pas : elles sont affichées pour que l'usager sache ce qui lui
 *     sera demandé, et n'empêchent aucun envoi.
 */
import type { Condition, FormValues } from "@fn/_shared/domain/conditions.ts";
import { evaluateCondition } from "@fn/_shared/domain/conditions.ts";
import type { Field, FormNode, FormSchema, Section } from "@fn/_shared/domain/formSchema.ts";
import { isSection } from "@fn/_shared/domain/formSchema.ts";
import type { RequesterField } from "@fn/_shared/domain/requesterConfig.ts";

/** Erreurs de saisie, indexées par `id` de champ (ou clé de champ requérant). */
export type FieldErrors = Record<string, string>;

const REQUIRED_MESSAGE = "Cette information est obligatoire.";

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
function fieldError(field: Field, values: FormValues): string | null {
  const value = values[field.id];

  // Les pièces ne bloquent pas : leur dépôt n'existe pas encore, et refuser
  // l'envoi pour une pièce qu'on ne sait pas recevoir serait absurde.
  if (field.type === "attachment") return null;

  if (isBlank(value)) {
    return isFieldRequired(field, values) ? REQUIRED_MESSAGE : null;
  }

  if (field.type === "email" && typeof value === "string" && !EMAIL_RE.test(value.trim())) {
    return "Cette adresse électronique n'est pas valide.";
  }
  if (field.type === "number" && typeof value === "string" && !Number.isFinite(Number(value))) {
    return "Un nombre est attendu.";
  }
  if (
    typeof value === "string" &&
    "maxLength" in field &&
    typeof field.maxLength === "number" &&
    value.trim().length > field.maxLength
  ) {
    return field.maxLength + " caractères au maximum.";
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
 * Les réponses telles qu'elles partent dans la demande : indexées par la
 * **clé machine** des champs, et limitées aux champs visibles.
 *
 * Les pièces justificatives n'y figurent pas — il n'y a pas de fichier à
 * déposer, et une clé vide vaudrait « répondu, mais rien ».
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
      if (field.required) errors[field.key] = REQUIRED_MESSAGE;
      continue;
    }
    if (field.key === "courriel" && !EMAIL_RE.test(value.trim())) {
      errors[field.key] = "Cette adresse électronique n'est pas valide.";
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
