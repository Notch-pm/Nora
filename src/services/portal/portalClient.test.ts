/**
 * L'interface et `portal-api` ne se déploient pas ensemble : l'une part sur
 * Cloudflare au push, l'autre sur Supabase à la main. Ce qui est vérifié ici,
 * c'est qu'une interface plus récente que sa fonction reste debout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAssistantChallenge, fetchDemarche, sendAssistantTurn } from "./portalClient.ts";

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

describe("fetchAssistantChallenge", () => {
  it("rend le défi tel que `portal-api` le sert", async () => {
    const challenge = { salt: "s", bits: 15, expires: 123, signature: "sig" };
    vi.stubGlobal("fetch", vi.fn(async () => respond({ challenge })));
    const result = await fetchAssistantChallenge();
    expect(result).toEqual({ ok: true, challenge });
  });

  it("un défi à moitié lu est une indisponibilité, pas un défi tronqué", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ challenge: { salt: "s" } })));
    const result = await fetchAssistantChallenge();
    expect(result).toEqual({ ok: false, reason: "assistant_unavailable" });
  });

  it("lit le code d'échec du serveur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "assistant_closed" } }), { status: 404 }),
      ),
    );
    const result = await fetchAssistantChallenge();
    expect(result).toEqual({ ok: false, reason: "assistant_closed" });
  });

  it("une panne réseau ne lève pas — elle rend `network`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const result = await fetchAssistantChallenge();
    expect(result).toEqual({ ok: false, reason: "network" });
  });

  it("sans `VITE_PORTAL_API_URL`, aucun appel n'est tenté", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchAssistantChallenge();
    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendAssistantTurn", () => {
  const REQUEST = {
    challenge: { salt: "s", bits: 15, expires: 123, signature: "sig", nonce: "0" },
    messages: [{ role: "user" as const, content: "Bonjour" }],
    lang: "fr",
  };

  it("rend la réponse telle que le serveur la signe", async () => {
    const reply = {
      ticket: "t2",
      message: { role: "assistant", content: "Bonjour, que puis-je faire ?", signature: "sig2" },
      suggestions: [{ id: "d1", name: "Recensement", description: null }],
      emergency: false,
      turnsLeft: 19,
      collection: { demarcheId: "d1", values: { f1: "12 rue de la Paix" }, skipped: [] },
      asking: ["f2"],
      collectOffer: { id: "d1", name: "Recensement" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => respond(reply)));
    const result = await sendAssistantTurn(REQUEST);
    expect(result).toEqual({ ok: true, reply });
  });

  it("⚠️ une offre ou une demande mal formées ne passent pas pour telles", async () => {
    // Le serveur les a déjà revalidées ; ici on ne lit que la FORME, et une
    // forme douteuse vaut « rien », jamais un objet à moitié rempli.
    const reply = {
      ticket: "t2",
      message: { role: "assistant", content: "Bonjour.", signature: "sig2" },
      suggestions: [],
      emergency: false,
      turnsLeft: 19,
      collection: null,
      asking: ["f2", 42, ""],
      collectOffer: { id: "d1" },
    };
    vi.stubGlobal("fetch", vi.fn(async () => respond(reply)));
    const result = await sendAssistantTurn(REQUEST);
    expect(result.ok && result.reply.asking).toEqual(["f2", ""]);
    expect(result.ok && result.reply.collectOffer).toBeNull();
  });

  it("un serveur d'avant le recueil n'en rend pas : `collection` vaut null, jamais un trou", async () => {
    const reply = {
      ticket: "t2",
      message: { role: "assistant", content: "Bonjour.", signature: "sig2" },
      suggestions: [],
      emergency: false,
      turnsLeft: 19,
    };
    for (const collection of [undefined, null, "x", [], { demarcheId: "", values: {} }, { demarcheId: "d1", values: [] }]) {
      vi.stubGlobal("fetch", vi.fn(async () => respond({ ...reply, collection })));
      const result = await sendAssistantTurn(REQUEST);
      expect(result.ok && result.reply.collection).toBeNull();
    }
  });

  it("écarte une suggestion sans identifiant ou sans nom, sans faire échouer le tour", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond({
          ticket: "t2",
          message: { role: "assistant", content: "Voici", signature: "sig2" },
          suggestions: [{ id: "d1", name: "", description: null }, { id: "d2", name: "Voirie", description: "x" }],
          emergency: false,
          turnsLeft: 19,
        }),
      ),
    );
    const result = await sendAssistantTurn(REQUEST);
    expect(result.ok && result.reply.suggestions).toEqual([{ id: "d2", name: "Voirie", description: "x" }]);
  });

  it("une réponse sans signature est une indisponibilité — jamais affichée telle quelle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond({
          ticket: "t2",
          message: { role: "assistant", content: "Bonjour" },
          suggestions: [],
          emergency: false,
          turnsLeft: 19,
        }),
      ),
    );
    const result = await sendAssistantTurn(REQUEST);
    expect(result).toEqual({ ok: false, reason: "assistant_unavailable" });
  });

  it("remonte le délai d'un échec cadencé", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: "assistant_rate_limited", retryAfterSeconds: 17 } }),
          { status: 429 },
        ),
      ),
    );
    const result = await sendAssistantTurn(REQUEST);
    expect(result).toEqual({ ok: false, reason: "assistant_rate_limited", retryAfterSeconds: 17 });
  });

  it("un ticket périmé rend `challenge_required`, sans délai", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "challenge_required" } }), { status: 401 }),
      ),
    );
    const result = await sendAssistantTurn(REQUEST);
    expect(result).toEqual({ ok: false, reason: "challenge_required" });
  });
});
