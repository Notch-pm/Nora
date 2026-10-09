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
import type {
  Demarche,
  DemarcheDetail,
  DemarcheOrganization,
  Ville,
} from "@fn/_shared/domain/demarche.ts";
import type { DemandeReceipt, DemandeSubmission } from "@fn/_shared/domain/demande.ts";
import type { PieceFailure, PieceReceipt } from "@fn/_shared/iris/pieceService.ts";
import type { PortalFailure } from "@fn/_shared/domain/failure.ts";
import { closedAssistant } from "@fn/_shared/domain/assistant.ts";
import type {
  AssistantChallenge,
  AssistantFailure,
  AssistantSuggestion,
  AssistantTurnReply,
  AssistantTurnRequest,
  SolvedChallenge,
} from "@fn/_shared/domain/assistantTurn.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import type { AccessibilityStatement } from "@fn/_shared/domain/accessibilite.ts";
import { emptyUserCommunication } from "@fn/_shared/domain/userCommunication.ts";
import {
  type CourrierDraft,
  type CourrierFailure,
  type CourrierReceipt,
  type FreeMail,
  parseFreeMail,
} from "@fn/_shared/domain/courrier.ts";
import type { ConsentAnswer } from "@fn/_shared/domain/consents.ts";

/** Ce que le portail sait de la collectivité visitée, en un seul chargement. */
export interface PortalSnapshot {
  /**
   * La langue RÉELLEMENT servie — pas forcément celle demandée. Le serveur
   * clampe sur ce que la collectivité a activé ; l'interface s'y aligne pour
   * que l'adresse dise ce qui est affiché.
   */
  lang: string;
  tenant: Tenant;
  /**
   * Les villes de la collectivité — les organismes qui ont une page, prêtes à
   * rendre (dédoublonnées, triées par nom).
   *
   * ⚠️ Elle voyage dans TOUS les instantanés parce que le menu « Ma ville »
   * vit dans l'en-tête, qui est sur tous les écrans : le calculer par écran
   * ferait un menu qui disparaît sur la page d'une démarche. Vide = pas de
   * menu (aucun organisme ne publie, ou serveur d'avant).
   */
  villes: Ville[];
  demarches: Demarche[];
  /** La page d'accueil composée par la collectivité ; `null` = jamais publiée. */
  page: HomePage | null;
  /** La charte graphique de la collectivité ; `null` = couleurs par défaut. */
  branding: Branding | null;
  /**
   * La charte de la COLLECTIVITÉ — celle de la marque de l'en-tête.
   *
   * ⚠️ Distincte de `branding`, qui est la charte à PEINDRE : sous le
   * périmètre d'un organisme, la page prend les couleurs et le logo de cet
   * organisme, mais le bandeau du haut continue de dire sur quel site on est.
   * Hors périmètre, les deux sont la même charte.
   */
  tenantBranding: Branding | null;
  /**
   * Le courrier libre de la COLLECTIVITÉ (`/courrier`). Fermé quand le
   * serveur n'en dit rien (serveur d'avant, Socle d'avant 1.38.0).
   */
  freeMail: FreeMail;
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
  "organisme_unavailable",
  "courrier_unavailable",
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

/**
 * La collectivité telle que le serveur la rend — commune aux trois lectures
 * (accueil, démarche, déclaration d'accessibilité).
 *
 * Un serveur d'avant l'assistant ne dit rien de lui : il est FERMÉ, et aucun
 * composant n'a de cas d'absence à porter.
 */
function readTenant(raw: unknown): Tenant | null {
  const served = raw as Tenant | undefined;
  if (!served || typeof served.id !== "string" || typeof served.name !== "string") return null;
  const assistant = served.assistant;
  return {
    ...served,
    assistant:
      typeof assistant === "object" && assistant !== null && assistant.enabled === true
        ? {
            enabled: true,
            depositEnabled: assistant.depositEnabled === true,
            voiceEnabled: assistant.voiceEnabled === true,
          }
        : closedAssistant(),
  };
}

function readSnapshot(body: unknown): PortalSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as {
    lang?: unknown;
    tenant?: unknown;
    villes?: unknown;
    demarches?: unknown;
    page?: unknown;
    branding?: unknown;
    tenantBranding?: unknown;
  };
  const tenant = readTenant(raw.tenant);
  if (tenant === null) return null;
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
  // Pas de villes servies (serveur d'avant le menu, ou collectivité sans
  // organisme qui publie) : une liste vide, et l'en-tête n'affiche pas le menu.
  const villes = Array.isArray(raw.villes) ? (raw.villes as Ville[]) : [];
  // Absente d'un serveur d'avant la marque : la charte peinte fait alors les
  // deux, comme avant.
  const tenantBranding =
    typeof raw.tenantBranding === "object" && raw.tenantBranding !== null
      ? (raw.tenantBranding as Branding)
      : branding;
  // Fermé au doute : seul `enabled === true` ouvre (voir `parseFreeMail`).
  const freeMail = parseFreeMail((body as { freeMail?: unknown }).freeMail);
  return { lang, tenant, villes, demarches, page, branding, tenantBranding, freeMail };
}

/** Ce que la page d'un organisme reçoit, en un seul aller-retour. */
export interface OrganismeSnapshot {
  /** La langue réellement servie — voir `PortalSnapshot.lang`. */
  lang: string;
  tenant: Tenant;
  /** Les villes de la collectivité — voir `PortalSnapshot.villes`. */
  villes: Ville[];
  /**
   * L'organisme visité. Jamais la collectivité elle-même : le serveur l'écarte,
   * puisque sa page est l'accueil du portail.
   */
  organisme: DemarcheOrganization;
  /** Les démarches de CET organisme, déjà filtrées par le serveur. */
  demarches: Demarche[];
  /** La charte de CET organisme, héritage déjà résolu ; `null` = défauts. */
  branding: Branding | null;
  /**
   * La charte de la COLLECTIVITÉ — celle de la marque de l'en-tête.
   *
   * ⚠️ Distincte de `branding`, qui est la charte à PEINDRE : sous le
   * périmètre d'un organisme, la page prend les couleurs et le logo de cet
   * organisme, mais le bandeau du haut continue de dire sur quel site on est.
   * Hors périmètre, les deux sont la même charte.
   */
  tenantBranding: Branding | null;
  /** Le courrier libre de CET organisme — fermé au doute. */
  freeMail: FreeMail;
}

export type OrganismeLoad =
  | { ok: true; snapshot: OrganismeSnapshot }
  | { ok: false; reason: PortalLoadFailure };

/**
 * ⚠️ Le tronc commun est lu par `readSnapshot` : la page d'un organisme est le
 * MÊME instantané que l'accueil, sans composition et avec un organisme nommé.
 * Le relire à part ferait deux tolérances à tenir d'accord (une liste
 * d'organismes absente, une langue non dite, une charte nulle) — et elles
 * finiraient par diverger.
 */
function readOrganismeSnapshot(body: unknown): OrganismeSnapshot | null {
  const base = readSnapshot(body);
  if (base === null) return null;
  const raw = (body as { organisme?: unknown }).organisme as DemarcheOrganization | undefined;
  // Sans organisme nommé, il n'y a pas de page : c'est une réponse d'accueil,
  // pas celle qu'on a demandée.
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  return {
    lang: base.lang,
    tenant: base.tenant,
    villes: base.villes,
    organisme: {
      id: raw.id,
      name: raw.name,
      slug: typeof raw.slug === "string" ? raw.slug : null,
      logoUrl: typeof raw.logoUrl === "string" ? raw.logoUrl : null,
    },
    demarches: base.demarches,
    branding: base.branding,
    tenantBranding: base.tenantBranding,
    freeMail: base.freeMail,
  };
}

/**
 * Charge la page d'un organisme : sa collectivité, ses démarches, sa charte.
 *
 * Le slug voyage en paramètre, jamais la collectivité — elle se déduit du
 * domaine visité, comme partout ailleurs. Un slug qui ne désigne personne qui
 * publie ici rend `organisme_unavailable`, le même refus qu'une démarche non
 * publiée : « pas ici », sans dire si quelque chose existe par ailleurs.
 */
export async function fetchOrganisme(slug: string, lang: string): Promise<OrganismeLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(
      baseUrl.replace(/\/+$/, "") +
        "/v1/bootstrap?lang=" +
        encodeURIComponent(lang) +
        "&organisme=" +
        encodeURIComponent(slug),
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };

  const snapshot = readOrganismeSnapshot(body);
  // Réponse 200 mais illisible : une indisponibilité, pas une page à moitié
  // rendue — même règle que l'accueil.
  if (snapshot === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, snapshot };
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
  /** Les villes de la collectivité — voir `PortalSnapshot.villes`. */
  villes: Ville[];
  /**
   * L'organisme sous lequel cette démarche est consultée, `null` hors de tout
   * périmètre. Le serveur ne le rend que s'il a vérifié que cet organisme
   * propose bien la démarche : l'écran peut s'y fier pour le nommer.
   */
  organisme: DemarcheOrganization | null;
  demarche: DemarcheDetail;
  /** La charte graphique ; `null` = couleurs par défaut. Jamais bloquante. */
  branding: Branding | null;
  /**
   * La charte de la COLLECTIVITÉ — celle de la marque de l'en-tête.
   *
   * ⚠️ Distincte de `branding`, qui est la charte à PEINDRE : sous le
   * périmètre d'un organisme, la page prend les couleurs et le logo de cet
   * organisme, mais le bandeau du haut continue de dire sur quel site on est.
   * Hors périmètre, les deux sont la même charte.
   */
  tenantBranding: Branding | null;
}

export type DemarcheLoad =
  | { ok: true; snapshot: DemarcheSnapshot }
  | { ok: false; reason: PortalLoadFailure };

function readDemarcheSnapshot(body: unknown): DemarcheSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as {
    lang?: unknown;
    tenant?: unknown;
    villes?: unknown;
    organisme?: unknown;
    demarche?: unknown;
    branding?: unknown;
    tenantBranding?: unknown;
  };
  const tenant = readTenant(raw.tenant);
  if (tenant === null) return null;
  const demarche = raw.demarche as DemarcheDetail | undefined;
  if (!demarche || typeof demarche.id !== "string" || typeof demarche.name !== "string") return null;
  const branding =
    typeof raw.branding === "object" && raw.branding !== null ? (raw.branding as Branding) : null;
  // Absent d'un serveur d'avant les pages d'organisme, et absent chaque fois
  // qu'on consulte une démarche hors périmètre : `null` est le cas courant.
  const organisme =
    typeof raw.organisme === "object" && raw.organisme !== null
      ? (raw.organisme as DemarcheOrganization)
      : null;
  // Le serveur a déjà traduit ET parsé les deux schémas : c'est le modèle du
  // portail qui arrive ici, pas du JSON du Socle. Le re-parser en ferait une
  // seconde vérité, qui divergerait au premier type de champ ajouté.
  const lang = typeof raw.lang === "string" && raw.lang !== "" ? raw.lang : "fr";
  const villes = Array.isArray(raw.villes) ? (raw.villes as Ville[]) : [];
  const tenantBranding =
    typeof raw.tenantBranding === "object" && raw.tenantBranding !== null
      ? (raw.tenantBranding as Branding)
      : branding;
  // Absent d'un `portal-api` d'avant le contrat 1.24.0 : l'interface (poussée
  // sur Cloudflare) et la fonction (déployée sur Supabase) ne partent pas
  // ensemble. Des blocs vides n'affichent rien — l'écran d'avant, exactement.
  const userCommunication =
    typeof demarche.userCommunication === "object" && demarche.userCommunication !== null
      ? demarche.userCommunication
      : emptyUserCommunication();
  return {
    lang,
    tenant,
    villes,
    organisme,
    demarche: { ...demarche, userCommunication },
    branding,
    tenantBranding,
  };
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
/** Le délai d'une lecture de démarche — au-dessus des 8 s du Socle, voir `fetchDemarche`. */
const DEMARCHE_TIMEOUT_MS = 12_000;

export async function fetchDemarche(
  demarcheId: string,
  lang: string,
  /**
   * L'organisme sous lequel la démarche est consultée, quand l'usager est
   * arrivé par sa page. Le serveur en tire deux choses : la charte à servir, et
   * la vérification que cet organisme propose bien cette démarche.
   */
  organisme: string | null = null,
): Promise<DemarcheLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(
      baseUrl.replace(/\/+$/, "") +
        "/v1/demarches/" +
        encodeURIComponent(demarcheId) +
        "?lang=" +
        encodeURIComponent(lang) +
        (organisme === null ? "" : "&organisme=" + encodeURIComponent(organisme)),
      // ⚠️ Un délai, sans quoi un appel qui PEND ne se termine jamais : l'écran
      // reste en « Chargement… » indéfiniment, sans erreur à montrer ni geste à
      // proposer. Au-dessus des 8 s que `portal-api` accorde au Socle, pour que
      // le serveur ait le temps de répondre « indisponible » lui-même — c'est
      // une meilleure information qu'un abandon côté navigateur.
      { signal: AbortSignal.timeout(DEMARCHE_TIMEOUT_MS) },
    );
  } catch {
    // Un abandon sur délai arrive ici comme une coupure réseau, et c'est bien
    // ce que c'est du point de vue de l'usager : rien n'est venu.
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };

  const snapshot = readDemarcheSnapshot(body);
  if (snapshot === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, snapshot };
}

/** La déclaration d'accessibilité et la collectivité qui l'a publiée, en un chargement. */
export interface AccessibiliteSnapshot {
  /** La langue réellement servie — voir `PortalSnapshot.lang`. */
  lang: string;
  tenant: Tenant;
  /** Les villes de la collectivité — voir `PortalSnapshot.villes`. */
  villes: Ville[];
  /**
   * La déclaration publiée, ou `null` : la collectivité ne l'a pas encore
   * publiée. Ce n'est pas une erreur, et l'écran le dit comme tel.
   */
  statement: AccessibilityStatement | null;
  /** La charte de la collectivité ; `null` = couleurs par défaut. */
  branding: Branding | null;
  tenantBranding: Branding | null;
}

export type AccessibiliteLoad =
  | { ok: true; snapshot: AccessibiliteSnapshot }
  | { ok: false; reason: PortalLoadFailure };

function readAccessibiliteSnapshot(body: unknown): AccessibiliteSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as {
    lang?: unknown;
    tenant?: unknown;
    villes?: unknown;
    statement?: unknown;
    branding?: unknown;
    tenantBranding?: unknown;
  };
  const tenant = readTenant(raw.tenant);
  if (tenant === null) return null;
  // Le serveur a déjà lu et vérifié la déclaration (`parseStatement`) : ici on
  // ne s'assure que de sa forme, sans en faire une seconde vérité.
  const statement =
    typeof raw.statement === "object" && raw.statement !== null &&
      typeof (raw.statement as AccessibilityStatement).body === "string"
      ? (raw.statement as AccessibilityStatement)
      : null;
  const branding =
    typeof raw.branding === "object" && raw.branding !== null ? (raw.branding as Branding) : null;
  const tenantBranding =
    typeof raw.tenantBranding === "object" && raw.tenantBranding !== null
      ? (raw.tenantBranding as Branding)
      : branding;
  const lang = typeof raw.lang === "string" && raw.lang !== "" ? raw.lang : "fr";
  const villes = Array.isArray(raw.villes) ? (raw.villes as Ville[]) : [];
  return { lang, tenant, villes, statement, branding, tenantBranding };
}

/**
 * Charge la déclaration d'accessibilité de la collectivité visitée — déduite
 * du domaine, comme partout ailleurs.
 */
export async function fetchAccessibilite(lang: string): Promise<AccessibiliteLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(
      baseUrl.replace(/\/+$/, "") + "/v1/accessibilite?lang=" + encodeURIComponent(lang),
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };

  const snapshot = readAccessibiliteSnapshot(body);
  if (snapshot === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, snapshot };
}

/** Les refus d'un dépôt de fichier, plus ceux que le serveur ne peut pas signaler. */
export type PieceUploadFailure = PieceFailure | "not_configured" | "network";

export type PieceUpload =
  | { ok: true; piece: PieceReceipt }
  | { ok: false; reason: PieceUploadFailure };

const KNOWN_PIECE_FAILURES: readonly PieceUploadFailure[] = [
  "piece_too_large",
  "piece_unsupported",
  "piece_rejected",
  "too_many_uploads",
  "iris_unavailable",
  "iris_misconfigured",
  "not_configured",
  "network",
];

/**
 * Dépose UN fichier, avant la demande. `portal-api` le remet à Iris, qui en
 * vérifie le contenu réel et le garde en attente vingt-quatre heures ; le
 * navigateur ne retient qu'un identifiant. `demarcheId` et `fieldId` disent à
 * quelle exigence le fichier répond — le serveur en revérifie les formats.
 */
export async function uploadPiece(
  file: File,
  context: { demarcheId: string; fieldId: string },
): Promise<PieceUpload> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("demarcheId", context.demarcheId);
  form.append("fieldId", context.fieldId);

  let response: Response;
  try {
    // Pas de Content-Type : le navigateur pose la frontière multipart lui-même.
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/demandes/pieces", {
      method: "POST",
      body: form,
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    return {
      ok: false,
      reason: KNOWN_PIECE_FAILURES.includes(code as PieceUploadFailure)
        ? (code as PieceUploadFailure)
        : "iris_unavailable",
    };
  }
  const piece = (body as { piece?: PieceReceipt } | null)?.piece;
  if (!piece || typeof piece.uploadId !== "string" || piece.uploadId === "") {
    return { ok: false, reason: "iris_unavailable" };
  }
  return { ok: true, piece };
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
 *
 * `challenge` est la preuve de travail résolue pour CETTE demande (voir
 * `fetchDepositChallenge` et `challengeToSolve` dans
 * `src/services/portal/depositChallenge.ts`) — absente ou omise, le serveur
 * dépose quand même tant qu'il ne l'exige pas (`depositGate.ts`, côté
 * fonctions).
 */
export async function sendDemande(
  submission: DemandeSubmission,
  challenge?: SolvedChallenge | null,
): Promise<DemandeSend> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/demandes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(challenge ? { ...submission, challenge } : submission),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // La preuve manque, ou est fausse : le même échec réessayable qu'un dépôt
    // qui rate pour de vrai — pas de nouveau `PortalFailure` pour ce cas (voir
    // la fiche de mission).
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    if (code === "challenge_required") return { ok: false, reason: "iris_unavailable" };
    return { ok: false, reason: readFailure(body) };
  }

  const receipt = (body as { receipt?: DemandeReceipt } | null)?.receipt;
  // Une demande partie sans référence lisible ne peut pas être annoncée comme
  // reçue : l'usager n'aurait aucun numéro à noter.
  if (!receipt || typeof receipt.reference !== "string" || receipt.reference === "") {
    return { ok: false, reason: "iris_unavailable" };
  }
  return { ok: true, receipt };
}

/**
 * Le défi anti-robot d'un DÉPÔT (`POST /v1/defi`) — à part de
 * `fetchAssistantChallenge` (`/v1/assistant/defi`, qui n'existe que si la
 * collectivité a ouvert l'assistant) : déposer par le formulaire classique
 * demande la même preuve, assistant ou pas (voir `depositGate.ts`, côté
 * fonctions).
 *
 * ⚠️ AUCUN ÉCHEC N'EST DISTINGUÉ : `404` (le portail n'a pas de secret de
 * signature — la porte n'existe pas), `429` (cadence), un réseau coupé, une
 * réponse illisible valent tous « pas de défi » — voir `challengeToSolve`
 * (`src/services/portal/depositChallenge.ts`), qui décide ce qu'on en fait.
 * Jamais un échec qui empêcherait de tenter le dépôt.
 */
export type DepositChallengeLoad = { ok: true; challenge: AssistantChallenge } | { ok: false };

export async function fetchDepositChallenge(): Promise<DepositChallengeLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false };

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/defi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    return { ok: false };
  }
  if (!response.ok) return { ok: false };

  const body = await response.json().catch(() => null);
  const challenge = readChallenge(body);
  return challenge === null ? { ok: false } : { ok: true, challenge };
}

// ── Le courrier libre ────────────────────────────────────────────────────────
//
// Deux appels : la page (`GET /v1/courrier`) et l'envoi (`POST /v1/courriers`).
// Comme partout, aucun ne nomme la collectivité : le domaine visité le dit.
// L'organisme voyage par son SLUG — celui de l'adresse —, absent pour la
// collectivité elle-même.

/** L'organisme auquel on écrit, tel que la page le nomme. */
export interface CourrierDestinataire {
  id: string;
  name: string;
  slug: string | null;
  /** La collectivité elle-même — sa page est l'accueil. */
  isTenant: boolean;
}

/** Ce que la page « Envoyer un courrier libre » reçoit, en un chargement. */
export interface CourrierSnapshot {
  /** La langue réellement servie — voir `PortalSnapshot.lang`. */
  lang: string;
  tenant: Tenant;
  villes: Ville[];
  organisme: CourrierDestinataire;
  /** Toujours ouvert ici : un organisme fermé rend `courrier_unavailable`. */
  freeMail: FreeMail;
  /** La charte de l'organisme (héritage résolu) — elle peint la page. */
  branding: Branding | null;
  /** La charte de la collectivité — la marque de l'en-tête. */
  tenantBranding: Branding | null;
}

export type CourrierLoad =
  | { ok: true; snapshot: CourrierSnapshot }
  | { ok: false; reason: PortalLoadFailure };

function readCourrierSnapshot(body: unknown): CourrierSnapshot | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  const tenant = readTenant(raw.tenant);
  if (tenant === null) return null;
  const org = raw.organisme as Partial<CourrierDestinataire> | undefined;
  if (!org || typeof org.id !== "string" || typeof org.name !== "string") return null;
  const freeMail = parseFreeMail(raw.freeMail);
  // Une page servie sans courrier ouvert n'a rien à proposer : c'est un refus.
  if (!freeMail.enabled) return null;
  const branding =
    typeof raw.branding === "object" && raw.branding !== null ? (raw.branding as Branding) : null;
  const tenantBranding =
    typeof raw.tenantBranding === "object" && raw.tenantBranding !== null
      ? (raw.tenantBranding as Branding)
      : branding;
  return {
    lang: typeof raw.lang === "string" && raw.lang !== "" ? raw.lang : "fr",
    tenant,
    villes: Array.isArray(raw.villes) ? (raw.villes as Ville[]) : [],
    organisme: {
      id: org.id,
      name: org.name,
      slug: typeof org.slug === "string" ? org.slug : null,
      isTenant: org.isTenant === true,
    },
    freeMail,
    branding,
    tenantBranding,
  };
}

/** Charge la page « Envoyer un courrier libre » d'un organisme (`null` = la collectivité). */
export async function fetchCourrier(organisme: string | null, lang: string): Promise<CourrierLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(
      baseUrl.replace(/\/+$/, "") +
        "/v1/courrier?lang=" +
        encodeURIComponent(lang) +
        (organisme === null ? "" : "&organisme=" + encodeURIComponent(organisme)),
    );
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readFailure(body) };
  const snapshot = readCourrierSnapshot(body);
  if (snapshot === null) return { ok: false, reason: "courrier_unavailable" };
  return { ok: true, snapshot };
}

/** Les refus d'un envoi de courrier, plus ceux que le serveur ne peut pas signaler. */
export type CourrierSendFailure = CourrierFailure | "not_configured" | "network";

export type CourrierSend =
  | { ok: true; receipt: CourrierReceipt }
  | { ok: false; reason: CourrierSendFailure };

const KNOWN_COURRIER_FAILURES: readonly CourrierFailure[] = [
  "invalid_courrier",
  "file_too_large",
  "file_unsupported",
  "challenge_required",
  "courrier_unavailable",
  "too_many_courriers",
  "courrier_not_configured",
  "courrier_undeliverable",
  "courrier_rejected",
  "clara_unavailable",
  "clara_misconfigured",
  "socle_unavailable",
];

/** Ce que l'écran remet à `sendCourrier` — le courrier, et ce qui l'accompagne. */
export interface CourrierEnvoiEcran {
  /** Le slug de l'adresse ; `null` = la collectivité. */
  organisme: string | null;
  /** Tiré UNE fois par l'écran : un rejeu rend le même courrier (`duplicate`). */
  submissionId: string;
  courrier: CourrierDraft;
  consents: ConsentAnswer[];
  files: readonly File[];
}

/**
 * Envoie un courrier libre. Les fichiers partent DANS cet envoi — pas avant,
 * comme les pièces d'une démarche : Clara n'a pas de zone d'attente.
 *
 * `challenge` est la preuve de travail résolue pour CE dépôt (même porte que
 * `sendDemande`) — absente, le serveur l'accepte tant qu'il ne l'exige pas.
 */
export async function sendCourrier(
  envoi: CourrierEnvoiEcran,
  challenge?: SolvedChallenge | null,
): Promise<CourrierSend> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  const form = new FormData();
  if (envoi.organisme !== null) form.append("organisme", envoi.organisme);
  form.append("submission_id", envoi.submissionId);
  form.append("subject", envoi.courrier.subject);
  form.append("body", envoi.courrier.body);
  form.append("sender_category", envoi.courrier.senderCategory);
  form.append("sender_civilite", envoi.courrier.senderCivilite);
  form.append("sender_first_name", envoi.courrier.senderFirstName);
  form.append("sender_last_name", envoi.courrier.senderLastName);
  form.append("sender_email", envoi.courrier.senderEmail);
  form.append("sender_phone", envoi.courrier.senderPhone);
  form.append("consents", JSON.stringify(envoi.consents));
  if (challenge) form.append("challenge", JSON.stringify(challenge));
  for (const file of envoi.files) form.append("files", file, file.name);

  let response: Response;
  try {
    // Pas de Content-Type : le navigateur pose la frontière multipart lui-même.
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/courriers", { method: "POST", body: form });
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
    return {
      ok: false,
      reason: KNOWN_COURRIER_FAILURES.includes(code as CourrierFailure)
        ? (code as CourrierFailure)
        : "clara_unavailable",
    };
  }
  const receipt = (body as { receipt?: Partial<CourrierReceipt> } | null)?.receipt;
  // Un envoi sans accusé lisible ne s'annonce pas comme reçu.
  if (!receipt || typeof receipt.organismeName !== "string") return { ok: false, reason: "clara_unavailable" };
  return {
    ok: true,
    receipt: {
      reference: typeof receipt.reference === "string" && receipt.reference !== "" ? receipt.reference : null,
      duplicate: receipt.duplicate === true,
      organismeName: receipt.organismeName,
    },
  };
}

// ── L'assistant conversationnel ──────────────────────────────────────────────
//
// Deux appels, tous deux `POST` : le défi qui ouvre une conversation, et un
// tour. Voir `@fn/_shared/domain/assistantTurn.ts` pour le contrat — écrit une
// fois côté serveur, lu ici. Comme le reste de ce fichier, aucun des deux ne
// dit à `portal-api` À QUELLE collectivité il parle : le domaine visité le dit
// déjà, par l'en-tête `Origin`.

/**
 * Échec d'un appel à l'assistant, plus ceux que le serveur ne peut pas
 * signaler — même motif que `PortalLoadFailure`. `"not_configured"` :
 * `VITE_PORTAL_API_URL` manque, un geste d'exploitation, pas un message pour
 * l'usager (voir `error.not_configured.*` côté dictionnaire).
 */
export type AssistantClientFailure = AssistantFailure | "not_configured" | "network";

const KNOWN_ASSISTANT_FAILURES: readonly AssistantFailure[] = [
  "assistant_closed",
  "assistant_not_configured",
  "assistant_unavailable",
  "assistant_quota_exceeded",
  "assistant_rate_limited",
  "challenge_required",
  "conversation_ended",
  "bad_request",
];

/**
 * Lit `{ error: { code, message, retryAfterSeconds? } }` — la forme commune
 * aux deux routes de l'assistant (`assistantFailure()` côté `portal-api`).
 * Un `code` inconnu (version d'avant, corps illisible) retombe sur
 * `assistant_unavailable` : jamais une chaîne arbitraire affichée telle quelle.
 */
function readAssistantFailure(
  body: unknown,
): { reason: AssistantClientFailure; retryAfterSeconds?: number } {
  const error = (body as { error?: { code?: unknown; retryAfterSeconds?: unknown } } | null)?.error;
  const reason = KNOWN_ASSISTANT_FAILURES.includes(error?.code as AssistantFailure)
    ? (error!.code as AssistantFailure)
    : "assistant_unavailable";
  const retryAfterSeconds =
    typeof error?.retryAfterSeconds === "number" &&
      Number.isFinite(error.retryAfterSeconds) &&
      error.retryAfterSeconds > 0
      ? error.retryAfterSeconds
      : undefined;
  return { reason, retryAfterSeconds };
}

export type AssistantChallengeLoad =
  | { ok: true; challenge: AssistantChallenge }
  | { ok: false; reason: AssistantClientFailure };

function readChallenge(body: unknown): AssistantChallenge | null {
  const challenge = (body as { challenge?: AssistantChallenge } | null)?.challenge;
  if (
    typeof challenge !== "object" || challenge === null ||
    typeof challenge.salt !== "string" || challenge.salt === "" ||
    typeof challenge.bits !== "number" ||
    typeof challenge.expires !== "number" ||
    typeof challenge.signature !== "string" || challenge.signature === ""
  ) {
    return null;
  }
  return challenge;
}

/**
 * Demande un défi (preuve de travail) — à résoudre dans le navigateur
 * (`solveChallenge`, `@fn/_shared/ai/challenge.ts`) avant le premier tour
 * d'une conversation. Corps vide : rien à envoyer, le serveur tire son propre
 * sel et le signe.
 */
export async function fetchAssistantChallenge(): Promise<AssistantChallengeLoad> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/assistant/defi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, reason: readAssistantFailure(body).reason };

  const challenge = readChallenge(body);
  // 200 mais illisible : une indisponibilité, comme partout ailleurs dans ce
  // fichier — jamais un défi à moitié lu qu'on tenterait quand même de résoudre.
  if (challenge === null) return { ok: false, reason: "assistant_unavailable" };
  return { ok: true, challenge };
}

export type AssistantTurnSend =
  | { ok: true; reply: AssistantTurnReply }
  | { ok: false; reason: AssistantClientFailure; retryAfterSeconds?: number };

/** L'offre de remplir, telle qu'elle arrive — forme seulement. */
function readCollectOffer(raw: unknown): { id: string; name: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, name } = raw as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || typeof name !== "string" || name === "") return null;
  return { id, name };
}

function readSuggestions(raw: unknown): AssistantSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const suggestions: AssistantSuggestion[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, description } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || typeof name !== "string" || name === "") continue;
    suggestions.push({ id, name, description: typeof description === "string" ? description : null });
  }
  return suggestions;
}

function readAssistantTurnReply(body: unknown): AssistantTurnReply | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as {
    ticket?: unknown;
    message?: { role?: unknown; content?: unknown; signature?: unknown };
    suggestions?: unknown;
    emergency?: unknown;
    turnsLeft?: unknown;
    asking?: unknown;
    collectOffer?: unknown;
  };
  if (typeof raw.ticket !== "string" || raw.ticket === "") return null;
  const message = raw.message;
  if (
    typeof message !== "object" || message === null ||
    message.role !== "assistant" ||
    typeof message.content !== "string" || message.content === "" ||
    typeof message.signature !== "string" || message.signature === ""
  ) {
    return null;
  }
  return {
    ticket: raw.ticket,
    message: { role: "assistant", content: message.content, signature: message.signature },
    suggestions: readSuggestions(raw.suggestions),
    emergency: raw.emergency === true,
    turnsLeft: typeof raw.turnsLeft === "number" && Number.isFinite(raw.turnsLeft) ? raw.turnsLeft : 0,
    collection: readCollection((body as { collection?: unknown }).collection),
    // Revalidés côté serveur ; ici on ne vérifie que la FORME, comme partout.
    asking: Array.isArray(raw.asking) ? raw.asking.filter((id): id is string => typeof id === "string") : [],
    collectOffer: readCollectOffer(raw.collectOffer),
    // Un `true` littéral, et seulement avec une offre : sans elle, rien à ouvrir.
    offerAccepted: (body as { offerAccepted?: unknown }).offerAccepted === true && readCollectOffer(raw.collectOffer) !== null,
  };
}

/**
 * Le recueil rendu par le serveur — forme seulement. Un serveur d'avant le
 * recueil n'en rend pas : `null`, et l'écran reste en mode « renseigner ».
 * L'écran repasse de toute façon cet état par `sanitizeState` contre le
 * formulaire qu'il a chargé, avant de s'en servir.
 */
function readCollection(raw: unknown): AssistantTurnReply["collection"] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { demarcheId, values, skipped } = raw as Record<string, unknown>;
  if (typeof demarcheId !== "string" || demarcheId === "") return null;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  return {
    demarcheId,
    values: values as Record<string, unknown>,
    skipped: Array.isArray(skipped) ? skipped.filter((id): id is string => typeof id === "string") : [],
  };
}

/**
 * Un tour de conversation. `request` porte soit un `challenge` résolu (premier
 * tour), soit un `ticket` (tours suivants) — voir `buildTurnRequest` dans
 * `src/features/assistant/conversation.ts`, qui construit ce corps.
 *
 * ⚠️ **Délai au-dessus de la chaîne fournisseur (55 s) < Socle (60 s) <
 * `portal-api` (75 s)** : sans lui, le navigateur abandonnerait avant que le
 * serveur ait fini de répondre, sur une conversation qui aurait pourtant
 * abouti.
 */
const ASSISTANT_TURN_TIMEOUT_MS = 90_000;

export async function sendAssistantTurn(request: AssistantTurnRequest): Promise<AssistantTurnSend> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(ASSISTANT_TURN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { reason, retryAfterSeconds } = readAssistantFailure(body);
    return { ok: false, reason, retryAfterSeconds };
  }

  const reply = readAssistantTurnReply(body);
  if (reply === null) return { ok: false, reason: "assistant_unavailable" };
  return { ok: true, reply };
}

// ── La voix (mode dialogue) ───────────────────────────────────────────────────
//
// ⚠️ Même chaîne de délais que la conversation : le navigateur attend plus
// longtemps que `portal-api`, qui attend plus longtemps que le Socle.

export type AssistantTranscription =
  | { ok: true; text: string }
  | { ok: false; reason: AssistantClientFailure; retryAfterSeconds?: number };

/**
 * Fait transcrire une prise de parole. `auth` : le ticket de la conversation,
 * ou — pour la toute première — le défi résolu qui l'ouvrira. L'enregistrement
 * part tel quel (WAV 16 kHz mono) et n'est gardé nulle part.
 */
export async function transcribeRecording(params: {
  wav: Blob;
  auth: { ticket: string } | { challenge: SolvedChallenge };
  lang: string;
}): Promise<AssistantTranscription> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  const form = new FormData();
  form.append("file", params.wav, "tour.wav");
  if ("ticket" in params.auth) form.append("ticket", params.auth.ticket);
  else form.append("challenge", JSON.stringify(params.auth.challenge));
  form.append("lang", params.lang);

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/assistant/transcription", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(ASSISTANT_TURN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const { reason, retryAfterSeconds } = readAssistantFailure(body);
    return { ok: false, reason, retryAfterSeconds };
  }
  const text = (body as { text?: unknown } | null)?.text;
  return typeof text === "string" ? { ok: true, text } : { ok: false, reason: "assistant_unavailable" };
}

export type AssistantSpeech =
  | { ok: true; audio: Blob }
  | { ok: false; reason: AssistantClientFailure; retryAfterSeconds?: number };

/**
 * La voix d'une réponse de l'assistant — la réponse TELLE QUE le serveur l'a
 * rendue, signature comprise : le serveur ne prononce rien d'autre.
 */
export async function fetchAssistantSpeech(params: {
  ticket: string;
  content: string;
  signature: string;
  lang: string;
}): Promise<AssistantSpeech> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return { ok: false, reason: "not_configured" };

  let response: Response;
  try {
    response = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/assistant/voix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(ASSISTANT_TURN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!response.ok) {
    const { reason, retryAfterSeconds } = readAssistantFailure(await response.json().catch(() => null));
    return { ok: false, reason, retryAfterSeconds };
  }
  if (!(response.headers.get("Content-Type") ?? "").startsWith("audio/")) {
    return { ok: false, reason: "assistant_unavailable" };
  }
  try {
    return { ok: true, audio: await response.blob() };
  } catch {
    return { ok: false, reason: "network" };
  }
}
