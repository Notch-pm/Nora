/**
 * Le client Iris : ce qui part sur le fil. La clé est PLATEFORME, donc c'est
 * l'en-tête qui dit pour quelle collectivité le portail agit — sur CHAQUE
 * appel, le dépôt d'un fichier compris (il n'a pas d'enveloppe pour le dire).
 */
import { describe, expect, it, vi } from "vitest";
import { createIrisClient } from "./irisClient.ts";

const ROSNY = "9bd0fe9b-ff62-462e-915e-6fa539065a49";

function capture(status = 201, body: unknown = { request: { id: "r1" } }) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetchImpl);
  return calls;
}

describe("le client Iris nomme la collectivité à chaque appel", () => {
  it("dépôt d'une demande : la clé plateforme ET l'identifiant Socle de la racine", async () => {
    const calls = capture();
    const iris = createIrisClient({ baseUrl: "https://iris.test/requests-api/", apiKey: "irs_x", socleRootOrganizationId: ROSNY });
    const reply = await iris.post("/v1/requests", { a: 1 });
    expect(reply.kind).toBe("ok");
    expect(calls[0].url).toBe("https://iris.test/requests-api/v1/requests");
    expect(calls[0].headers).toMatchObject({
      Authorization: "Bearer irs_x",
      "X-Socle-Root-Organization-Id": ROSNY,
      "Content-Type": "application/json",
    });
  });

  it("⚠️ dépôt d'un FICHIER aussi : sans enveloppe, l'en-tête est le seul à dire pour qui", async () => {
    const calls = capture(201, { upload: { upload_id: "u1" } });
    const iris = createIrisClient({ baseUrl: "https://iris.test", apiKey: "irs_x", socleRootOrganizationId: ROSNY });
    await iris.postMultipart("/v1/uploads", new Blob(["x"]), "photo.jpg");
    expect(calls[0].headers["X-Socle-Root-Organization-Id"]).toBe(ROSNY);
    // Pas de Content-Type imposé : fetch pose la frontière multipart lui-même.
    expect(calls[0].headers["Content-Type"]).toBeUndefined();
  });

  it("une collectivité qu'Iris ne connaît pas (403) se lit comme une clé refusée : `auth_failed`", async () => {
    capture(403, { error: { code: "forbidden", message: "Collectivité inconnue d'Iris." } });
    const iris = createIrisClient({ baseUrl: "https://iris.test", apiKey: "irs_x", socleRootOrganizationId: ROSNY });
    expect((await iris.post("/v1/requests", {})).kind).toBe("auth_failed");
  });
});
