import { describe, expect, it } from "vitest";
import {
  CHALLENGE_TTL_SECONDS,
  clampBits,
  DEFAULT_CHALLENGE_BITS,
  issueChallenge,
  solveChallenge,
  verifySolution,
} from "./challenge.ts";

const SECRET = "secret-de-test";
const NOW = 1_800_000_000;
// Une difficulté de test : quelques centaines d'empreintes, pas des dizaines de milliers.
const EASY = 8;

describe("la preuve de travail", () => {
  it("un défi résolu par le navigateur est accepté par le serveur — même code des deux côtés", async () => {
    const challenge = await issueChallenge(SECRET, NOW, EASY);
    expect(challenge.expires).toBe(NOW + CHALLENGE_TTL_SECONDS);
    const solved = await solveChallenge(challenge);
    expect(await verifySolution(SECRET, solved, NOW + 5)).toBe(true);
  });

  it("refuse un nonce qui ne résout rien", async () => {
    const challenge = await issueChallenge(SECRET, NOW, 20);
    expect(await verifySolution(SECRET, { ...challenge, nonce: "0" }, NOW)).toBe(false);
  });

  it("⚠️ le visiteur ne choisit ni sa difficulté, ni son échéance", async () => {
    const solved = await solveChallenge(await issueChallenge(SECRET, NOW, EASY));
    // Résoudre à 8 bits puis déclarer 1 bit, ou repousser l'échéance : la
    // signature couvre les deux.
    expect(await verifySolution(SECRET, { ...solved, bits: 1 }, NOW)).toBe(false);
    expect(await verifySolution(SECRET, { ...solved, expires: solved.expires + 3600 }, NOW)).toBe(false);
  });

  it("refuse un défi périmé, ou signé par un autre secret", async () => {
    const solved = await solveChallenge(await issueChallenge(SECRET, NOW, EASY));
    expect(await verifySolution(SECRET, solved, NOW + CHALLENGE_TTL_SECONDS + 1)).toBe(false);
    expect(await verifySolution("autre-secret", solved, NOW)).toBe(false);
  });

  it("refuse ce qui n'est pas une solution", async () => {
    const challenge = await issueChallenge(SECRET, NOW, EASY);
    for (const junk of [undefined, null, "x", 42, {}, { ...challenge }, { ...challenge, nonce: "" },
      { ...challenge, nonce: "x".repeat(64) }, { ...challenge, nonce: 7 }]) {
      expect(await verifySolution(SECRET, junk, NOW)).toBe(false);
    }
  });

  it("borne la difficulté réglée par l'exploitant", () => {
    expect(clampBits(undefined)).toBe(DEFAULT_CHALLENGE_BITS);
    expect(clampBits("abc")).toBe(DEFAULT_CHALLENGE_BITS);
    expect(clampBits(0)).toBe(DEFAULT_CHALLENGE_BITS);
    expect(clampBits("12")).toBe(12);
    // Au-delà, un téléphone modeste n'ouvrirait plus la conversation.
    expect(clampBits(40)).toBe(22);
  });
});
