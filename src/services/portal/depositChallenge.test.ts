import { describe, expect, it } from "vitest";
import { challengeToSolve } from "./depositChallenge.ts";

const CHALLENGE = { salt: "s", bits: 15, expires: 100, signature: "sig" };

describe("challengeToSolve", () => {
  it("rend le défi quand il y en a un", () => {
    expect(challengeToSolve({ ok: true, challenge: CHALLENGE })).toEqual(CHALLENGE);
  });

  it("rend `null` sur toute panne — jamais un échec qui bloquerait le dépôt", () => {
    expect(challengeToSolve({ ok: false })).toBeNull();
  });
});
