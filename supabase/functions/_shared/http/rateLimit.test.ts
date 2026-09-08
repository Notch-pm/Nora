import { describe, expect, it } from "vitest";
import { clientAddress, createRateLimiter, hashKey } from "./rateLimit.ts";

describe("createRateLimiter", () => {
  it("accepte jusqu'à la borne, puis refuse dans la fenêtre, puis libère", () => {
    let clock = 1_000;
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3, now: () => clock });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    // Un autre visiteur n'est pas pénalisé.
    expect(limiter.allow("b")).toBe(true);
    // La fenêtre passée, le compteur repart.
    clock += 60_001;
    expect(limiter.allow("a")).toBe(true);
  });

  it("un refus ne compte pas comme un appel", () => {
    let clock = 0;
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1, now: () => clock });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    clock = 1_001;
    expect(limiter.allow("a")).toBe(true);
  });
});

describe("clientAddress", () => {
  it("prend la première adresse transmise, sinon un repli", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientAddress(new Headers({ "cf-connecting-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientAddress(new Headers())).toBe("inconnue");
  });
});

describe("hashKey", () => {
  it("hache en SHA-256 : l'adresse n'est jamais conservée en clair", async () => {
    expect(await hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
