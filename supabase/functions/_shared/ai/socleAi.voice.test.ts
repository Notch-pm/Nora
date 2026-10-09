import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeWav } from "../domain/voice.ts";
import { createSocleAiClient } from "./socleAi.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const ACTOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const client = () => createSocleAiClient({ baseUrl: "https://socle.test/functions/v1/ai-api/", apiKey: "cle-ai" });

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("la voix au guichet du Socle (ai-api 1.4.0)", () => {
  it("transcrire : le fichier, la durée, la langue et la conversation — rien d'autre", async () => {
    const fetchMock = stubFetch(new Response(JSON.stringify({ text: "  Bonjour.  " }), { status: 200 }));
    const audio = encodeWav(new Float32Array(16_000));
    const result = await client().transcribe({ organizationId: ORG, audio, durationMs: 1000.4, language: "fr", actorId: ACTOR });
    expect(result).toEqual({ kind: "ok", text: "Bonjour." });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://socle.test/functions/v1/ai-api/v1/transcriptions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer cle-ai");
    expect(headers["X-Organization-Id"]).toBe(ORG);
    // Le navigateur pose lui-même la frontière multipart : surtout pas de Content-Type à la main.
    expect(headers["Content-Type"]).toBeUndefined();
    const form = init.body as FormData;
    expect([...form.keys()].sort()).toEqual(["actor_id", "duration_ms", "feature", "file", "language"]);
    expect(form.get("duration_ms")).toBe("1000");
    expect(form.get("actor_id")).toBe(ACTOR);
    expect((form.get("file") as Blob).type).toBe("audio/wav");
  });

  it("un silence n'est pas une panne ; une réponse sans texte, si", async () => {
    stubFetch(new Response(JSON.stringify({ text: "" }), { status: 200 }));
    expect(await client().transcribe({ organizationId: ORG, audio: encodeWav(new Float32Array(8)), durationMs: 1, language: null, actorId: ACTOR }))
      .toEqual({ kind: "ok", text: "" });
    stubFetch(new Response(JSON.stringify({}), { status: 200 }));
    expect((await client().transcribe({ organizationId: ORG, audio: encodeWav(new Float32Array(8)), durationMs: 1, language: null, actorId: ACTOR })).kind)
      .toBe("unavailable");
  });

  it("prononcer : la langue, jamais la voix — et l'audio revient tel quel", async () => {
    const fetchMock = stubFetch(new Response(new Uint8Array([73, 68, 51]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }));
    const result = await client().speak({ organizationId: ORG, text: "Bonjour.", language: "fr", actorId: ACTOR });
    expect(result).toEqual({ kind: "ok", audio: new Uint8Array([73, 68, 51]), contentType: "audio/mpeg" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://socle.test/functions/v1/ai-api/v1/speech");
    expect(JSON.parse(init.body as string)).toEqual({
      feature: "assistant-usager",
      text: "Bonjour.",
      language: "fr",
      format: "mp3",
      actor_id: ACTOR,
    });
  });

  it("un 200 qui n'est pas de l'audio n'est pas joué", async () => {
    stubFetch(new Response(JSON.stringify({ oops: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect((await client().speak({ organizationId: ORG, text: "x", language: "fr", actorId: ACTOR })).kind).toBe("unavailable");
  });

  it("classe les refus comme la conversation : plafond, cadence, configuration", async () => {
    stubFetch(new Response(JSON.stringify({ error: { code: "ai_quota_exceeded", message: "Plafond." } }), { status: 429 }));
    expect(await client().speak({ organizationId: ORG, text: "x", language: "fr", actorId: ACTOR }))
      .toEqual({ kind: "quota_exceeded", message: "Plafond." });
    stubFetch(new Response(JSON.stringify({ error: { code: "ai_rate_limited" } }), { status: 429, headers: { "Retry-After": "7" } }));
    expect(await client().speak({ organizationId: ORG, text: "x", language: "fr", actorId: ACTOR }))
      .toEqual({ kind: "rate_limited", retryAfterSeconds: 7 });
    stubFetch(new Response(JSON.stringify({ error: { code: "bad_request" } }), { status: 400 }));
    expect((await client().speak({ organizationId: ORG, text: "x", language: "es", actorId: ACTOR })).kind).toBe("not_configured");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("réseau"); }));
    expect((await client().speak({ organizationId: ORG, text: "x", language: "fr", actorId: ACTOR })).kind).toBe("unavailable");
  });
});
