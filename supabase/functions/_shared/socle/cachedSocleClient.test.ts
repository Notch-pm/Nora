import { describe, expect, it } from "vitest";
import { withCache } from "./cachedSocleClient.ts";
import type { SocleClient, SocleReply } from "./socleClient.ts";

/** Compte les appels réellement passés au Socle. */
function counting(reply: SocleReply | ((path: string) => SocleReply)) {
  const calls: string[] = [];
  const client: SocleClient = {
    get: async (path) => {
      calls.push(path);
      return typeof reply === "function" ? reply(path) : reply;
    },
  };
  return { client, calls };
}

/** Horloge contrôlée : aucun test n'a à attendre une seconde. */
function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe("withCache — ce qui est mémorisé", () => {
  it("ne rappelle pas le Socle pendant la durée de vie", async () => {
    const { client, calls } = counting({ kind: "ok", body: { id: "org-1" } });
    const cached = withCache(client, { ttlMs: 60_000, now: clock().now });

    await cached.get("/v1/portal/tenant?hostname=nantes.edilumen.fr");
    await cached.get("/v1/portal/tenant?hostname=nantes.edilumen.fr");
    expect(calls).toHaveLength(1);
  });

  it("mémorise chaque chemin séparément", async () => {
    // Le cache est au niveau du PORT : résolution de domaine et démarches sont
    // deux chemins, donc deux entrées — et le décorateur couvre les deux sans
    // rien savoir de ce qu'ils signifient.
    const { client, calls } = counting({ kind: "ok", body: [] });
    const cached = withCache(client, { ttlMs: 60_000, now: clock().now });

    await cached.get("/v1/portal/tenant?hostname=nantes.edilumen.fr");
    await cached.get("/v1/portal/procedures?tenant_id=org-1");
    await cached.get("/v1/portal/tenant?hostname=nantes.edilumen.fr");
    expect(calls).toEqual([
      "/v1/portal/tenant?hostname=nantes.edilumen.fr",
      "/v1/portal/procedures?tenant_id=org-1",
    ]);
  });

  it("rappelle le Socle une fois la durée de vie écoulée", async () => {
    const { client, calls } = counting({ kind: "ok", body: {} });
    const time = clock();
    const cached = withCache(client, { ttlMs: 60_000, now: time.now });

    await cached.get("/x");
    time.advance(60_001);
    await cached.get("/x");
    expect(calls).toHaveLength(2);
  });

  it("mémorise un 404 : un domaine inconnu est un fait stable", async () => {
    // Sans cela, un robot essayant mille sous-domaines produirait mille appels
    // au Socle — et c'est exactement le trafic qu'un portail public reçoit.
    const { client, calls } = counting({ kind: "not_found" });
    const cached = withCache(client, { ttlMs: 60_000, now: clock().now });

    await cached.get("/v1/portal/tenant?hostname=inconnu.edilumen.fr");
    await cached.get("/v1/portal/tenant?hostname=inconnu.edilumen.fr");
    expect(calls).toHaveLength(1);
  });
});

describe("withCache — ce qui ne l'est PAS", () => {
  it("ne mémorise aucune panne", async () => {
    // Mémoriser une indisponibilité la ferait durer après le rétablissement :
    // le portail resterait en erreur une minute de plus que sa cause.
    for (const kind of ["unreachable", "auth_failed", "unexpected"] as const) {
      const { client, calls } = counting({ kind });
      const cached = withCache(client, { ttlMs: 60_000, now: clock().now });
      await cached.get("/x");
      await cached.get("/x");
      expect(calls, kind).toHaveLength(2);
    }
  });

  it("se désactive entièrement avec une durée de vie nulle", async () => {
    // Le cache doit se couper par CONFIGURATION, sans changement de code.
    const { client, calls } = counting({ kind: "ok", body: {} });
    const cached = withCache(client, { ttlMs: 0 });
    expect(cached).toBe(client);

    await cached.get("/x");
    await cached.get("/x");
    expect(calls).toHaveLength(2);
  });

  it("repart de zéro plutôt que de gonfler sans fin", async () => {
    // Le portail interroge peu de chemins distincts : une table qui déborde
    // signale un balayage de sous-domaines, pas un usage normal. On la vide,
    // plutôt que d'entretenir une éviction fine dont personne n'a besoin ici.
    const { client, calls } = counting((path) => ({ kind: "ok", body: path }));
    const cached = withCache(client, { ttlMs: 60_000, maxEntries: 2, now: clock().now });

    await cached.get("/a");
    await cached.get("/b");
    await cached.get("/c"); // Table pleine : elle est vidée, puis /c mémorisé.
    expect(calls).toEqual(["/a", "/b", "/c"]);

    await cached.get("/c"); // Toujours en cache.
    await cached.get("/a"); // Oublié avec le reste : rappelé.
    expect(calls).toEqual(["/a", "/b", "/c", "/a"]);
  });
});
