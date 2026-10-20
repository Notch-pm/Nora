import { describe, expect, it } from "vitest";
import { irisTokenSecret, signCitizenToken } from "./citizenToken.ts";

const SECRET = "i".repeat(48);
const TENANT = "8f1e0d3a-0000-4000-8000-0000000000a1";
const CONTACT = "cccccccc-0000-4000-8000-000000000001";
const REQUEST = "dddddddd-0000-4000-8000-000000000002";
const NOW = 1_800_000_000;

function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
}

describe("irisTokenSecret", () => {
  it("exige 32 caractères au moins ; sinon aucun jeton ne se signe", () => {
    expect(irisTokenSecret(undefined)).toBeNull();
    expect(irisTokenSecret("")).toBeNull();
    expect(irisTokenSecret("c".repeat(31))).toBeNull();
    expect(irisTokenSecret("c".repeat(32))).toBe("c".repeat(32));
  });
});

describe("signCitizenToken", () => {
  it("jeton de fiche : lié à la collectivité, à la fiche, à l'adresse du compte, valable 120 secondes", async () => {
    const token = await signCitizenToken(SECRET, TENANT, { kind: "contact", id: CONTACT, email: "camille@example.org" }, NOW);
    expect(payloadOf(token)).toEqual({ v: 1, t: TENANT, sub: `contact:${CONTACT}`, exp: NOW + 120, e: "camille@example.org" });
  });

  it("jeton d'invité : lié à UNE demande, sans adresse", async () => {
    const token = await signCitizenToken(SECRET, TENANT, { kind: "request", id: REQUEST }, NOW);
    const payload = payloadOf(token);
    expect(payload.sub).toBe(`request:${REQUEST}`);
    expect(payload).not.toHaveProperty("e");
  });

  it("signature HMAC-SHA256 : deux secrets, deux signatures ; une charge altérée ne garde pas la sienne", async () => {
    const a = await signCitizenToken(SECRET, TENANT, { kind: "request", id: REQUEST }, NOW);
    const b = await signCitizenToken("j".repeat(48), TENANT, { kind: "request", id: REQUEST }, NOW);
    expect(a.split(".")[0]).toBe(b.split(".")[0]);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
    const other = await signCitizenToken(SECRET, TENANT, { kind: "request", id: CONTACT }, NOW);
    expect(other.split(".")[1]).not.toBe(a.split(".")[1]);
  });

  it("deux collectivités, deux jetons : le jeton de Sceaux ne dit pas Antony", async () => {
    const a = await signCitizenToken(SECRET, TENANT, { kind: "request", id: REQUEST }, NOW);
    const b = await signCitizenToken(SECRET, "8f1e0d3a-0000-4000-8000-0000000000b2", { kind: "request", id: REQUEST }, NOW);
    expect(a).not.toBe(b);
  });

  it("base64url sans remplissage, aucun caractère d'en-tête dangereux", async () => {
    const token = await signCitizenToken(SECRET, TENANT, { kind: "contact", id: CONTACT, email: "a+b@example.org" }, NOW);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  // VECTEURS DE RÉFÉRENCE — le MÊME couple (secret, instant, sujet) → le MÊME jeton figure dans
  // le test d'Iris (`citizenToken.contract.test.ts`, qui vérifie ce jeton). Si l'un des deux
  // dépôts change de format, l'autre échoue : c'est le test de contrat entre Nora et Iris.
  it("vecteur de référence partagé avec Iris (fiche)", async () => {
    expect(await signCitizenToken(SECRET, TENANT, { kind: "contact", id: CONTACT, email: "camille@example.org" }, NOW)).toBe(
      "eyJ2IjoxLCJ0IjoiOGYxZTBkM2EtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMGExIiwic3ViIjoiY29udGFjdDpjY2NjY2NjYy0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJleHAiOjE4MDAwMDAxMjAsImUiOiJjYW1pbGxlQGV4YW1wbGUub3JnIn0.aFRIySbti6iw_uB9Yrrf1sA3HlX_ToEPV3G1oDl8pLQ",
    );
  });

  it("vecteur de référence partagé avec Iris (invité)", async () => {
    expect(await signCitizenToken(SECRET, TENANT, { kind: "request", id: REQUEST }, NOW)).toBe(
      "eyJ2IjoxLCJ0IjoiOGYxZTBkM2EtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMGExIiwic3ViIjoicmVxdWVzdDpkZGRkZGRkZC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDIiLCJleHAiOjE4MDAwMDAxMjB9.KGp11Lc5zFg0v8gTISBJWqb8-8c0dQCq3mScWx-o3H0",
    );
  });
});
