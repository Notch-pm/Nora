/**
 * Le relais de même origine face à un visiteur hostile : liste blanche
 * d'en-têtes (dans les deux sens), certification de l'hôte, chemins piégés,
 * redirections, corps. Complète `proxy.test.ts` (cas nominaux).
 */
import { describe, expect, it } from "vitest";
import worker from "./index.ts";
import { downstreamResponse, isApiPath, upstreamRequest } from "./proxy.ts";

const ENV = {
  PORTAL_API_URL: "https://ref.supabase.co/functions/v1/portal-api",
  NORA_PROXY_SECRET: "s".repeat(40),
};

const relay = (url: string, init: RequestInit = {}) => upstreamRequest(new Request(url, init), ENV) as Request;

describe("en-têtes du visiteur : liste blanche", () => {
  const HOSTILE = {
    authorization: "Bearer volé",
    apikey: "service-role-volée",
    "x-forwarded-for": "10.0.0.2",
    "x-forwarded-host": "antony.edilumen.fr",
    "x-real-ip": "10.0.0.3",
    forwarded: "for=10.0.0.4;host=antony.edilumen.fr",
    "x-nora-host": "antony.edilumen.fr",
    "x-nora-client-ip": "10.0.0.1",
    "x-nora-proxy-secret": "x".repeat(40),
    "x-region": "us-east-1",
    "x-citizen-token": "forgé.forgé",
    "x-socle-root-organization-id": "00000000-0000-4000-8000-000000000000",
    "x-organization-id": "00000000-0000-4000-8000-000000000000",
    "x-cron-secret": "devine",
    "x-supabase-api-version": "2024-01-01",
  };

  it("aucun en-tête d'identité, de tenant ou de clé ne traverse", () => {
    const req = relay("https://sceaux.edilumen.fr/api/v1/compte", { headers: HOSTILE });
    for (const name of Object.keys(HOSTILE)) {
      if (["x-nora-host", "x-nora-proxy-secret"].includes(name)) continue; // posés par le Worker lui-même
      expect(req.headers.get(name), name).toBeNull();
    }
    expect(req.headers.get("x-nora-host")).toBe("sceaux.edilumen.fr");
    expect(req.headers.get("x-nora-proxy-secret")).toBe(ENV.NORA_PROXY_SECRET);
  });

  it("seule l'adresse que Cloudflare certifie devient l'adresse du visiteur", () => {
    const req = relay("https://sceaux.edilumen.fr/api/v1/session", { headers: { "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "10.9.9.9" } });
    expect(req.headers.get("x-nora-client-ip")).toBe("203.0.113.5");
  });

  it("l'hôte certifié est celui de l'URL visitée, en minuscules, sans port", () => {
    expect(relay("https://SCEAUX.edilumen.fr/api/v1/session").headers.get("x-nora-host")).toBe("sceaux.edilumen.fr");
    expect(relay("http://sceaux.localhost:5175/api/v1/session").headers.get("x-nora-host")).toBe("sceaux.localhost");
  });

  it("les en-têtes du portail (cookie, origine, CSRF) sont conservés tels quels", () => {
    const req = relay("https://sceaux.edilumen.fr/api/v1/compte/connexion", {
      method: "POST",
      headers: { cookie: "__Host-nora_sid=abc", origin: "https://sceaux.edilumen.fr", "x-nora-request": "1", "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: "{}",
    });
    expect(req.headers.get("cookie")).toBe("__Host-nora_sid=abc");
    expect(req.headers.get("origin")).toBe("https://sceaux.edilumen.fr");
    expect(req.headers.get("x-nora-request")).toBe("1");
    expect(req.headers.get("sec-fetch-site")).toBe("same-origin");
  });
});

describe("chemins", () => {
  it("la requête, ses paramètres et son encodage sont relayés sans réécriture hasardeuse", () => {
    expect(relay("https://sceaux.edilumen.fr/api/v1/compte/demandes?avant=2026-01-01T00%3A00%3A00Z_x").url)
      .toBe("https://ref.supabase.co/functions/v1/portal-api/v1/compte/demandes?avant=2026-01-01T00%3A00%3A00Z_x");
  });

  it("seul le préfixe /api exact est relayé (casse, voisins, doubles barres)", () => {
    for (const path of ["/API/v1/session", "/apix/v1/session", "/x/api/v1/session", "/Api"]) expect(isApiPath(path), path).toBe(false);
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/")).toBe(true);
  });

  it("les points d'un chemin encodé sont résolus AVANT le choix du relais : /api/%2e%2e/ n'est plus de l'API", () => {
    // Le navigateur et `new URL` normalisent %2e%2e en « .. » : le Worker voit un autre chemin.
    expect(isApiPath(new URL("https://sceaux.edilumen.fr/api/%2e%2e/rest/v1/rpc/citizen_purge_auth_data").pathname)).toBe(false);
    expect(isApiPath(new URL("https://sceaux.edilumen.fr/api/../x").pathname)).toBe(false);
  });

  // O1 (défense en profondeur, corrigé) : `%2f` n'est PAS normalisé par `new URL` ; le relais
  // refuse lui-même un chemin qui contient une séquence de remontée encodée.
  it("O1 — un chemin contenant « ..%2f » ou « %2e%2e » encodé n'est pas relayé vers portal-api", () => {
    const result = upstreamRequest(new Request("https://sceaux.edilumen.fr/api/..%2f..%2frest/v1/rpc/citizen_purge_auth_data"), ENV);
    expect(result).toBeInstanceOf(Response);
  });
});

describe("corps et méthodes", () => {
  it("un GET ne porte pas de corps ; un POST relaie le sien en flux", async () => {
    expect(relay("https://sceaux.edilumen.fr/api/v1/session").body).toBeNull();
    const post = relay("https://sceaux.edilumen.fr/api/v1/suivi", { method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } });
    expect(await post.text()).toBe('{"a":1}');
  });

  it("les redirections de portal-api ne sont pas suivies par le Worker (la pièce signée part au navigateur)", () => {
    expect(relay("https://sceaux.edilumen.fr/api/v1/compte/demandes/x").redirect).toBe("manual");
    const res = downstreamResponse(new Response(null, { status: 302, headers: { location: "https://storage.example/signed?exp=60", "cache-control": "no-store" } }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example/signed?exp=60");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("réponse rendue au navigateur", () => {
  it("n'ouvre jamais le CORS ni ne laisse passer d'en-tête d'infrastructure", () => {
    const upstream = new Response("{}", {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST",
        "x-powered-by": "Deno",
        "sb-gateway-version": "1",
        "x-sb-edge-region": "eu-west-1",
        "set-cookie": "sb=1; Domain=supabase.co",
        vary: "Origin",
        "content-type": "application/json",
      },
    });
    const res = downstreamResponse(upstream);
    const names = [...res.headers.keys()].sort();
    expect(names).toEqual(["content-type", "x-content-type-options"]);
  });

  it("plusieurs cookies du portail sont tous rendus, les autres jamais", () => {
    const headers = new Headers();
    headers.append("set-cookie", "__Host-nora_sid=a; Path=/; Secure; HttpOnly; SameSite=Lax");
    headers.append("set-cookie", "__Host-nora_prefs=b; Path=/; Secure");
    headers.append("set-cookie", "tracker=c; Path=/");
    expect(downstreamResponse(new Response(null, { status: 204, headers })).headers.getSetCookie()).toHaveLength(2);
  });
});

describe("Worker complet (worker/index.ts)", () => {
  const env = { ...ENV, ASSETS: { fetch: async () => new Response("<html>asset</html>") } };

  it("les pages ne passent pas par le relais ; /api/* si", async () => {
    const asset = await worker.fetch(new Request("https://sceaux.edilumen.fr/compte/connexion"), env);
    expect(await asset.text()).toContain("asset");
  });

  it("portal-api injoignable : 502 JSON propre, sans détail d'infrastructure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.1.2.3:443 secret-host.internal");
    }) as typeof fetch;
    try {
      const res = await worker.fetch(new Request("https://sceaux.edilumen.fr/api/v1/session"), env);
      expect(res.status).toBe(502);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const text = await res.text();
      expect(JSON.parse(text).error.code).toBe("portal_unreachable");
      expect(text).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|secret-host/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("sans secret configuré, jamais de relais : 503, et aucun appel sortant", async () => {
    let called = false;
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    try {
      const res = await worker.fetch(new Request("https://sceaux.edilumen.fr/api/v1/session"), { ASSETS: env.ASSETS, PORTAL_API_URL: ENV.PORTAL_API_URL });
      expect(res.status).toBe(503);
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("le Worker ne lève jamais", () => {
  // A5 (constatée EN PRODUCTION le 2026-10-20, corrigée) — `GET /api/v1/session%`, `/api/v1/zzz%E0%A4%A`…
  // répondaient « 500 error code: 1101 » de Cloudflare (le Worker levait). Le chemin illisible est
  // désormais refusé en 404 JSON, et toute construction impossible de la requête sortante rend un
  // JSON 5xx — reproduite ici par une adresse de portal-api illisible.
  const env = { PORTAL_API_URL: "pas une url", NORA_PROXY_SECRET: "s".repeat(40), ASSETS: { fetch: async () => new Response("asset") } };

  it("A5 (encodage) — un « % » isolé ou des octets invalides rendent un 404 JSON", async () => {
    const ok = { ...env, PORTAL_API_URL: "https://ref.supabase.co/functions/v1/portal-api" };
    for (const path of ["/api/v1/session%", "/api/v1/zzz%E0%A4%A"]) {
      const res = await worker.fetch(new Request("https://sceaux.edilumen.fr" + path), ok);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/json/);
    }
  });

  it("A5 — une construction de requête sortante impossible rend un JSON 5xx, jamais une exception", async () => {
    const res = await worker.fetch(new Request("https://sceaux.edilumen.fr/api/v1/session"), env);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.headers.get("content-type")).toMatch(/json/);
  });
});
