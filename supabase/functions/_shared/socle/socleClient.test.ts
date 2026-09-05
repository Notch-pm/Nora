/**
 * Le client HTTP, contre un VRAI serveur.
 *
 * Partout ailleurs, `SocleClient` est remplacé par un stub — c'est l'intérêt du
 * port. Mais quelqu'un doit vérifier l'implémentation elle-même : que la clé
 * part bien en en-tête, qu'un 401 ne se confond pas avec un 404, et qu'un
 * serveur muet finit par rendre la main. C'est ce fichier, et lui seul, qui
 * exerce le réseau.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSocleClient } from "./socleClient.ts";

interface Route {
  status: number;
  body?: string;
  /** Ne répond jamais — pour éprouver le délai d'attente. */
  hang?: boolean;
}

let server: Server | null = null;
const received: Array<{ url: string; authorization: string | undefined }> = [];

/** Démarre un faux Socle et rend sa racine. */
async function startSocle(routes: Record<string, Route>): Promise<string> {
  server = createServer((request, response) => {
    received.push({
      url: request.url ?? "",
      authorization: request.headers.authorization,
    });
    const route = routes[request.url ?? ""] ?? { status: 404, body: JSON.stringify({}) };
    if (route.hang) return; // Volontairement sans réponse.
    response.writeHead(route.status, { "Content-Type": "application/json" });
    response.end(route.body ?? "{}");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server!.address() as AddressInfo;
  return "http://127.0.0.1:" + port;
}

afterEach(async () => {
  received.length = 0;
  if (server !== null) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe("createSocleClient", () => {
  it("porte la clé en Bearer et rend le corps JSON", async () => {
    const baseUrl = await startSocle({
      "/v1/portal/tenant?hostname=nantes.edilumen.fr": {
        status: 200,
        body: JSON.stringify({ id: "org-1", name: "Ville de Nantes" }),
      },
    });
    const socle = createSocleClient({ baseUrl, apiKey: "clé-secrète" });

    const reply = await socle.get("/v1/portal/tenant?hostname=nantes.edilumen.fr");
    expect(reply).toEqual({ kind: "ok", body: { id: "org-1", name: "Ville de Nantes" } });
    expect(received[0].authorization).toBe("Bearer clé-secrète");
  });

  it("tolère une barre finale dans l'URL configurée", async () => {
    // Une variable d'environnement recopiée à la main en porte une une fois sur
    // deux ; le portail ne doit pas se casser pour si peu.
    const baseUrl = await startSocle({ "/v1/ping": { status: 200, body: "{}" } });
    const socle = createSocleClient({ baseUrl: baseUrl + "///", apiKey: "k" });

    await socle.get("/v1/ping");
    expect(received[0].url).toBe("/v1/ping");
  });

  it("distingue les refus qui n'appellent pas la même réaction", async () => {
    const baseUrl = await startSocle({
      "/absent": { status: 404 },
      "/sans-cle": { status: 401 },
      "/mauvais-scope": { status: 403 },
      "/casse": { status: 500 },
    });
    const socle = createSocleClient({ baseUrl, apiKey: "k" });

    // 404 : la ressource n'existe pas — un domaine inconnu, cas ordinaire.
    expect(await socle.get("/absent")).toEqual({ kind: "not_found" });
    // 401/403 : NOTRE clé est en cause. Ce n'est jamais la faute du visiteur.
    expect(await socle.get("/sans-cle")).toEqual({ kind: "auth_failed" });
    expect(await socle.get("/mauvais-scope")).toEqual({ kind: "auth_failed" });
    // Le reste est une panne du Socle.
    expect(await socle.get("/casse")).toEqual({ kind: "unexpected" });
  });

  it("traite un corps illisible comme une réponse inattendue", async () => {
    // Un 200 qui n'est pas du JSON ne doit pas remonter en exception jusqu'à
    // l'écran : le portail rend une indisponibilité, pas une trace de pile.
    const baseUrl = await startSocle({ "/html": { status: 200, body: "<html>maintenance</html>" } });
    const socle = createSocleClient({ baseUrl, apiKey: "k" });

    expect(await socle.get("/html")).toEqual({ kind: "unexpected" });
  });

  it("rend la main quand le Socle ne répond pas", async () => {
    // Sans délai d'attente, l'onglet d'un usager tournerait indéfiniment sur
    // une panne réseau. Mieux vaut une page d'indisponibilité.
    const baseUrl = await startSocle({ "/muet": { status: 200, hang: true } });
    const socle = createSocleClient({ baseUrl, apiKey: "k", timeoutMs: 50 });

    expect(await socle.get("/muet")).toEqual({ kind: "unreachable" });
  });

  it("rend `unreachable` quand rien n'écoute", async () => {
    // Port fermé : c'est le Socle éteint, ou une URL mal configurée.
    const socle = createSocleClient({ baseUrl: "http://127.0.0.1:1", apiKey: "k" });
    expect(await socle.get("/v1/ping")).toEqual({ kind: "unreachable" });
  });
});
