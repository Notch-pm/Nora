/**
 * Client HTTP du portail — le SEUL `fetch` de l'interface.
 *
 * ⚠️ Il n'appelle PAS le Socle. Il appelle `portal-api`, le backend du portail,
 * qui détient la clé du Socle et détermine le tenant à partir du domaine. Aucun
 * composant, aucun écran, aucun hook ne doit jamais joindre le Socle
 * directement : le navigateur n'a pas de clé, et n'a pas à en avoir.
 *
 * Remarquer ce que cette requête N'ENVOIE PAS : aucun identifiant de tenant,
 * aucun nom de domaine. Le serveur le déduit de l'en-tête `Origin`, que la page
 * ne peut pas réécrire. C'est ce qui rend inutile toute vérification côté
 * interface : il n'y a rien à falsifier.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { PortalFailure } from "@fn/_shared/domain/failure.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";

/** Ce que le portail sait de la collectivité visitée, en un seul chargement. */
export interface PortalSnapshot {
  tenant: Tenant;
  demarches: Demarche[];
}

/**
 * Les échecs du serveur, plus celui qu'il ne peut pas signaler : `network`,
 * quand la requête n'aboutit pas (hors ligne, DNS, CORS). Le serveur, par
 * définition, ne peut pas nous répondre qu'on ne l'a pas joint.
 */
export type PortalLoadFailure = PortalFailure | "network";

export type PortalLoad =
  | { ok: true; snapshot: PortalSnapshot }
  | { ok: false; reason: PortalLoadFailure };

/** Codes d'échec connus, pour ne pas faire confiance à une chaîne arbitraire. */
const KNOWN_FAILURES: readonly PortalLoadFailure[] = [
  "invalid_hostname",
  "unknown_domain",
  "tenant_unavailable",
  "socle_unavailable",
  "socle_misconfigured",
  "not_configured",
  "network",
];

function readFailure(body: unknown): PortalLoadFailure {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return KNOWN_FAILURES.includes(code as PortalLoadFailure)
    ? (code as PortalLoadFailure)
    : "socle_unavailable";
}

function readSnapshot(body: unknown): PortalSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as { tenant?: unknown; demarches?: unknown };
  const tenant = raw.tenant as Tenant | undefined;
  if (!tenant || typeof tenant.id !== "string" || typeof tenant.name !== "string") return null;
  if (!Array.isArray(raw.demarches)) return null;
  return { tenant, demarches: raw.demarches as Demarche[] };
}

/**
 * Charge la collectivité visitée et ses démarches.
 *
 * `VITE_PORTAL_API_URL` est la seule configuration de l'interface — et ce n'est
 * pas un secret : c'est l'adresse d'une API publique. Les secrets (URL et clé
 * du Socle) vivent dans l'edge function, hors du bundle.
 */
export async function fetchPortal(): Promise<PortalLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/bootstrap");
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };

  const snapshot = readSnapshot(body);
  // Réponse 200 mais illisible : traitée comme une indisponibilité, pas rendue
  // à moitié. Une page au nom vide ment plus qu'un message d'erreur.
  if (snapshot === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, snapshot };
}
