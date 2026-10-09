/**
 * Le client Clara : ce qui part sur le fil (la clé du portail en Bearer, un
 * envoi multipart sans Content-Type imposé), et la lecture des réponses du
 * contrat `nora-courrier`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaraClient } from "./claraClient.ts";

const URL_CLARA = "https://clara.test/functions/v1/nora-courrier";

function replying(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body === null ? "pas du json" : JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("le client Clara", () => {
  it("poste à l'URL de la fonction, avec la clé en Bearer et le formulaire tel quel", async () => {
    const calls = replying(200, { ok: true, courier_id: "c1", reference: "2026-000042" });
    const form = new FormData();
    form.append("subject", "Objet");
    const reply = await createClaraClient({ url: URL_CLARA, apiKey: "clara_secret" }).postCourrier(form);

    expect(reply).toEqual({ kind: "ok", body: { ok: true, courier_id: "c1", reference: "2026-000042" } });
    expect(calls[0].url).toBe(URL_CLARA);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ Authorization: "Bearer clara_secret" });
    // Pas de Content-Type imposé : fetch pose la frontière multipart lui-même.
    expect(calls[0].init.body).toBe(form);
  });

  it("lit chaque réponse du contrat", async () => {
    const client = createClaraClient({ url: URL_CLARA, apiKey: "k" });
    const cases: [number, unknown, string][] = [
      [400, { error: "validation", message: "subject requis" }, "validation"],
      [401, { error: "unauthorized" }, "unauthorized"],
      [404, { error: "organisme_inconnu" }, "organisme_inconnu"],
      [409, { error: "organisme_ambigu" }, "organisme_ambigu"],
      [500, { error: "internal" }, "failed"],
      [200, null, "unexpected"],
    ];
    for (const [status, body, kind] of cases) {
      replying(status, body);
      expect((await client.postCourrier(new FormData())).kind, String(status)).toBe(kind);
    }
  });

  it("garde le message d'une erreur de validation — pour le journal", async () => {
    replying(400, { error: "validation", message: "subject requis" });
    expect(await createClaraClient({ url: URL_CLARA, apiKey: "k" }).postCourrier(new FormData())).toEqual({
      kind: "validation",
      message: "subject requis",
    });
  });

  it("⚠️ un 404 de la PLATEFORME (fonction absente) n'est pas un organisme inconnu", async () => {
    replying(404, { code: "NOT_FOUND", message: "Requested function was not found" });
    expect((await createClaraClient({ url: URL_CLARA, apiKey: "k" }).postCourrier(new FormData())).kind).toBe(
      "unexpected",
    );
  });

  it("un réseau coupé est `unreachable`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect((await createClaraClient({ url: URL_CLARA, apiKey: "k" }).postCourrier(new FormData())).kind).toBe(
      "unreachable",
    );
  });
});
