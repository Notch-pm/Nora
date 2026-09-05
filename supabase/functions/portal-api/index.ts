/**
 * portal-api — le backend du portail usagers. Une seule instance sert TOUTES
 * les collectivités.
 *
 * Son travail tient en trois étapes : déterminer le domaine visité, demander au
 * Socle à qui il appartient, servir ce que cette collectivité publie. Il ne
 * connaît aucune collectivité, n'en stocke aucune, et n'a pas de base de
 * données. Ajouter `angers.edilumen.fr` ne demande aucun déploiement — une
 * ligne dans les domaines du Socle suffit.
 *
 * La clé du Socle vit ICI, en secret d'edge function, et ne traverse jamais un
 * navigateur. C'est la raison d'être de cette fonction : sans elle, le portail
 * serait une page statique, incapable d'interroger un référentiel authentifié.
 *
 * Déployée avec `verify_jwt = false` : le portail est public par nature, il n'y
 * a pas d'usager connecté à ce stade.
 *
 * Ce fichier ne contient QUE de la plomberie HTTP. Les règles sont dans
 * `_shared/` — c'est ce qui les rend testables sans lancer Deno.
 */
import { getPublicDemarches } from "../_shared/socle/demarcheService.ts";
import { getPublishedPage } from "../_shared/socle/pageService.ts";
import { getBranding } from "../_shared/socle/brandingService.ts";
import { resolveTenant } from "../_shared/socle/tenantService.ts";
import { createSocleClient } from "../_shared/socle/socleClient.ts";
import { withCache } from "../_shared/socle/cachedSocleClient.ts";
import { hostnameForRequest } from "../_shared/http/requestHostname.ts";
import { httpStatusForFailure, type PortalFailure } from "../_shared/domain/failure.ts";

/**
 * CORS ouvert, et c'est délibéré : cette API sert des données **publiques**,
 * sans cookie ni jeton de session, à un ensemble de domaines qui change chaque
 * fois qu'une collectivité rejoint la gamme. Une liste blanche devrait être
 * tenue au rythme du référentiel — c'est-à-dire exactement le couplage que ce
 * portail existe pour supprimer. Le contrôle d'accès n'est pas ici : il est
 * dans ce que le Socle accepte de publier.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** Durée de vie du cache mémoire, en secondes. `0` le désactive. */
const DEFAULT_CACHE_TTL_SECONDS = 60;

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
 * gestes d'exploitation différents.
 */
const FAILURE_MESSAGES: Record<PortalFailure, string> = {
  invalid_hostname: "L'adresse utilisée ne permet pas d'identifier une collectivité.",
  unknown_domain: "Aucune collectivité n'est rattachée à cette adresse.",
  tenant_unavailable: "Cette collectivité n'est pas accessible pour le moment.",
  socle_unavailable: "Le service est momentanément indisponible. Merci de réessayer plus tard.",
  socle_misconfigured: "Le service est momentanément indisponible. Merci de réessayer plus tard.",
  not_configured: "Le portail n'est pas configuré.",
};

function failure(reason: PortalFailure): Response {
  // `no-store` sur les échecs : une indisponibilité passagère ne doit pas
  // rester affichée après le rétablissement du Socle.
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

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") {
    return json(405, {
      error: { code: "method_not_allowed", message: "Seule la méthode GET est autorisée." },
    });
  }

  const path = new URL(request.url).pathname.replace(/^\/portal-api/, "") || "/";
  if (path !== "/v1/bootstrap") {
    return json(404, { error: { code: "not_found", message: "Ressource introuvable." } });
  }

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

  // ── 1. Le domaine visité, déduit côté serveur. Le navigateur ne fournit
  //       jamais de tenant : il n'a aucun moyen d'en fournir un.
  const hostname = hostnameForRequest(request, {
    suffix: Deno.env.get("PORTAL_DEV_DOMAIN_SUFFIX") ?? null,
    fallback: Deno.env.get("PORTAL_DEV_HOSTNAME") ?? null,
  });

  // ── 2. À qui appartient ce domaine ? Le Socle répond, et lui seul.
  const resolution = await resolveTenant(hostname, socle);
  if (!resolution.ok) return failure(resolution.reason);

  // ── 3. Ce que cette collectivité publie. Une liste vide est un succès.
  const demarches = await getPublicDemarches(resolution.tenant.id, socle);
  if (!demarches.ok) return failure(demarches.reason);

  // ── 4. La page d'accueil telle qu'elle a été publiée. `null` si la
  //       collectivité n'a rien composé : le portail rend alors son défaut.
  const page = await getPublishedPage(resolution.tenant.id, socle);
  if (!page.ok) return failure(page.reason);

  // ── 5. La charte graphique, héritage déjà résolu par le Socle. `null` = le
  //       portail garde ses couleurs par défaut ; ce n'est jamais une erreur.
  const branding = await getBranding(resolution.tenant.id, socle);
  if (!branding.ok) return failure(branding.reason);

  return json(
    200,
    {
      tenant: resolution.tenant,
      demarches: demarches.demarches,
      page: page.page,
      branding: branding.branding,
    },
    // Le catalogue d'une collectivité change à la journée, et une page publique
    // est servie à beaucoup de visiteurs : une minute de cache navigateur
    // épargne autant d'allers-retours, sans jamais montrer la veille.
    { "Cache-Control": "public, max-age=60" },
  );
});
