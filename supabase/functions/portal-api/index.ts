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
import { resolveTenant } from "../_shared/socle/tenantService.ts";
import { createSocleClient } from "../_shared/socle/socleClient.ts";
import { withCache } from "../_shared/socle/cachedSocleClient.ts";
import { createIrisClient } from "../_shared/iris/irisClient.ts";
import { submitDemande } from "../_shared/iris/demandeService.ts";
import { hostnameForRequest } from "../_shared/http/requestHostname.ts";
import { allFields } from "../_shared/domain/formSchema.ts";
import { AUDIENCES } from "../_shared/domain/requesterConfig.ts";
import type { Tenant } from "../_shared/domain/tenant.ts";
import { httpStatusForFailure, type PortalFailure } from "../_shared/domain/failure.ts";

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

  const path = new URL(request.url).pathname.replace(/^\/portal-api/, "") || "/";

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
    const demarches = await getPublicDemarches(tenant.id, socle);
    if (!demarches.ok) return failure(demarches.reason);

    // La page d'accueil telle qu'elle a été publiée. `null` si la collectivité
    // n'a rien composé : le portail rend alors son défaut.
    const page = await getPublishedPage(tenant.id, socle);
    if (!page.ok) return failure(page.reason);

    // La charte graphique, héritage déjà résolu par le Socle. `null` = le
    // portail garde ses couleurs par défaut ; ce n'est jamais une erreur.
    const branding = await getBranding(tenant.id, socle);
    if (!branding.ok) return failure(branding.reason);

    return json(
      200,
      { tenant, demarches: demarches.demarches, page: page.page, branding: branding.branding },
      // Le catalogue d'une collectivité change à la journée, et une page
      // publique est servie à beaucoup de visiteurs : une minute de cache
      // navigateur épargne autant d'allers-retours, sans montrer la veille.
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

    const result = await getPublicDemarche(resolved.tenant.id, demarcheId, socle);
    if (!result.ok) return failure(result.reason);

    // La charte voyage avec la démarche : la page doit être aux couleurs de la
    // collectivité même quand l'usager y arrive par un lien direct, sans être
    // passé par l'accueil. Décorative comme partout — jamais bloquante.
    const branding = await getBranding(resolved.tenant.id, socle);
    return json(
      200,
      {
        tenant: resolved.tenant,
        demarche: result.demarche,
        branding: branding.ok ? branding.branding : null,
      },
      { "Cache-Control": "public, max-age=60" },
    );
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
    if (body.formData !== undefined && !isRecord(body.formData)) {
      return badRequest("formData : objet attendu.");
    }
    if (body.requester !== undefined && body.requester !== null && !isRecord(body.requester)) {
      return badRequest("requester : objet attendu.");
    }

    const resolved = await tenantOf(request, socle);
    if (!resolved.ok) return resolved.response;
    const tenant = resolved.tenant;

    const result = await getPublicDemarche(tenant.id, demarcheId, socle);
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
        },
      },
      iris,
    );
    if (!submission.ok) return failure(submission.reason);

    // Jamais de cache sur un accusé : il est propre à un dépôt.
    return json(201, { receipt: submission.receipt }, { "Cache-Control": "no-store" });
  }

  if (path === "/v1/bootstrap" || path === "/v1/demandes" || path.startsWith("/v1/demarches/")) {
    return json(405, {
      error: { code: "method_not_allowed", message: "Méthode non autorisée sur cette ressource." },
    });
  }
  return json(404, { error: { code: "not_found", message: "Ressource introuvable." } });
});
