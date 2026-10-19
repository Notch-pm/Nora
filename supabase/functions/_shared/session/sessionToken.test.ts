import { describe, expect, it } from "vitest";
import {
  clearedSessionCookie,
  newSessionToken,
  readSessionToken,
  SESSION_COOKIE,
  sessionCookie,
  sessionIdHash,
} from "./sessionToken.ts";

describe("newSessionToken", () => {
  it("produit 43 caractères base64url, jamais deux fois le même", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });
});

describe("sessionIdHash", () => {
  it("ne garde du jeton que son SHA-256 hexadécimal", async () => {
    const token = newSessionToken();
    const hash = await sessionIdHash(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(await sessionIdHash(token)).toBe(hash);
  });
});

describe("readSessionToken", () => {
  const token = "A".repeat(43);

  it("lit le jeton parmi les autres cookies", () => {
    expect(readSessionToken(`theme=sombre; ${SESSION_COOKIE}=${token}; lang=fr`)).toBe(token);
  });

  it("traite un jeton mal formé ou absent comme pas de session", () => {
    expect(readSessionToken(null)).toBeNull();
    expect(readSessionToken("")).toBeNull();
    expect(readSessionToken("theme=sombre")).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}=trop-court`)).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}=${token}'--`)).toBeNull();
  });

  it("ne confond pas un cookie au nom voisin", () => {
    expect(readSessionToken(`x${SESSION_COOKIE}=${token}`)).toBeNull();
  });
});

describe("sessionCookie", () => {
  it("pose un cookie __Host- HttpOnly, Secure, SameSite=Lax, sans Domain", () => {
    const cookie = sessionCookie("A".repeat(43));
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain");
    expect(cookie).not.toContain("Max-Age");
  });

  it("« rester connecté » : le cookie survit à la fermeture du navigateur", () => {
    expect(sessionCookie("A".repeat(43), 2_592_000)).toContain("Max-Age=2592000");
  });

  it("l'effacement vide le cookie et l'expire", () => {
    expect(clearedSessionCookie()).toBe(`${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
  });
});
