/**
 * L'abstraction consommée par l'interface. Ce qui est vérifié ici n'est pas le
 * réseau — il est simulé — mais la promesse faite aux écrans : deux questions
 * distinctes, un seul aller-retour, et un échec qui reste réessayable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentTenant,
  getPublicDemarches,
  PortalUnavailableError,
  resetPortalCache,
} from "./portalService.ts";

const SNAPSHOT = {
  tenant: {
    id: "org-1",
    name: "Ville de Nantes",
    slug: "nantes",
    hostname: "nantes.edilumen.fr",
  },
  demarches: [
    {
      id: "d1",
      name: "Signaler un problème de voirie",
      description: "Signalez un problème rencontré dans l'espace public.",
      estimatedMinutes: 5,
    },
  ],
  page: null,
  branding: null,
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetPortalCache();
  vi.stubEnv("VITE_PORTAL_API_URL", "https://portal-api.example");
  vi.stubEnv("VITE_PORTAL_CACHE_TTL_SECONDS", "60");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getCurrentTenant / getPublicDemarches", () => {
  it("rend la collectivité et ses démarches en un seul aller-retour", async () => {
    // La raison d'être du chargement mémoïsé : l'interface pose deux questions
    // séparées — c'est le contrat demandé — sans payer deux requêtes.
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    const [tenant, demarches] = await Promise.all([getCurrentTenant(), getPublicDemarches()]);
    expect(tenant.name).toBe("Ville de Nantes");
    expect(demarches).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("n'envoie NI domaine NI identifiant de tenant", () => {
    // Le serveur déduit le tenant de l'en-tête Origin. S'il y avait quoi que ce
    // soit à falsifier dans cette URL, tout le modèle de sécurité tomberait.
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    return getCurrentTenant().then(() => {
      expect(fetchMock).toHaveBeenCalledWith("https://portal-api.example/v1/bootstrap");
    });
  });

  it("ne recharge pas tant que le cache est valide", async () => {
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentTenant();
    await getCurrentTenant();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recharge après vidage du cache", async () => {
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentTenant();
    resetPortalCache();
    await getCurrentTenant();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("échecs", () => {
  it("lève une erreur portant le code du serveur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(404, { error: { code: "unknown_domain", message: "Aucune collectivité." } }),
      ),
    );

    await expect(getCurrentTenant()).rejects.toBeInstanceOf(PortalUnavailableError);
    await expect(getPublicDemarches()).rejects.toMatchObject({ reason: "unknown_domain" });
  });

  it("signale `network` quand le portail n'est pas joint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(getCurrentTenant()).rejects.toMatchObject({ reason: "network" });
  });

  it("ne mémorise PAS un échec — le rappel suivant retente", async () => {
    // Mémoriser une panne la ferait durer une minute de plus que sa cause : un
    // visiteur qui recharge après rétablissement verrait encore l'erreur.
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(respond(502, { error: { code: "socle_unavailable" } }))
      .mockResolvedValueOnce(respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentTenant()).rejects.toMatchObject({ reason: "socle_unavailable" });
    await expect(getCurrentTenant()).resolves.toMatchObject({ name: "Ville de Nantes" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuse une réponse 200 illisible plutôt que d'afficher une page vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { tenant: { id: "org-1" } })));
    await expect(getCurrentTenant()).rejects.toMatchObject({ reason: "socle_unavailable" });
  });

  it("dit `not_configured` quand l'adresse de l'API manque", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentTenant()).rejects.toMatchObject({ reason: "not_configured" });
    // Aucune requête n'est tentée : l'erreur est de configuration, pas de réseau.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
