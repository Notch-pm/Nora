import { describe, expect, it } from "vitest";
import { issueChallenge, solveChallenge } from "./challenge.ts";
import { checkDepositChallenge } from "./depositGate.ts";

const SECRET = "secret-de-test";
const NOW = 1_800_000_000;
const SUBMISSION = "soumission-1";

const solvedFor = async (binding: string) => solveChallenge(await issueChallenge(SECRET, NOW, 6), 2000, binding);
const gate = (over: Partial<Parameters<typeof checkDepositChallenge>[0]>) =>
  checkDepositChallenge({ secret: SECRET, required: true, challenge: undefined, submissionId: SUBMISSION, nowSeconds: NOW, ...over });

describe("la porte anti-robot du dépôt", () => {
  it("s'ouvre sur une preuve résolue POUR cette demande", async () => {
    expect(await gate({ challenge: await solvedFor(SUBMISSION) })).toBe("open");
  });

  it("⚠️ une preuve résolue pour une AUTRE demande ne sert à rien ici", async () => {
    expect(await gate({ challenge: await solvedFor("autre-soumission") })).toBe("challenge_required");
  });

  it("exigée : sans preuve, pas de dépôt", async () => {
    expect(await gate({})).toBe("challenge_required");
    expect(await gate({ challenge: null })).toBe("challenge_required");
  });

  it("⚠️ phase tolérante (écran pas encore déployé) : l'absence passe, le FAUX ne passe pas", async () => {
    // Exiger la preuve avant que l'écran sache la fournir couperait tous les dépôts.
    expect(await gate({ required: false })).toBe("open");
    expect(await gate({ required: false, challenge: { salt: "x", bits: 1, expires: NOW + 60, signature: "s", nonce: "0" } }))
      .toBe("challenge_required");
  });

  it("sans secret de signature, la porte n'existe pas : le portail dépose comme avant", async () => {
    expect(await gate({ secret: null })).toBe("open");
    expect(await gate({ secret: null, challenge: "n'importe quoi" })).toBe("open");
  });

  it("refuse une preuve périmée", async () => {
    expect(await gate({ challenge: await solvedFor(SUBMISSION), nowSeconds: NOW + 3600 })).toBe("challenge_required");
  });
});
