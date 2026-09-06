/**
 * Moteur de conditions d'un formulaire de démarche — logique pure.
 *
 * ⚠️ **Miroir volontaire** de `src/features/procedures/conditions.ts` du Socle,
 * épinglé des deux côtés par leurs tests. Le Socle possède le schéma ; le
 * portail le rend. Une edge function ne peut rien importer de l'application
 * Socle, et un paquet partagé coûterait plus cher que deux fichiers d'accord.
 *
 * Un même modèle de condition sert trois usages : l'affichage d'un champ,
 * l'affichage d'une section, et le caractère obligatoire d'une pièce jointe.
 *
 * ⚠️ Les conditions s'évaluent sur l'**`id`** des champs, jamais sur leur
 * `key` : `key` nomme la donnée en aval (`form_data`), `id` désigne le champ
 * dans le schéma. Les confondre casserait tout formulaire dont un champ a été
 * renommé.
 */

export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "includes"
  | "isEmpty"
  | "isNotEmpty";

export interface ConditionRule {
  /** `id` du champ dont dépend la règle. */
  fieldId: string;
  operator: ConditionOperator;
  /** Valeur de comparaison (ignorée pour `isEmpty` / `isNotEmpty`). */
  value?: string | string[];
}

export interface Condition {
  combinator: "and" | "or";
  rules: ConditionRule[];
}

/** Valeurs saisies dans le formulaire, indexées par `id` de champ. */
export type FormValues = Record<string, unknown>;

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Réduit une valeur de comparaison (`string | string[]`) à un scalaire. */
function asScalar(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Égalité tolérante ; pour un champ multi-valeurs, vrai si `target` est sélectionné. */
function equals(fieldValue: unknown, target: string): boolean {
  if (Array.isArray(fieldValue)) return fieldValue.map(String).includes(target);
  if (fieldValue === undefined || fieldValue === null) return false;
  return String(fieldValue) === target;
}

function includes(fieldValue: unknown, target: string): boolean {
  if (Array.isArray(fieldValue)) return fieldValue.map(String).includes(target);
  if (typeof fieldValue === "string") return fieldValue.includes(target);
  return false;
}

/** Évalue une règle isolée contre les valeurs courantes. */
export function evaluateRule(rule: ConditionRule, values: FormValues): boolean {
  const fieldValue = values[rule.fieldId];
  switch (rule.operator) {
    case "isEmpty":
      return isEmpty(fieldValue);
    case "isNotEmpty":
      return !isEmpty(fieldValue);
    case "equals":
      return equals(fieldValue, asScalar(rule.value));
    case "notEquals":
      return !equals(fieldValue, asScalar(rule.value));
    case "includes":
      return includes(fieldValue, asScalar(rule.value));
    default:
      // Un opérateur que cette version ne connaît pas ne doit pas masquer un
      // champ : le Socle peut en apprendre un avant le portail.
      return false;
  }
}

/**
 * Évalue une condition complète. Une condition absente ou sans règle est
 * satisfaite : l'élément est affiché (ou reste facultatif). C'est le défaut
 * sûr — un champ qu'on n'a pas su décider reste visible.
 */
export function evaluateCondition(
  condition: Condition | undefined | null,
  values: FormValues,
): boolean {
  if (!condition || !Array.isArray(condition.rules) || condition.rules.length === 0) return true;
  return condition.combinator === "or"
    ? condition.rules.some((rule) => evaluateRule(rule, values))
    : condition.rules.every((rule) => evaluateRule(rule, values));
}
