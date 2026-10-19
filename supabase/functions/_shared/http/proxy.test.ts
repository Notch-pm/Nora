import { describe, expect, it } from "vitest";
import {
  PROXY_CLIENT_IP_HEADER,
  PROXY_HOST_HEADER,
  PROXY_SECRET_HEADER,
  readableIp,
  readProxyContext,
  visitorAddress,
} from "./proxy.ts";

const SECRET = "s".repeat(40);

function headers(extra: Record<string, string>): Headers {
  return new Headers(extra);
}

describe("readProxyContext", () => {
  it("reconnaît le Worker à son secret, et lui prend l'hôte et l'adresse", () => {
    const context = readProxyContext(
      headers({
        [PROXY_SECRET_HEADER]: SECRET,
        [PROXY_HOST_HEADER]: "Sceaux.Edilumen.fr",
        [PROXY_CLIENT_IP_HEADER]: "203.0.113.9",
      }),
      SECRET,
    );
    expect(context).toEqual({ proxied: true, host: "sceaux.edilumen.fr", clientIp: "203.0.113.9" });
  });

  it("ignore les en-têtes certifiés posés sans le bon secret", () => {
    const forged = headers({
      [PROXY_SECRET_HEADER]: "x".repeat(40),
      [PROXY_HOST_HEADER]: "sceaux.edilumen.fr",
    });
    expect(readProxyContext(forged, SECRET)).toEqual({ proxied: false });
    expect(readProxyContext(headers({ [PROXY_HOST_HEADER]: "sceaux.edilumen.fr" }), SECRET)).toEqual({
      proxied: false,
    });
  });

  it("ne reconnaît personne sans secret configuré, ou avec un secret trop court", () => {
    const sent = headers({ [PROXY_SECRET_HEADER]: "court", [PROXY_HOST_HEADER]: "sceaux.edilumen.fr" });
    expect(readProxyContext(sent, undefined)).toEqual({ proxied: false });
    expect(readProxyContext(sent, "")).toEqual({ proxied: false });
    expect(readProxyContext(sent, "court")).toEqual({ proxied: false });
  });

  it("refuse un hôte qui ne peut pas être un domaine", () => {
    const sent = headers({ [PROXY_SECRET_HEADER]: SECRET, [PROXY_HOST_HEADER]: "pas un domaine" });
    expect(readProxyContext(sent, SECRET)).toEqual({ proxied: false });
  });

  it("garde l'hôte mais écarte une adresse illisible", () => {
    const sent = headers({
      [PROXY_SECRET_HEADER]: SECRET,
      [PROXY_HOST_HEADER]: "sceaux.edilumen.fr",
      [PROXY_CLIENT_IP_HEADER]: "999.1.1.1",
    });
    expect(readProxyContext(sent, SECRET)).toEqual({ proxied: true, host: "sceaux.edilumen.fr", clientIp: null });
  });
});

describe("readableIp", () => {
  it("accepte IPv4 et IPv6, refuse le reste", () => {
    expect(readableIp("198.51.100.7")).toBe("198.51.100.7");
    expect(readableIp("2001:db8::1")).toBe("2001:db8::1");
    expect(readableIp("256.0.0.1")).toBeNull();
    expect(readableIp("inconnue")).toBeNull();
    expect(readableIp("")).toBeNull();
    expect(readableIp(null)).toBeNull();
  });
});

describe("visitorAddress", () => {
  it("prend l'adresse certifiée par le proxy plutôt que celle de la passerelle", () => {
    const sent = headers({ "x-forwarded-for": "104.16.0.1" });
    expect(visitorAddress(sent, { proxied: true, host: "sceaux.edilumen.fr", clientIp: "203.0.113.9" })).toBe(
      "203.0.113.9",
    );
    expect(visitorAddress(sent, { proxied: false })).toBe("104.16.0.1");
    expect(visitorAddress(sent, { proxied: true, host: "sceaux.edilumen.fr", clientIp: null })).toBe("104.16.0.1");
  });
});
