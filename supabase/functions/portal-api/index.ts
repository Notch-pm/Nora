/**
 * portal-api — le backend du portail usagers. Une seule instance sert TOUTES
 * les collectivités.
 *
 * Son travail tient en quatre étapes : déterminer le domaine visité, demander
 * au Socle à qui il appartient, servir ce que cette collectivité publie, et
 * remettre à Iris les demandes que les usagers déposent. Il ne connaît aucune
 * collectivité, n'en stocke aucune, et n'a pas de base de données. Ajouter
 * `angers.edilumen.fr` ne demande aucun déploiement — une ligne dans les
 * domaines du Socle suffit.
 *
 * Les deux clés — celle du Socle, celle d'Iris — vivent ICI, en secrets d'edge
 * function, et ne traversent jamais un navigateur. C'est la raison d'être de
 * cette fonction : sans elle, le portail serait une page statique, incapable
 * d'interroger un référentiel authentifié et incapable de déposer une demande
 * sans donner à ses visiteurs le droit d'en déposer n'importe laquelle.
 *
 * Déployée avec `verify_jwt = false` : le portail est public par nature, il n'y
 * a pas d'usager connecté à ce stade.
 *
 * Ce fichier ne contient QUE de la plomberie HTTP. Les règles sont dans
 * `_shared/` — c'est ce qui les rend testables sans lancer Deno.
 */
import { getPublicDemarche, getPublicDemarches } from "../_shared/socle/demarcheService.ts";
import { getPublishedPage } from "../_shared/socle/pageService.ts";
import { getBranding } from "../_shared/socle/brandingService.ts";
import { getAccessibilityStatement } from "../_shared/socle/accessibiliteService.ts";
import { resolveTenant } from "../_shared/socle/tenantService.ts";
import { createSocleClient } from "../_shared/socle/socleClient.ts";
import { withCache } from "../_shared/socle/cachedSocleClient.ts";
import { createAudienceClient } from "../_shared/socle/audienceClient.ts";
import { createIrisClient } from "../_shared/iris/irisClient.ts";
import { submitDemande } from "../_shared/iris/demandeService.ts";
import { httpStatusForPieceFailure, uploadPiece } from "../_shared/iris/pieceService.ts";
import { hostnameForRequest } from "../_shared/http/requestHostname.ts";
import { clientAddress, createRateLimiter, hashKey } from "../_shared/http/rateLimit.ts";
import { allFields } from "../_shared/domain/formSchema.ts";
import { AUDIENCES } from "../_shared/domain/requesterConfig.ts";
import {
  demarchesOfOrganization,
  type DemarcheOrganization,
  organizationBySlug,
  villesOf,
} from "../_shared/domain/demarche.ts";
import type { AttachmentRef } from "../_shared/domain/demande.ts";
import type { Tenant } from "../_shared/domain/tenant.ts";
import { resolveLang } from "../_shared/domain/languages.ts";
import { deviceClass, isBot, parseAudienceBeacon } from "../_shared/domain/audience.ts";
import { httpStatusForFailure, type PortalFailure } from "../_shared/domain/failure.ts";
import {
  type AssistantFailure,
  httpStatusForAssistantFailure,
} from "../_shared/domain/assistantTurn.ts";
import { clampBits, issueChallenge } from "../_shared/ai/challenge.ts";
import { checkDepositChallenge } from "../_shared/ai/depositGate.ts";
import { createSocleAiClient } from "../_shared/ai/socleAi.ts";
import { runAssistantTurn } from "../_shared/ai/turn.ts";

/**
 * CORS ouvert, et c'est délibéré : cette API sert des données **publiques**,
 * sans cookie ni jeton de session, à un ensemble de domaines qui change chaque
 * fois qu'une collectivité rejoint la gamme. Une liste blanche devrait être
 * tenue au rythme du référentiel — c'est-à-dire exactement le couplage que ce
 * portail existe pour supprimer. Le contrôle d'accès n'est pas ici : il est
 * dans ce que le Socle accepte de publier, et dans le fait que le dépôt ne
 * peut viser qu'une démarche publiée de la collectivité du domaine visité.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

/** Durée de vie du cache mémoire, en secondes. `0` le désactive. */
const DEFAULT_CACHE_TTL_SECONDS = 60;

/**
 * Code de la source enregistrée chez Iris. Le portail est une source parmi
 * d'autres — configurable, parce que c'est un identifiant de provisioning et
 * non une règle : une plateforme peut enregistrer sa source sous un autre nom.
 */
const DEFAULT_SOURCE_SYSTEM = "portail-citoyen";

/** Bornes d'une enveloppe de dépôt, alignées sur ce qu'Iris accepte. */
const MAX_SUBMISSION_ID = 200;
const MAX_ATTACHMENTS = 50;
const MAX_UPLOAD_ID = 64;

/**
 * Une pièce déposée depuis le portail : 10 Mo. Iris en accepte 25 ; on garde
 * la marge pour un usager sur mobile — et parce qu'un justificatif de 10 Mo
 * est déjà une photo mal compressée.
 */
const MAX_PIECE_BYTES = 10 * 1_048_576;
/** Marge d'enrobage multipart tolérée sur `Content-Length` avant lecture. */
const MULTIPART_ALLOWANCE = 64 * 1024;

/**
 * Frein de confort contre un script maladroit — EN MÉMOIRE D'ISOLAT, donc ni
 * partagé ni durable (Nora n'a pas de base). La borne opposable est chez Iris :
 * 60 dépôts par minute et par clé, pour toute la collectivité.
 */
const pieceLimiter = createRateLimiter({ windowMs: 60_000, max: 20 });

/**
 * Frein de la mesure d'audience — même nature que celui des pièces, seuil bien
 * plus large : une navigation normale produit une poignée de pages vues par
 * minute, mais plusieurs visiteurs partagent souvent une adresse (un réseau
 * d'entreprise, une mairie, un opérateur mobile). 120 par minute laisse
 * largement passer un guichet entier et coupe une boucle.
 *
 * ⚠️ C'EST LE SEUL ENDROIT DE LA CHAÎNE OÙ L'ADRESSE IP EXISTE, et elle n'y
 * existe que hachée, en mémoire, le temps d'une fenêtre. Le Socle ne la voit
 * jamais : ses tables de compteurs n'ont aucune colonne capable de la porter.
 * Freiner plus loin — chez lui — demanderait de la lui transmettre, donc de
 * défaire la seule promesse qui dispense d'un bandeau de consentement.
 */
const audienceLimiter = createRateLimiter({ windowMs: 60_000, max: 120 });

/**
 * Frein de l'assistant — même nature que les deux autres (mémoire d'isolat),
 * large pour la même raison que celui de l'audience : une médiathèque entière
 * sort par une seule adresse. Il coupe une boucle, rien de plus. Les bornes qui
 * COMPTENT sont ailleurs, et opposables : la preuve de travail pour ouvrir, le
 * ticket signé (tours, durée), puis au Socle la cadence par conversation et le
 * plafond de la collectivité.
 */
const assistantLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

/**
 * Messages de l'assistant adressés au visiteur — l'écran les traduit par CODE,
 * ceci n'est que le repli en français. Aucun ne ferme une porte : le formulaire
 * de chaque démarche reste le chemin garanti.
 */
const ASSISTANT_MESSAGES: Record<AssistantFailure, string> = {
  assistant_closed: "L'assistant n'est pas proposé sur ce site.",
  assistant_not_configured: "L'assistant est momentanément indisponible.",
  assistant_unavailable: "L'assistant est momentanément indisponible. Merci de réessayer dans quelques instants.",
  assistant_quota_exceeded: "L'assistant n'est plus disponible pour le moment. Les démarches restent accessibles.",
  assistant_rate_limited: "L'assistant reçoit beaucoup de questions. Merci de patienter quelques secondes.",
  challenge_required: "La conversation doit être rouverte.",
  conversation_ended: "Cette conversation est arrivée à son terme. Vous pouvez en ouvrir une nouvelle.",
  bad_request: "Ce message n'a pas pu être lu.",
};

function assistantFailure(reason: AssistantFailure, retryAfterSeconds?: number): Response {
  // Le délai d'attente voyage DANS LE CORPS : un navigateur ne lit pas l'en-tête
  // `Retry-After` d'une réponse venue d'une autre origine.
  const error = {
    code: reason,
    message: ASSISTANT_MESSAGES[reason],
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
  return json(httpStatusForAssistantFailure(reason), { error }, { "Cache-Control": "no-store" });
}

/**
 * Le client d'écriture vers le Socle, construit par requête (motif
 * `irisClient`) : il n'a rien à mettre en cache, contrairement au port de
 * lecture. `null` sans `SOCLE_AUDIENCE_API_URL` — la mesure est alors un
 * silence complet.
 *
 * ⚠️ LA MÊME CLÉ QUE LA LECTURE (`SOCLE_API_KEY`), et c'est la décision du
 * registre des applications : UNE clé par application, portant ses scopes.
 * Celle de Nora porte `read` et `audience`. Une seconde clé pour la mesure
 * ferait deux secrets à poser, deux à faire tourner, et deux à révoquer le
 * jour où il le faudrait.
 */
function audienceClient() {
  const baseUrl = Deno.env.get("SOCLE_AUDIENCE_API_URL");
  const apiKey = Deno.env.get("SOCLE_API_KEY");
  if (!baseUrl || !apiKey) return null;
  return createAudienceClient({ baseUrl, apiKey });
}

/** Messages de refus d'une pièce, adressés au visiteur (l'écran les traduit par code). */
const PIECE_MESSAGES: Record<string, string> = {
  piece_too_large: "Ce fichier dépasse la taille maximale de 10 Mo.",
  piece_unsupported: "Ce fichier n'est pas dans un format accepté.",
  piece_rejected: "Ce fichier n'a pas pu être accepté.",
  too_many_uploads: "Trop de fichiers envoyés en peu de temps : patientez une minute.",
  iris_unavailable: "Le fichier n'a pas pu être envoyé. Merci de réessayer dans quelques instants.",
  iris_misconfigured: "Le fichier n'a pas pu être envoyé. Merci de réessayer dans quelques instants.",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extra },
  });
}

/**
 * Message adressé à un VISITEUR, pas à un exploitant : il ne sait pas ce qu'est
 * un Socle et n'a que faire du détail. Le code, lui, est stable et porte le
 * diagnostic — c'est celui-là qu'on lit dans les journaux.
 *
 * `socle_unavailable` et `socle_misconfigured` disent la même chose au
 * visiteur : de sa place, une clé refusée et un service coupé sont la même
 * panne. Ils restent distincts dans le code d'erreur, où ils mènent à deux
 * gestes d'exploitation différents. Même parti pour Iris.
 */
const FAILURE_MESSAGES: Record<PortalFailure, string> = {
  invalid_hostname: "L'adresse utilisée ne permet pas d'identifier une collectivité.",
  unknown_domain: "Aucune collectivité n'est rattachée à cette adresse.",
  tenant_unavailable: "Cette collectivité n'est pas accessible pour le moment.",
  socle_unavailable: "Le service est momentanément indisponible. Merci de réessayer plus tard.",
  socle_misconfigured: "Le service est momentanément indisponible. Merci de réessayer plus tard.",
  not_configured: "Le portail n'est pas configuré.",
  demarche_unavailable: "Cette démarche n'est plus proposée en ligne.",
  organisme_unavailable: "Cet organisme ne propose pas de démarche en ligne.",
  submission_rejected:
    "Votre demande n'a pas pu être enregistrée. Merci de contacter votre collectivité.",
  iris_unavailable:
    "Votre demande n'a pas pu être envoyée. Merci de réessayer dans quelques instants.",
  iris_misconfigured:
    "Votre demande n'a pas pu être envoyée. Merci de réessayer dans quelques instants.",
};

function failure(reason: PortalFailure): Response {
  // `no-store` sur les échecs : une indisponibilité passagère ne doit pas
  // rester affichée après le rétablissement du service.
  return json(
    httpStatusForFailure(reason),
    { error: { code: reason, message: FAILURE_MESSAGES[reason] } },
    { "Cache-Control": "no-store" },
  );
}

function cacheTtlMs(): number {
  const raw = Deno.env.get("PORTAL_CACHE_TTL_SECONDS");
  if (raw === undefined || raw.trim() === "") return DEFAULT_CACHE_TTL_SECONDS * 1000;
  const seconds = Number(raw);
  // Une valeur illisible ne doit pas désactiver le cache en silence ni le
  // rendre éternel : on retombe sur le défaut, en le disant.
  if (!Number.isFinite(seconds) || seconds < 0) {
    console.warn("portal-api : PORTAL_CACHE_TTL_SECONDS illisible, valeur par défaut appliquée.");
    return DEFAULT_CACHE_TTL_SECONDS * 1000;
  }
  return seconds * 1000;
}

/**
 * Le client est construit UNE fois, au démarrage de l'isolat, pour que le cache
 * survive d'une requête à l'autre — c'est tout son intérêt. Deno recycle les
 * isolats entre les requêtes ; un cache reconstruit à chaque appel ne servirait
 * jamais.
 */
let sharedClient: ReturnType<typeof withCache> | null = null;

function socleClient(baseUrl: string, apiKey: string) {
  if (sharedClient === null) {
    sharedClient = withCache(createSocleClient({ baseUrl, apiKey }), { ttlMs: cacheTtlMs() });
  }
  return sharedClient;
}

/**
 * La collectivité du domaine visité. Le navigateur ne fournit jamais de
 * tenant : il n'a aucun moyen d'en fournir un, et c'est ce qui rend inutile
 * toute tentative de le falsifier.
 */
async function tenantOf(
  request: Request,
  socle: ReturnType<typeof socleClient>,
): Promise<{ ok: true; tenant: Tenant } | { ok: false; response: Response }> {
  const hostname = hostnameForRequest(request, {
    suffix: Deno.env.get("PORTAL_DEV_DOMAIN_SUFFIX") ?? null,
    fallback: Deno.env.get("PORTAL_DEV_HOSTNAME") ?? null,
  });
  const resolution = await resolveTenant(hostname, socle);
  if (!resolution.ok) return { ok: false, response: failure(resolution.reason) };
  return { ok: true, tenant: resolution.tenant };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(message: string): Response {
  return json(
    400,
    { error: { code: "bad_request", message } },
    { "Cache-Control": "no-store" },
  );
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/portal-api/, "") || "/";
  // La langue SOUHAITÉE par le visiteur. Elle n'est pas encore la langue
  // servie : c'est le tenant, une fois résolu, qui dit ce qu'il a activé.
  const askedLang = url.searchParams.get("lang");

  const socleUrl = Deno.env.get("SOCLE_API_URL");
  const socleKey = Deno.env.get("SOCLE_API_KEY");
  if (!socleUrl || !socleKey) {
    // Le détail va au journal, pas à la réponse : le nom des secrets manquants
    // renseigne sur le montage et n'aide en rien le visiteur.
    const missing = [!socleUrl ? "SOCLE_API_URL" : null, !socleKey ? "SOCLE_API_KEY" : null];
    console.error("portal-api : secrets manquants —", missing.filter((n) => n !== null).join(", "));
    return failure("not_configured");
  }
  const socle = socleClient(socleUrl, socleKey);

  // ── GET /v1/bootstrap — tout ce qu'il faut pour rendre la page d'accueil.
  if (request.method === "GET" && path === "/v1/bootstrap") {
    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;
    const tenant = resolved.tenant;

    // Ce que cette collectivité publie. Une liste vide est un succès.
    // ⚠️ C'EST LE SERVEUR QUI TRANCHE LA LANGUE, et il la renvoie. Une langue
    // mémorisée puis désactivée par la collectivité, un préfixe d'URL inventé :
    // tous retombent sur le français, et la réponse dit lequel a été servi pour
    // que l'adresse cesse de mentir au visiteur.
    const lang = resolveLang(askedLang, tenant.languages);

    const demarches = await getPublicDemarches(tenant.id, socle, lang);
    if (!demarches.ok) return failure(demarches.reason);

    // ── Le périmètre d'un organisme — `?organisme=<slug>`.
    //
    // ⚠️ LE CATALOGUE VIENT D'ÊTRE LU POUR LA COLLECTIVITÉ ENTIÈRE, et c'est
    // voulu : la clé du cache est le chemin demandé au Socle, identique à
    // celui de l'accueil. La page d'une mairie ne coûte donc pas un appel de
    // plus, et les deux pages se réchauffent l'une l'autre. Demander au Socle
    // le catalogue restreint à l'organisme aurait doublé les entrées de cache
    // pour servir un sous-ensemble de ce qu'on tient déjà.
    const askedOrganisme = url.searchParams.get("organisme");
    if (askedOrganisme !== null) {
      const organisme = organizationBySlug(demarches.demarches, askedOrganisme, tenant.id);
      // Slug inventé, organisme qui ne publie rien, ou slug de la collectivité
      // elle-même : même refus que pour une démarche non publiée — « pas
      // ici ». C'est l'interface qui ramène alors le visiteur à l'accueil.
      if (organisme === null) return failure("organisme_unavailable");

      // La charte de l'organisme VISITÉ. Le Socle résout l'héritage : un
      // organisme qui n'a pas la sienne rend celle de sa collectivité, si bien
      // que la page reste cohérente au lieu de retomber sur les couleurs par
      // défaut du portail.
      const organismeBranding = await getBranding(organisme.id, socle);
      if (!organismeBranding.ok) return failure(organismeBranding.reason);

      // ⚠️ DEUX CHARTES, DEUX USAGES, et il faut les deux : celle de
      // l'organisme PEINT la page (ses couleurs, son logo dans le bloc
      // d'identification), celle de la collectivité porte la MARQUE de
      // l'en-tête. Le bandeau du haut dit sur quel site on est ; le bloc
      // dessous dit quelle mairie on visite. Les confondre ferait croire à un
      // site propre à la mairie, alors qu'elle est une entrée de celui de sa
      // collectivité.
      //
      // Le coût est nul en pratique : c'est le même chemin demandé au Socle
      // que pour l'accueil, donc la même entrée de cache.
      const tenantBranding = await getBranding(tenant.id, socle);

      return json(
        200,
        {
          lang,
          tenant,
          // ⚠️ TOUTES les villes, pas seulement celle-ci : le menu « Ma ville »
          // de l'en-tête sert précisément à en changer. Une liste réduite au
          // périmètre courant enfermerait le visiteur sur la page où il est.
          villes: villesOf(demarches.demarches, tenant.id),
          organisme,
          demarches: demarchesOfOrganization(demarches.demarches, organisme.id),
          tenantBranding: tenantBranding.ok ? tenantBranding.branding : null,
          // ⚠️ AUCUNE PAGE COMPOSÉE ICI, et ce n'est pas un manque : le Socle
          // réserve `portal_pages` aux collectivités racines, et le portail
          // n'en veut pas — la prose d'une intercommunalité sonnerait faux
          // sous le logo d'une de ses mairies. Le gabarit est fixe, donc un
          // appel au Socle en moins que l'accueil.
          branding: organismeBranding.branding,
        },
        { "Cache-Control": "public, max-age=60" },
      );
    }

    // La page d'accueil telle qu'elle a été publiée. `null` si la collectivité
    // n'a rien composé : le portail rend alors son défaut.
    const page = await getPublishedPage(tenant.id, socle, lang);
    if (!page.ok) return failure(page.reason);

    // La charte graphique, héritage déjà résolu par le Socle. `null` = le
    // portail garde ses couleurs par défaut ; ce n'est jamais une erreur.
    const branding = await getBranding(tenant.id, socle);
    if (!branding.ok) return failure(branding.reason);

    return json(
      200,
      {
        lang,
        tenant,
        villes: villesOf(demarches.demarches, tenant.id),
        demarches: demarches.demarches,
        page: page.page,
        branding: branding.branding,
        // Ici les deux ne font qu'une : la page peinte est celle de la
        // collectivité. Le champ existe quand même, pour que l'en-tête lise
        // TOUJOURS la même chose, sur les quatre écrans.
        tenantBranding: branding.branding,
      },
      // Le catalogue d'une collectivité change à la journée, et une page
      // publique est servie à beaucoup de visiteurs : une minute de cache
      // navigateur épargne autant d'allers-retours, sans montrer la veille.
      { "Cache-Control": "public, max-age=60" },
    );
  }

  // ── GET /v1/accessibilite — la déclaration d'accessibilité de la collectivité.
  //
  // Un écran à part entière (`/accessibilite`), vers lequel mène la mention du
  // pied de page quand le Socle sert `declaration_link`. Il porte le même
  // chrome que les autres — en-tête, menu « Ma ville », charte —, d'où les
  // mêmes lectures de confort que la page d'une démarche : catalogue (pour les
  // villes) et charte, jamais bloquants, et les mêmes entrées de cache.
  //
  // ⚠️ RIEN DE PUBLIÉ N'EST PAS UNE ERREUR : `statement: null`, et l'écran dit
  // que la déclaration n'est pas encore publiée. Un lien partagé vers cette
  // adresse ne doit pas tomber sur un message de panne.
  if (request.method === "GET" && path === "/v1/accessibilite") {
    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;
    const tenant = resolved.tenant;
    const lang = resolveLang(askedLang, tenant.languages);

    const statement = await getAccessibilityStatement(tenant.id, socle);
    if (!statement.ok) return failure(statement.reason);

    const catalogue = await getPublicDemarches(tenant.id, socle, lang);
    const villes = catalogue.ok ? villesOf(catalogue.demarches, tenant.id) : [];
    const branding = await getBranding(tenant.id, socle);
    const painted = branding.ok ? branding.branding : null;

    return json(
      200,
      {
        lang,
        tenant,
        villes,
        statement: statement.statement,
        branding: painted,
        // La page est celle de la collectivité : la charte peinte EST celle de
        // la marque, comme à l'accueil.
        tenantBranding: painted,
      },
      { "Cache-Control": "public, max-age=60" },
    );
  }

  // ── GET /v1/demarches/{id} — la démarche à afficher, avec son formulaire.
  //    Le Socle décide seul si elle est publiée ; un identifiant qui ne l'est
  //    pas rend le même 404 qu'un identifiant inventé.
  if (request.method === "GET" && path.startsWith("/v1/demarches/")) {
    const demarcheId = decodeURIComponent(path.slice("/v1/demarches/".length));
    if (demarcheId === "" || demarcheId.includes("/")) {
      return json(404, { error: { code: "not_found", message: "Ressource introuvable." } });
    }
    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;

    const lang = resolveLang(askedLang, resolved.tenant.languages);
    const result = await getPublicDemarche(resolved.tenant.id, demarcheId, socle, lang);
    if (!result.ok) return failure(result.reason);

    // ── Le périmètre d'un organisme, quand l'usager est arrivé par sa page.
    //
    // ⚠️ LE SLUG SE CHERCHE DANS LES ORGANISMES DE CETTE DÉMARCHE : aucun
    // appel de plus, et cela vérifie du même geste que l'organisme la propose
    // vraiment. `/mairie-de-x/demarches/{id}` ne peut donc pas afficher, aux
    // couleurs de cette mairie, une démarche qu'elle n'assure pas.
    const askedOrganisme = url.searchParams.get("organisme");
    let organisme: DemarcheOrganization | null = null;
    if (askedOrganisme !== null) {
      organisme = organizationBySlug([result.demarche], askedOrganisme, resolved.tenant.id);
      if (organisme === null) return failure("organisme_unavailable");
    }

    // Le menu « Ma ville » doit être dans l'en-tête de TOUS les écrans, celui
    // d'une démarche compris — sinon il disparaîtrait dès qu'on ouvre une
    // démarche, et réapparaîtrait en revenant.
    //
    // ⚠️ Cette lecture n'est un appel de plus qu'À FROID : la clé du cache est
    // le chemin demandé au Socle, exactement celui de l'accueil et des pages
    // d'organisme, et un visiteur arrive presque toujours par une page qui l'a
    // déjà réchauffé. Un échec ne bloque rien : la liste est vide, le menu ne
    // s'affiche pas, la démarche se lit quand même.
    const catalogue = await getPublicDemarches(resolved.tenant.id, socle, lang);
    const villes = catalogue.ok ? villesOf(catalogue.demarches, resolved.tenant.id) : [];

    // La charte voyage avec la démarche : la page doit être aux couleurs de la
    // collectivité même quand l'usager y arrive par un lien direct, sans être
    // passé par l'accueil. Décorative comme partout — jamais bloquante.
    //
    // Sous le périmètre d'un organisme, c'est la SIENNE : rien ne doit changer
    // d'habillage entre la liste d'une mairie et la démarche qu'on y choisit.
    //
    // La MARQUE de l'en-tête, elle, reste celle de la collectivité — voir la
    // page d'un organisme pour le pourquoi. Hors périmètre, les deux appels
    // sont le même chemin, donc la même entrée de cache : rien de plus.
    const tenantBranding = await getBranding(resolved.tenant.id, socle);
    const branding = organisme === null
      ? tenantBranding
      : await getBranding(organisme.id, socle);
    return json(
      200,
      {
        lang,
        tenant: resolved.tenant,
        villes,
        organisme,
        demarche: result.demarche,
        branding: branding.ok ? branding.branding : null,
        tenantBranding: tenantBranding.ok ? tenantBranding.branding : null,
      },
      { "Cache-Control": "public, max-age=60" },
    );
  }

  // ── POST /v1/demandes/pieces — un fichier, AVANT la demande.
  //
  // Le portail ne garde rien : il relaie les octets à Iris (`POST /v1/uploads`,
  // contrat 2.0.0), qui vérifie le contenu réel, calcule l'empreinte et garde
  // le fichier vingt-quatre heures en attente d'une demande. Le navigateur ne
  // reçoit qu'un identifiant, qu'il mettra dans `attachments` au dépôt.
  //
  // Ordre des vérifications : la taille annoncée AVANT de lire le corps (un
  // envoi de 300 Mo est refusé sans être chargé), le frein par adresse, la
  // collectivité du domaine, puis — si le formulaire est nommé — les formats
  // que la démarche demande pour ce champ.
  if (request.method === "POST" && path === "/v1/demandes/pieces") {
    const irisUrl = Deno.env.get("IRIS_API_URL");
    const irisKey = Deno.env.get("IRIS_API_KEY");
    if (!irisUrl || !irisKey) {
      console.error("portal-api : secrets Iris manquants pour le dépôt d'une pièce.");
      return failure("not_configured");
    }
    const pieceFailure = (code: keyof typeof PIECE_MESSAGES, status: number, message?: string) =>
      json(status, { error: { code, message: message ?? PIECE_MESSAGES[code] } }, { "Cache-Control": "no-store" });

    const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declared) && declared > MAX_PIECE_BYTES + MULTIPART_ALLOWANCE) {
      return pieceFailure("piece_too_large", 413);
    }
    if (!pieceLimiter.allow(await hashKey(clientAddress(request.headers)))) {
      return pieceFailure("too_many_uploads", 429);
    }

    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return badRequest("Envoi multipart/form-data attendu, avec un champ « file ».");
    }
    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("Fichier absent (champ « file »).");
    if (file.size === 0) return badRequest("Le fichier est vide.");
    if (file.size > MAX_PIECE_BYTES) return pieceFailure("piece_too_large", 413);
    const fileName = file.name.trim();
    if (fileName === "" || fileName.length > 255) return badRequest("Nom de fichier absent ou trop long.");

    // Les formats que la démarche demande pour CE champ — un confort de plus
    // avant Iris, qui vérifie de toute façon le contenu réel.
    const demarcheId = typeof form.get("demarcheId") === "string" ? String(form.get("demarcheId")).trim() : "";
    const fieldId = typeof form.get("fieldId") === "string" ? String(form.get("fieldId")).trim() : "";
    if (demarcheId !== "" && fieldId !== "") {
      const result = await getPublicDemarche(
        resolved.tenant.id,
        demarcheId,
        socle,
        resolveLang(askedLang, resolved.tenant.languages),
      );
      if (!result.ok) return failure(result.reason);
      const field = result.demarche.form === null
        ? undefined
        : allFields(result.demarche.form).find((f) => f.id === fieldId);
      if (field === undefined || field.type !== "attachment") {
        return badRequest("fieldId : ce champ n'est pas une pièce de cette démarche.");
      }
      if (field.acceptedFormats.length > 0) {
        const dot = fileName.lastIndexOf(".");
        const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
        if (!field.acceptedFormats.includes(ext)) {
          return pieceFailure(
            "piece_unsupported", 415,
            `Formats acceptés pour cette pièce : ${field.acceptedFormats.map((f) => f.toUpperCase()).join(", ")}.`,
          );
        }
      }
    }

    const iris = createIrisClient({ baseUrl: irisUrl, apiKey: irisKey });
    const uploaded = await uploadPiece({ file, fileName }, iris);
    if (!uploaded.ok) {
      if (uploaded.reason === "iris_misconfigured" || uploaded.reason === "iris_unavailable") {
        return failure(uploaded.reason);
      }
      return pieceFailure(uploaded.reason, httpStatusForPieceFailure(uploaded.reason));
    }
    return json(201, { piece: uploaded.piece }, { "Cache-Control": "no-store" });
  }

  // ── POST /v1/demandes — le dépôt.
  //
  // Trois vérifications, toutes CÔTÉ SERVEUR, parce qu'aucune ne peut être
  // déléguée à un navigateur : la collectivité vient du domaine visité, la
  // démarche est revérifiée au catalogue publié, et l'organisme destinataire
  // doit faire partie de ceux qui proposent la démarche.
  //
  // Ce qui n'est PAS vérifié ici : la complétude du formulaire. C'est le parti
  // d'Iris — « la complétude est un problème d'instruction, pas un motif de
  // rejet » — et le portail ne va pas décider l'inverse pour lui. La saisie est
  // guidée dans le navigateur ; une demande incomplète arrive quand même, et
  // c'est un agent qui la qualifie.
  if (request.method === "POST" && path === "/v1/demandes") {
    const irisUrl = Deno.env.get("IRIS_API_URL");
    const irisKey = Deno.env.get("IRIS_API_KEY");
    if (!irisUrl || !irisKey) {
      const missing = [!irisUrl ? "IRIS_API_URL" : null, !irisKey ? "IRIS_API_KEY" : null];
      console.error("portal-api : secrets Iris manquants —", missing.filter((n) => n !== null).join(", "));
      return failure("not_configured");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest("Corps JSON attendu.");
    }
    if (!isRecord(body)) return badRequest("Corps JSON attendu.");

    const demarcheId = typeof body.demarcheId === "string" ? body.demarcheId.trim() : "";
    const submissionId = typeof body.submissionId === "string" ? body.submissionId.trim() : "";
    if (demarcheId === "") return badRequest("demarcheId : identifiant de démarche attendu.");
    if (submissionId === "" || submissionId.length > MAX_SUBMISSION_ID) {
      return badRequest("submissionId : identifiant de dépôt attendu.");
    }

    // La porte anti-robot du dépôt : une preuve de travail LIÉE à cette demande
    // (`depositGate.ts`). Avant toute lecture du Socle et tout appel à Iris.
    // ⚠️ Tolérante tant que `DEPOSIT_CHALLENGE_REQUIRED` n'est pas posé : l'écran
    // et cette fonction ne se déploient pas au même instant.
    const gate = await checkDepositChallenge({
      secret: Deno.env.get("ASSISTANT_SIGNING_SECRET") ?? null,
      required: Deno.env.get("DEPOSIT_CHALLENGE_REQUIRED") === "true",
      challenge: body.challenge,
      submissionId,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (gate !== "open") {
      // 428 « Precondition Required » : la demande est bien formée, il lui
      // manque un préalable que l'écran sait fournir (`POST /v1/defi`).
      return json(
        428,
        { error: { code: "challenge_required", message: "Votre demande n'a pas pu être envoyée. Merci de réessayer." } },
        { "Cache-Control": "no-store" },
      );
    }

    if (body.formData !== undefined && !isRecord(body.formData)) {
      return badRequest("formData : objet attendu.");
    }
    if (body.requester !== undefined && body.requester !== null && !isRecord(body.requester)) {
      return badRequest("requester : objet attendu.");
    }
    if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
      return badRequest("attachments : tableau attendu.");
    }

    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;
    const tenant = resolved.tenant;

    const result = await getPublicDemarche(
      tenant.id,
      demarcheId,
      socle,
      resolveLang(askedLang, tenant.languages),
    );
    if (!result.ok) return failure(result.reason);
    const demarche = result.demarche;

    // L'organisme destinataire, s'il est nommé, doit être l'un de ceux qui
    // PROPOSENT la démarche : sinon le portail permettrait d'adresser une
    // demande à un service qui ne l'assure pas.
    const rawOrganizationId =
      typeof body.organizationId === "string" && body.organizationId.trim() !== ""
        ? body.organizationId.trim()
        : null;
    if (
      rawOrganizationId !== null &&
      !demarche.organizations.some((org) => org.id === rawOrganizationId)
    ) {
      return badRequest("organizationId : cet organisme ne propose pas cette démarche.");
    }

    // On ne dépose que des clés que le formulaire déclare. Une enveloppe
    // fabriquée à la main ne peut donc pas glisser de champs inventés dans une
    // demande, où un agent les lirait comme des réponses de l'usager.
    const declaredKeys = new Set(
      demarche.form === null ? [] : allFields(demarche.form).map((field) => field.key),
    );
    const rawFormData = isRecord(body.formData) ? body.formData : {};
    const formData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawFormData)) {
      if (declaredKeys.has(key)) formData[key] = value;
    }

    // Les pièces : un identifiant de dépôt (Iris revérifie qu'il est de CETTE
    // clé, vivant et pas déjà rattaché) sous la clé d'un champ « pièce » que
    // le formulaire DÉCLARE — même règle de whitelist que les réponses.
    const attachmentKeys = new Set(
      demarche.form === null
        ? []
        : allFields(demarche.form).filter((f) => f.type === "attachment").map((f) => f.key),
    );
    const attachments: AttachmentRef[] = [];
    const seenUploads = new Set<string>();
    for (const raw of Array.isArray(body.attachments) ? body.attachments : []) {
      if (!isRecord(raw)) continue;
      const uploadId = typeof raw.uploadId === "string" ? raw.uploadId.trim() : "";
      const fieldKey = typeof raw.fieldKey === "string" ? raw.fieldKey.trim() : "";
      if (uploadId === "" || uploadId.length > MAX_UPLOAD_ID || seenUploads.has(uploadId)) continue;
      if (!attachmentKeys.has(fieldKey)) continue;
      seenUploads.add(uploadId);
      attachments.push({ uploadId, fieldKey });
      if (attachments.length >= MAX_ATTACHMENTS) break;
    }

    // Même règle pour l'identité : les clés du paramétrage du Socle, plus le
    // type de fiche, et rien d'autre.
    const requesterKeys = new Set<string>(["contact_type"]);
    for (const audience of AUDIENCES) {
      for (const field of audience.fields) requesterKeys.add(field.key);
    }
    const rawRequester = isRecord(body.requester) ? body.requester : {};
    const requester: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawRequester)) {
      if (!requesterKeys.has(key)) continue;
      if (typeof value !== "string" || value.trim() === "") continue;
      requester[key] = value.trim();
    }

    const iris = createIrisClient({ baseUrl: irisUrl, apiKey: irisKey });
    const submission = await submitDemande(
      {
        sourceSystem: Deno.env.get("IRIS_SOURCE_SYSTEM") ?? DEFAULT_SOURCE_SYSTEM,
        tenantId: tenant.id,
        demarcheName: demarche.name,
        submission: {
          demarcheId,
          organizationId: rawOrganizationId,
          formData,
          requester: Object.keys(requester).length === 0 ? null : requester,
          submissionId,
          attachments,
        },
      },
      iris,
    );
    if (!submission.ok) return failure(submission.reason);

    // Le dépôt compte dans la fréquentation — APRÈS l'acceptation d'Iris, et
    // sans retarder l'accusé : un dépôt compté puis refusé gonflerait un taux
    // de conversion sans qu'aucune demande n'existe. `waitUntil` laisse
    // l'envoi finir hors de la réponse quand le runtime le propose.
    const audience = audienceClient();
    if (audience !== null) {
      const counted = audience.post("/v1/deposits", {
        tenant_id: tenant.id,
        procedure_id: demarcheId,
      });
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
        .EdgeRuntime;
      if (typeof runtime?.waitUntil === "function") runtime.waitUntil(counted);
    }

    // Jamais de cache sur un accusé : il est propre à un dépôt.
    return json(201, { receipt: submission.receipt }, { "Cache-Control": "no-store" });
  }

  // ── POST /v1/defi — le défi anti-robot d'un DÉPÔT.
  //
  // À part de `/v1/assistant/defi`, qui n'existe que si la collectivité a ouvert
  // l'assistant : déposer une demande par le formulaire classique demande la
  // même preuve, assistant ou pas. L'écran la résout en la LIANT à l'identifiant
  // de sa demande. Sans secret de signature, pas de défi : 404, et l'écran
  // dépose comme avant (la porte du dépôt n'existe pas non plus, voir
  // `depositGate.ts`).
  if (request.method === "POST" && path === "/v1/defi") {
    const secret = Deno.env.get("ASSISTANT_SIGNING_SECRET");
    if (!secret) {
      return json(404, { error: { code: "not_found", message: "Route inconnue." } }, { "Cache-Control": "no-store" });
    }
    if (!assistantLimiter.allow(await hashKey(clientAddress(request.headers)))) {
      return json(429, { error: { code: "too_many_requests", message: "Merci de patienter quelques secondes." } }, { "Cache-Control": "no-store" });
    }
    // Un défi n'est servi qu'à un domaine qui existe : pas de calcul offert à
    // qui n'est sur aucun portail.
    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;
    const challenge = await issueChallenge(
      secret,
      Math.floor(Date.now() / 1000),
      clampBits(Deno.env.get("ASSISTANT_CHALLENGE_BITS")),
    );
    return json(200, { challenge }, { "Cache-Control": "no-store" });
  }

  // ── POST /v1/assistant/defi et POST /v1/assistant — l'assistant conversationnel.
  //
  // Il renseigne l'usager et l'oriente vers une démarche, à partir de ce que le
  // portail AFFICHE DÉJÀ et de rien d'autre. Il ne dépose rien : le guichet IA
  // du Socle refuse les outils, et c'est très bien ainsi.
  //
  // ⚠️ TROIS PORTES AVANT LE MOINDRE JETON : la collectivité a ouvert
  // l'assistant (interrupteur du Socle, réglé par son super administrateur) ;
  // le visiteur a résolu un défi ou présente un ticket du serveur ; chaque
  // réponse « assistant » du fil est signée. Tout cela vit dans `_shared/ai/`.
  //
  // ⚠️ RIEN N'EST JOURNALISÉ DU CONTENU — ni ici, ni au Socle (passe-plat). Ne
  // pas ajouter de `console.*` qui cite un message : le fil d'un usager n'existe
  // que dans son onglet.
  if (request.method === "POST" && (path === "/v1/assistant/defi" || path === "/v1/assistant")) {
    const secret = Deno.env.get("ASSISTANT_SIGNING_SECRET");
    const aiUrl = Deno.env.get("SOCLE_AI_API_URL");
    const aiKey = Deno.env.get("SOCLE_AI_API_KEY");
    if (!secret || !aiUrl || !aiKey) {
      console.error("portal-api : secrets de l'assistant manquants.");
      return assistantFailure("assistant_not_configured");
    }
    if (!assistantLimiter.allow(await hashKey(clientAddress(request.headers)))) {
      return assistantFailure("assistant_rate_limited", 60);
    }

    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;
    const tenant = resolved.tenant;
    if (!tenant.assistant.enabled) return assistantFailure("assistant_closed");
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    if (path === "/v1/assistant/defi") {
      const challenge = await issueChallenge(
        secret,
        nowSeconds(),
        clampBits(Deno.env.get("ASSISTANT_CHALLENGE_BITS")),
      );
      return json(200, { challenge }, { "Cache-Control": "no-store" });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return assistantFailure("bad_request");
    }
    const lang = resolveLang(isRecord(body) && typeof body.lang === "string" ? body.lang : askedLang, tenant.languages);

    const outcome = await runAssistantTurn(tenant, lang, body, {
      secret,
      ai: createSocleAiClient({ baseUrl: aiUrl, apiKey: aiKey }),
      loadCatalogue: async () => {
        const result = await getPublicDemarches(tenant.id, socle, lang);
        return result.ok ? result.demarches : null;
      },
      loadDemarche: async (id) => {
        const result = await getPublicDemarche(tenant.id, id, socle, lang);
        return result.ok ? result.demarche : null;
      },
      nowSeconds,
      newConversationId: () => crypto.randomUUID(),
    });
    if (!outcome.ok) {
      if (outcome.reason === "assistant_not_configured") {
        // Clé refusée, scope `ai` absent, collectivité non abonnée, agent ou
        // fournisseur non configuré au Socle : un geste d'exploitation.
        console.error("portal-api : le guichet IA du Socle refuse l'appel de l'assistant.");
      }
      return assistantFailure(outcome.reason, outcome.retryAfterSeconds);
    }
    return json(200, outcome.reply, { "Cache-Control": "no-store" });
  }

  // ── POST /v1/audience — une page vue, comptée sans cookie.
  //
  // ⚠️ LA RÉPONSE EST TOUJOURS 204, quoi qu'il arrive : robot écarté, frein
  // atteint, domaine inconnu, Socle muet, mesure non configurée. Le navigateur
  // ne doit RIEN pouvoir déduire de ce qu'il reçoit — ni l'existence d'une
  // collectivité, ni l'état de la chaîne de mesure — et il n'a de toute façon
  // rien à en faire : il a déjà affiché sa page. Seul un corps illisible rend
  // 400, parce que c'est une erreur de l'appelant et qu'elle se corrige.
  //
  // ⚠️ SANS `SOCLE_AUDIENCE_API_URL`, LA FONCTION NE COMPTE RIEN. La mesure est
  // un choix explicite, et un environnement de développement ne pollue pas les
  // chiffres d'une collectivité en production.
  if (request.method === "POST" && path === "/v1/audience") {
    const silent = () => new Response(null, { status: 204, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } });

    let body: unknown;
    try {
      // ⚠️ `text/plain` côté navigateur : c'est une requête « simple », donc
      // SANS requête préalable OPTIONS — un seul appel par page vue, pas deux.
      // Le corps reste du JSON ; on le lit nous-mêmes.
      body = JSON.parse(await request.text());
    } catch {
      return badRequest("Corps JSON attendu.");
    }
    const beacon = parseAudienceBeacon(body);
    if (beacon === null) return badRequest("Beacon invalide.");

    // Les robots honnêtes se nomment, et visitent une page d'accueil de
    // collectivité plusieurs fois par jour (voir `isBot`). Le User-Agent est lu
    // ICI, et n'ira pas plus loin.
    const userAgent = request.headers.get("user-agent");
    if (isBot(userAgent)) return silent();

    if (!audienceLimiter.allow(await hashKey(clientAddress(request.headers)))) return silent();

    const audience = audienceClient();
    if (audience === null) return silent();

    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return silent();

    // La langue SERVIE, pas celle demandée — la même résolution que partout
    // ailleurs : compter « breton » là où la collectivité sert du français
    // ferait croire à un public qui n'existe pas.
    const lang = resolveLang(askedLang, resolved.tenant.languages);

    await audience.post("/v1/page-views", {
      tenant_id: resolved.tenant.id,
      page: beacon.page,
      procedure_id: beacon.demarcheId,
      entry: beacon.entry,
      lang,
      device: deviceClass(userAgent),
    });
    return silent();
  }

  if (
    path === "/v1/bootstrap" || path === "/v1/demandes" || path === "/v1/demandes/pieces"
    || path === "/v1/audience" || path.startsWith("/v1/demarches/")
  ) {
    return json(405, {
      error: { code: "method_not_allowed", message: "Méthode non autorisée sur cette ressource." },
    });
  }
  return json(404, { error: { code: "not_found", message: "Ressource introuvable." } });
});
