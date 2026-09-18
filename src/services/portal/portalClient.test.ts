/**
 * L'interface et `portal-api` ne se déploient pas ensemble : l'une part sur
 * Cloudflare au push, l'autre sur Supabase à la main. Ce qui est vérifié ici,
 * c'est qu'une interface plus récente que sa fonction reste debout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDemarche } from "./portalClient.ts";

const TENANT = { id: "org-1", name: "ACCM", slug: "laurentville", hostname: "laurentville.edilumen.fr" };

/** Une démarche telle que la servait un `portal-api` d'avant le contrat 1.24.0. */
const DEMARCHE_AVANT = {
  id: "d1",
  name: "Recensement citoyen à 16 ans",
  description: "Recensement obligatoire des jeunes de 16 ans.",
  estimatedMinutes: 8,
  organizations: [],
  audiences: ["citoyen"],
  category: null,
  userDescription: null,
  form: null,
  requester: {},
};

function respond(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("VITE_PORTAL_API_URL", "https://portal-api.example");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchDemarche — une fonction plus ancienne que l'interface", () => {
  it("sans `userCommunication`, rend des blocs vides : la page d'avant, exactement", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ lang: "fr", tenant: TENANT, demarche: DEMARCHE_AVANT })));
    const result = await fetchDemarche("d1", "fr");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.demarche.userCommunication).toEqual({
      responseDelay: null,
      audienceNote: null,
      announcedPieces: [],
      faq: [],
    });
  });

  it("transmet tel quel ce qu'une fonction à jour a déjà lu", async () => {
    const userCommunication = {
      responseDelay: { value: 15, unit: "jour" },
      audienceNote: null,
      announcedPieces: [{ label: "Le livret de famille", description: null }],
      faq: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond({ lang: "fr", tenant: TENANT, demarche: { ...DEMARCHE_AVANT, userCommunication } }),
      ),
    );
    const result = await fetchDemarche("d1", "fr");
    expect(result.ok && result.snapshot.demarche.userCommunication).toEqual(userCommunication);
  });
});
