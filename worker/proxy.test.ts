import { describe, expect, it } from "vitest";
import { isApiPath, upstreamRequest } from "./proxy.ts";

const ENV = {
  PORTAL_API_URL: "https://ref.supabase.co/functions/v1/portal-api/",
  NORA_PROXY_SECRET: "s".repeat(40),
};

describe("isApiPath", () => {
  it("ne relaie que /api et ce qui est dessous", () => {
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/api/v1/bootstrap")).toBe(true);
    expect(isApiPath("/apiculture")).toBe(false);
    expect(isApiPath("/demarches/api")).toBe(false);
  });
});

describe("upstreamRequest", () => {
  it("relaie vers portal-api en certifiant l'hôte et l'adresse", () => {
    const incoming = new Request("https://sceaux.edilumen.fr/api/v1/session?lang=fr", {
      headers: { cookie: "__Host-nora_sid=abc", "cf-connecting-ip": "203.0.113.9", accept: "application/json" },
    });
    const upstream = upstreamRequest(incoming, ENV);
    expect(upstream).toBeInstanceOf(Request);
    const req = upstream as Request;
    expect(req.url).toBe("https://ref.supabase.co/functions/v1/portal-api/v1/session?lang=fr");
    expect(req.headers.get("x-nora-host")).toBe("sceaux.edilumen.fr");
    expect(req.headers.get("x-nora-client-ip")).toBe("203.0.113.9");
    expect(req.headers.get("x-nora-proxy-secret")).toBe(ENV.NORA_PROXY_SECRET);
    expect(req.headers.get("cookie")).toBe("__Host-nora_sid=abc");
  });

  it("n'accepte pas d'en-têtes certifiés posés par le visiteur", () => {
    const incoming = new Request("https://sceaux.edilumen.fr/api/v1/session", {
      headers: {
        "x-nora-host": "antony.edilumen.fr",
        "x-nora-client-ip": "10.0.0.1",
        "x-nora-proxy-secret": "devine",
        "x-forwarded-for": "10.0.0.2",
        authorization: "Bearer volé",
      },
    });
    const req = upstreamRequest(incoming, ENV) as Request;
    expect(req.headers.get("x-nora-host")).toBe("sceaux.edilumen.fr");
    expect(req.headers.get("x-nora-client-ip")).toBeNull();
    expect(req.headers.get("x-nora-proxy-secret")).toBe(ENV.NORA_PROXY_SECRET);
    expect(req.headers.get("x-forwarded-for")).toBeNull();
    expect(req.headers.get("authorization")).toBeNull();
  });

  it("relaie le corps d'une écriture et l'en-tête du portail", async () => {
    const incoming = new Request("https://sceaux.edilumen.fr/api/v1/session/fin", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nora-request": "1" },
      body: JSON.stringify({ a: 1 }),
    });
    const req = upstreamRequest(incoming, ENV) as Request;
    expect(req.method).toBe("POST");
    expect(req.headers.get("x-nora-request")).toBe("1");
    expect(await req.text()).toBe('{"a":1}');
  });

  it("sans configuration complète, ne relaie rien", async () => {
    const incoming = new Request("https://sceaux.edilumen.fr/api/v1/bootstrap");
    for (const env of [{}, { PORTAL_API_URL: ENV.PORTAL_API_URL }, { ...ENV, NORA_PROXY_SECRET: "court" }]) {
      const result = upstreamRequest(incoming, env);
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(503);
    }
  });
});
