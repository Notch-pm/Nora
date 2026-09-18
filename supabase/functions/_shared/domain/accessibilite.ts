/**
 * La déclaration d'accessibilité — modèle du PORTAIL.
 *
 * La collectivité la rédige dans l'onglet « Contenus » de l'éditeur du Socle,
 * qui la publie avec le reste du site (`GET /v1/portal/content?slug=
 * accessibilite`, contrat 1.25.0). La mention du pied de page y mène quand
 * `theme.accessibility.declarationLink` est vrai.
 *
 * Défini ici plutôt que recopié du DTO du Socle, comme `Tenant` et `Demarche` :
 * `socle/accessibiliteService.ts` est le seul endroit qui connaisse la forme
 * de la réponse.
 *
 * Module PUR : pas de Deno, pas de réseau.
 */
export interface AccessibilityStatement {
  /**
   * Le texte, en **Markdown**, rédigé en français — il n'est pas traduit. Jamais
   * vide : une déclaration vide n'est pas publiée (le Socle répond 404).
   */
  body: string;
}

/** Au-delà, c'est une réponse abîmée — même borne que le Socle. */
const MAX_BODY_LENGTH = 50_000;

/**
 * La réponse du Socle, lue avec tolérance. Tout ce qui n'est pas un texte
 * Markdown non vide rend `null` : le portail dit alors que la déclaration n'est
 * pas publiée, il ne rend jamais une page blanche sous un titre engageant.
 */
export function parseStatement(value: unknown): AccessibilityStatement | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  // Un format inconnu ne se rend pas comme du Markdown : on ne sait pas le lire.
  if (raw.format !== undefined && raw.format !== "markdown") return null;
  const body = raw.body;
  if (typeof body !== "string" || body.trim() === "" || body.length > MAX_BODY_LENGTH) return null;
  return { body };
}
