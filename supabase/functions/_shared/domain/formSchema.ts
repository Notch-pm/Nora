/**
 * Le formulaire d'une démarche, tel que le portail le rend.
 *
 * ⚠️ **Miroir volontaire** de `src/features/procedures/formSchema.ts` du Socle,
 * qui POSSÈDE le schéma (`procedures.form_schema`, version 1) — même motif que
 * `portalCatalogue.ts` ↔ `catalogue.ts` chez lui. Les tests des deux côtés les
 * épinglent.
 *
 * Une différence assumée : le Socle valide avec zod et rejette un schéma
 * entier s'il est mal formé (à l'écriture, c'est ce qu'il faut). Ici le parse
 * est **tolérant nœud par nœud** — un champ qu'on ne sait pas rendre est
 * écarté, le reste du formulaire s'affiche. Même parti que pour les sections
 * de la page composée : on ne rend pas à moitié, mais on ne perd pas tout
 * pour un nœud. Le Socle peut apprendre un type de champ avant ce portail.
 *
 * Deux identifiants à ne jamais confondre :
 *   - **`key`** nomme la donnée en aval — c'est la clé de `form_data` déposé
 *     dans la demande, celle qu'un agent lit. Un champ sans `key` est écarté :
 *     sa réponse n'aurait pas de nom.
 *   - **`id`** désigne le champ dans le schéma, et ne sert qu'aux conditions.
 */
import type { Condition } from "./conditions.ts";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "email"
  | "phone"
  | "boolean"
  | "select"
  | "radio"
  | "checkboxes"
  | "attachment";

export const CHOICE_TYPES = ["select", "radio", "checkboxes"] as const;
export type ChoiceType = (typeof CHOICE_TYPES)[number];

const SIMPLE_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "email",
  "phone",
  "boolean",
] as const;
type SimpleType = (typeof SIMPLE_TYPES)[number];

export interface FieldOption {
  value: string;
  label: string;
}

interface FieldCommon {
  id: string;
  /** Clé machine — la donnée du contrat consommée en aval. */
  key: string;
  label: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  /** Affiché seulement si la condition est satisfaite. */
  visibleIf?: Condition;
}

export interface SimpleField extends FieldCommon {
  type: SimpleType;
  /** Longueur maximale (champs texte). */
  maxLength?: number;
}

export interface ChoiceField extends FieldCommon {
  type: ChoiceType;
  options: FieldOption[];
}

/** Nombre maximum de fichiers autorisés pour une pièce justificative. */
export const MAX_ATTACHMENT_FILES = 5;

export interface AttachmentField extends FieldCommon {
  type: "attachment";
  /** Référence vers un type du catalogue `document_types` du Socle. */
  documentTypeId?: string;
  /** 1 = un seul fichier ; 2..5 = plusieurs. */
  maxFiles: number;
  /** Formats acceptés, sans point (ex. `["pdf", "jpg"]`). */
  acceptedFormats: string[];
  /** Obligatoire si la condition est satisfaite, en plus du `required` statique. */
  requiredIf?: Condition;
}

export type Field = SimpleField | ChoiceField | AttachmentField;

export interface Section {
  id: string;
  kind: "section";
  title: string;
  description?: string;
  visibleIf?: Condition;
  fields: Field[];
}

/** Un nœud racine du formulaire : un champ isolé ou une section. */
export type FormNode = Field | Section;

export interface FormSchema {
  version: 1;
  content: FormNode[];
}

export function isSection(node: FormNode): node is Section {
  return "kind" in node && node.kind === "section";
}

export function isChoiceType(type: FieldType): type is ChoiceType {
  return (CHOICE_TYPES as readonly string[]).includes(type);
}

/** Tous les champs du formulaire, sections aplaties, dans l'ordre. */
export function allFields(schema: FormSchema): Field[] {
  const fields: Field[] = [];
  for (const node of schema.content) {
    if (isSection(node)) fields.push(...node.fields);
    else fields.push(node);
  }
  return fields;
}

// ---- Lecture tolérante -----------------------------------------------------

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Chaîne non vide, ou `null`. Les espaces de bord ne font pas un libellé. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalText(value: unknown): string | undefined {
  return text(value) ?? undefined;
}

function toCondition(raw: unknown): Condition | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.rules)) return undefined;
  const rules = raw.rules
    .filter(isRecord)
    .map((rule) => ({
      fieldId: text(rule.fieldId),
      operator: rule.operator,
      value: rule.value,
    }))
    .filter(
      (rule): rule is { fieldId: string; operator: unknown; value: unknown } =>
        rule.fieldId !== null,
    )
    .map((rule) => ({
      fieldId: rule.fieldId,
      operator: rule.operator as Condition["rules"][number]["operator"],
      value: rule.value as string | string[] | undefined,
    }));
  if (rules.length === 0) return undefined;
  return { combinator: raw.combinator === "or" ? "or" : "and", rules };
}

function toOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  const options: FieldOption[] = [];
  for (const candidate of raw) {
    if (!isRecord(candidate)) continue;
    // La valeur est ce qui part dans la demande ; le libellé peut retomber
    // dessus, l'inverse n'aurait aucun sens.
    const value = text(candidate.value);
    if (value === null) continue;
    options.push({ value, label: text(candidate.label) ?? value });
  }
  return options;
}

/** Un entier borné, pour `maxFiles`. Hors bornes = ramené dans les bornes. */
function toMaxFiles(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.min(MAX_ATTACHMENT_FILES, Math.max(1, Math.trunc(raw)));
}

function toFormats(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const formats: string[] = [];
  for (const candidate of raw) {
    const format = text(candidate);
    if (format === null) continue;
    const normalized = format.replace(/^\./, "").toLowerCase();
    if (normalized !== "" && !formats.includes(normalized)) formats.push(normalized);
  }
  return formats;
}

/**
 * Un champ, ou `null` s'il n'est pas rendable. Trois causes d'écart, toutes
 * définitives : pas d'`id` (rien pour l'adresser), pas de `key` (sa réponse
 * n'aurait pas de nom dans la demande), type inconnu de cette version.
 */
function toField(raw: unknown): Field | null {
  if (!isRecord(raw)) return null;
  const id = text(raw.id);
  const key = text(raw.key);
  const type = typeof raw.type === "string" ? raw.type : null;
  if (id === null || key === null || type === null) return null;

  const common = {
    id,
    key,
    // Un champ sans libellé reste rendable : mieux vaut sa clé qu'un trou.
    label: text(raw.label) ?? key,
    help: optionalText(raw.help),
    placeholder: optionalText(raw.placeholder),
    required: raw.required === true,
    visibleIf: toCondition(raw.visibleIf),
  };

  if (type === "attachment") {
    return {
      ...common,
      type: "attachment",
      documentTypeId: optionalText(raw.documentTypeId),
      maxFiles: toMaxFiles(raw.maxFiles),
      acceptedFormats: toFormats(raw.acceptedFormats),
      requiredIf: toCondition(raw.requiredIf),
    };
  }
  if ((CHOICE_TYPES as readonly string[]).includes(type)) {
    const options = toOptions(raw.options);
    // Une liste de choix sans choix ne pose pas de question : on l'écarte
    // plutôt que d'afficher un sélecteur vide que rien ne peut satisfaire.
    if (options.length === 0) return null;
    return { ...common, type: type as ChoiceType, options };
  }
  if ((SIMPLE_TYPES as readonly string[]).includes(type)) {
    const maxLength =
      typeof raw.maxLength === "number" && Number.isFinite(raw.maxLength) && raw.maxLength > 0
        ? Math.trunc(raw.maxLength)
        : undefined;
    return { ...common, type: type as SimpleType, maxLength };
  }
  return null;
}

function toSection(raw: Raw): Section | null {
  const id = text(raw.id);
  if (id === null) return null;
  const fields = Array.isArray(raw.fields)
    ? raw.fields.map(toField).filter((field): field is Field => field !== null)
    : [];
  // Une section vide n'encadre rien : elle n'ajouterait qu'un titre orphelin.
  if (fields.length === 0) return null;
  return {
    id,
    kind: "section",
    title: text(raw.title) ?? "",
    description: optionalText(raw.description),
    visibleIf: toCondition(raw.visibleIf),
    fields,
  };
}

/**
 * Le schéma servi par le Socle, ramené à ce que ce portail sait rendre.
 * `null` = pas de formulaire : une démarche sans saisie s'affiche quand même,
 * ce n'est pas une erreur.
 */
export function parseFormSchema(raw: unknown): FormSchema | null {
  if (!isRecord(raw) || !Array.isArray(raw.content)) return null;
  // Une version future n'est pas lisible par ce portail. La refuser
  // entièrement vaut mieux que d'en deviner la moitié.
  if (raw.version !== undefined && raw.version !== 1) return null;
  const content: FormNode[] = [];
  for (const node of raw.content) {
    if (!isRecord(node)) continue;
    const parsed = node.kind === "section" ? toSection(node) : toField(node);
    if (parsed !== null) content.push(parsed);
  }
  if (content.length === 0) return null;
  return { version: 1, content };
}
