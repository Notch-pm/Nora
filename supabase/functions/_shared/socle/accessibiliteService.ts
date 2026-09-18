/**
 * La déclaration d'accessibilité publiée d'une collectivité, traduite dans le
 * modèle du portail.
 *
 * Même règle que la page d'accueil (`pageService.ts`) : **absence n'est pas
 * panne**. Un 404 signifie « rien de publié » — la collectivité existe, elle
 * n'a pas encore écrit sa déclaration — et l'écran le dit comme tel. Seules une
 * clé refusée ou un Socle injoignable sont des échecs.
 */
import { type AccessibilityStatement, parseStatement } from "../domain/accessibilite.ts";
import type { PortalFailure } from "../domain/failure.ts";
import type { SocleClient } from "./socleClient.ts";

/** Le slug du contenu au Socle — `ACCESSIBILITY_STATEMENT_SLUG` là-bas. */
const STATEMENT_SLUG = "accessibilite";

export type StatementResult =
  | { ok: true; statement: AccessibilityStatement | null }
  | { ok: false; reason: PortalFailure };

export async function getAccessibilityStatement(
  tenantId: string,
  socle: SocleClient,
): Promise<StatementResult> {
  const reply = await socle.get(
    "/v1/portal/content?tenant_id=" + encodeURIComponent(tenantId) + "&slug=" + STATEMENT_SLUG,
  );
  switch (reply.kind) {
    case "ok":
      // Une réponse illisible vaut « rien de publié » plutôt qu'une panne : la
      // page reste lisible, et elle ne prétend pas afficher une déclaration.
      return { ok: true, statement: parseStatement(reply.body) };
    case "not_found":
      return { ok: true, statement: null };
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "socle_unavailable" };
  }
}
