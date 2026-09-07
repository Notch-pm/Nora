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
  lang: "fr",
  tenant: {
    id: "org-1",
    name: "Ville de Nantes",
    slug: "nantes",
    hostname: "nantes.edilumen.fr",
    languages: ["fr", "en"],
  },
  demarches: [
    {
      id: "d1",
      name: "Signaler un problème de voirie",
      description: "Signalez un problème rencontré dans l'espace public.",
      estimatedMinutes: 5,
      organizations: [{ id: "org-1", name: "Ville de Nantes" }],
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

    const [tenant, demarches] = await Promise.all([getCurrentTenant("fr"), getPublicDemarches("fr")]);
    expect(tenant.name).toBe("Ville de Nantes");
    expect(demarches).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("n'envoie NI domaine NI identifiant de tenant — seulement la langue", () => {
    // Le serveur déduit le tenant de l'en-tête Origin. S'il y avait quoi que ce
    // soit à falsifier dans cette URL, tout le modèle de sécurité tomberait.
    // La langue, elle, n'est qu'un souhait : le serveur la clampe sur ce que la
    // collectivité a activé.
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    return getCurrentTenant("fr").then(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://portal-api.example/v1/bootstrap?lang=fr",
      );
    });
  });

  it("ne recharge pas tant que le cache est valide", async () => {
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentTenant("fr");
    await getCurrentTenant("fr");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recharge après vidage du cache", async () => {
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentTenant("fr");
    resetPortalCache();
    await getCurrentTenant("fr");
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

    await expect(getCurrentTenant("fr")).rejects.toBeInstanceOf(PortalUnavailableError);
    await expect(getPublicDemarches("fr")).rejects.toMatchObject({ reason: "unknown_domain" });
  });

  it("signale `network` quand le portail n'est pas joint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(getCurrentTenant("fr")).rejects.toMatchObject({ reason: "network" });
  });

  it("ne mémorise PAS un échec — le rappel suivant retente", async () => {
    // Mémoriser une panne la ferait durer une minute de plus que sa cause : un
    // visiteur qui recharge après rétablissement verrait encore l'erreur.
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(respond(502, { error: { code: "socle_unavailable" } }))
      .mockResolvedValueOnce(respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentTenant("fr")).rejects.toMatchObject({ reason: "socle_unavailable" });
    await expect(getCurrentTenant("fr")).resolves.toMatchObject({ name: "Ville de Nantes" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuse une réponse 200 illisible plutôt que d'afficher une page vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond(200, { tenant: { id: "org-1" } })));
    await expect(getCurrentTenant("fr")).rejects.toMatchObject({ reason: "socle_unavailable" });
  });

  it("dit `not_configured` quand l'adresse de l'API manque", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentTenant("fr")).rejects.toMatchObject({ reason: "not_configured" });
    // Aucune requête n'est tentée : l'erreur est de configuration, pas de réseau.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("le cache est keyé par langue", () => {
  it("ne sert pas l'instantané français à qui demande l'anglais", async () => {
    // ⚠️ Sans la langue dans la clé, basculer en anglais rendrait la page
    // française pendant toute la durée du cache : le sélecteur semblerait
    // cassé, alors que seule la mémoire serait en cause.
    const fetchMock = vi.fn(async (url: string) =>
      respond(200, url.includes("lang=en")
        ? { ...SNAPSHOT, lang: "en", demarches: [{ ...SNAPSHOT.demarches[0], name: "Report a road problem" }] }
        : SNAPSHOT),
    );
    vi.stubGlobal("fetch", fetchMock);

    const fr = await getPublicDemarches("fr");
    const en = await getPublicDemarches("en");
    expect(fr[0].name).toBe("Signaler un problème de voirie");
    expect(en[0].name).toBe("Report a road problem");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("garde le cache tant qu'on reste dans la même langue", async () => {
    const fetchMock = vi.fn(async () => respond(200, SNAPSHOT));
    vi.stubGlobal("fetch", fetchMock);

    await getCurrentTenant("en");
    await getPublicDemarches("en");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
