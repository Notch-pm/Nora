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
import type { Demarche, DemarcheDetail } from "@fn/_shared/domain/demarche.ts";
import type { DemandeReceipt, DemandeSubmission } from "@fn/_shared/domain/demande.ts";
import type { PortalFailure } from "@fn/_shared/domain/failure.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";

/** Ce que le portail sait de la collectivité visitée, en un seul chargement. */
export interface PortalSnapshot {
  /**
   * La langue RÉELLEMENT servie — pas forcément celle demandée. Le serveur
   * clampe sur ce que la collectivité a activé ; l'interface s'y aligne pour
   * que l'adresse dise ce qui est affiché.
   */
  lang: string;
  tenant: Tenant;
  demarches: Demarche[];
  /** La page d'accueil composée par la collectivité ; `null` = jamais publiée. */
  page: HomePage | null;
  /** La charte graphique de la collectivité ; `null` = couleurs par défaut. */
  branding: Branding | null;
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
  "demarche_unavailable",
  "submission_rejected",
  "iris_unavailable",
  "iris_misconfigured",
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
  const raw = body as {
    lang?: unknown;
    tenant?: unknown;
    demarches?: unknown;
    page?: unknown;
    branding?: unknown;
  };
  const tenant = raw.tenant as Tenant | undefined;
  if (!tenant || typeof tenant.id !== "string" || typeof tenant.name !== "string") return null;
  if (!Array.isArray(raw.demarches)) return null;
  // Une page absente (serveur d'avant, ou jamais publiée) vaut « pas de
  // composition » : le portail rend son défaut, il ne tombe pas en erreur.
  const page =
    typeof raw.page === "object" && raw.page !== null && Array.isArray((raw.page as HomePage).sections)
      ? (raw.page as HomePage)
      : null;
  const branding =
    typeof raw.branding === "object" && raw.branding !== null ? (raw.branding as Branding) : null;
  // Une démarche sans liste d'organismes (serveur d'avant) en reçoit une
  // vide : les composants itèrent dessus sans avoir à douter de sa présence.
  const demarches = (raw.demarches as Demarche[]).map((demarche) => ({
    ...demarche,
    organizations: Array.isArray(demarche.organizations) ? demarche.organizations : [],
  }));
  // Un serveur d'avant le multilingue ne dit pas la langue : c'est le français,
  // et tout s'affiche comme avant.
  const lang = typeof raw.lang === "string" && raw.lang !== "" ? raw.lang : "fr";
  return { lang, tenant, demarches, page, branding };
}

/**
 * Charge la collectivité visitée et ses démarches.
 *
 * `VITE_PORTAL_API_URL` est la seule configuration de l'interface — et ce n'est
 * pas un secret : c'est l'adresse d'une API publique. Les secrets (URL et clé
 * du Socle) vivent dans l'edge function, hors du bundle.
 */
export async function fetchPortal(lang: string): Promise<PortalLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(
      baseUrl.replace(/\/+$/, "") + "/v1/bootstrap?lang=" + encodeURIComponent(lang),
    );
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

/** Une démarche et la collectivité qui la propose, en un seul chargement. */
export interface DemarcheSnapshot {
  /** La langue réellement servie — voir `PortalSnapshot.lang`. */
  lang: string;
  tenant: Tenant;
  demarche: DemarcheDetail;
  /** La charte graphique ; `null` = couleurs par défaut. Jamais bloquante. */
  branding: Branding | null;
}

export type DemarcheLoad =
  | { ok: true; snapshot: DemarcheSnapshot }
  | { ok: false; reason: PortalLoadFailure };

function readDemarcheSnapshot(body: unknown): DemarcheSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as { lang?: unknown; tenant?: unknown; demarche?: unknown; branding?: unknown };
  const tenant = raw.tenant as Tenant | undefined;
  if (!tenant || typeof tenant.id !== "string" || typeof tenant.name !== "string") return null;
  const demarche = raw.demarche as DemarcheDetail | undefined;
  if (!demarche || typeof demarche.id !== "string" || typeof demarche.name !== "string") return null;
  const branding =
    typeof raw.branding === "object" && raw.branding !== null ? (raw.branding as Branding) : null;
  // Le serveur a déjà traduit ET parsé les deux schémas : c'est le modèle du
  // portail qui arrive ici, pas du JSON du Socle. Le re-parser en ferait une
  // seconde vérité, qui divergerait au premier type de champ ajouté.
  const lang = typeof raw.lang === "string" && raw.lang !== "" ? raw.lang : "fr";
  return { lang, tenant, demarche, branding };
}

/**
 * Charge une démarche publiée, avec de quoi l'afficher et la remplir.
 *
 * Comme pour le reste, la collectivité n'est pas envoyée : `portal-api` la
 * déduit du domaine visité. Un identifiant qui ne correspond à aucune démarche
 * PUBLIÉE de cette collectivité rend `demarche_unavailable` — le même échec
 * qu'un identifiant inventé, sans jamais révéler qu'une démarche existe mais
 * n'est pas ouverte.
 */
export async function fetchDemarche(demarcheId: string, lang: string): Promise<DemarcheLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(
      baseUrl.replace(/\/+$/, "") +
        "/v1/demarches/" +
        encodeURIComponent(demarcheId) +
        "?lang=" +
        encodeURIComponent(lang),
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };

  const snapshot = readDemarcheSnapshot(body);
  if (snapshot === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, snapshot };
}

export type DemandeSend =
  | { ok: true; receipt: DemandeReceipt }
  | { ok: false; reason: PortalLoadFailure };

/**
 * Dépose une demande. La clé d'Iris n'est pas ici et n'y sera jamais : c'est
 * `portal-api` qui la détient, revérifie que la démarche est publiée, et parle
 * au système de traitement.
 *
 * ⚠️ `submissionId` doit être TIRÉ UNE FOIS et conservé pendant les rejeux :
 * c'est lui qui rend un double envoi inoffensif. Le renvoyer après une coupure
 * réseau est le geste normal — Iris rend alors la demande déjà créée, et
 * l'usager voit le même accusé.
 */
export async function sendDemande(submission: DemandeSubmission): Promise<DemandeSend> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/demandes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };

  const receipt = (body as { receipt?: DemandeReceipt } | null)?.receipt;
  // Une demande partie sans référence lisible ne peut pas être annoncée comme
  // reçue : l'usager n'aurait aucun numéro à noter.
  if (!receipt || typeof receipt.reference !== "string" || receipt.reference === "") {
    return { ok: false, reason: "iris_unavailable" };
  }
  return { ok: true, receipt };
}
