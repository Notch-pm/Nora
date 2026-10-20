import { describe, expect, it } from "vitest";
import { newPasswordErrors, passwordAccepted, passwordRuleStates } from "./passwordRules.ts";

describe("passwordRuleStates", () => {
  it("liste les quatre règles, toutes non respectées pour un champ vide", () => {
    expect(passwordRuleStates("")).toEqual([
      { rule: "length", met: false },
      { rule: "letter", met: false },
      { rule: "digit", met: false },
      { rule: "special", met: false },
    ]);
  });

  it("coche celles qui sont respectées", () => {
    const states = passwordRuleStates("abc1");
    expect(states.find((s) => s.rule === "letter")?.met).toBe(true);
    expect(states.find((s) => s.rule === "digit")?.met).toBe(true);
    expect(states.find((s) => s.rule === "length")?.met).toBe(false);
    expect(states.find((s) => s.rule === "special")?.met).toBe(false);
  });

  it("n'ajoute le plafond que lorsqu'il est dépassé", () => {
    expect(passwordRuleStates("Abcdefghij1!").some((s) => s.rule === "too_long")).toBe(false);
    expect(passwordRuleStates("Abcdefghij1!".padEnd(80, "x")).at(-1)).toEqual({ rule: "too_long", met: false });
  });
});

describe("passwordAccepted", () => {
  it("suit exactement la politique du serveur", () => {
    expect(passwordAccepted("Abcdefghij1!")).toBe(true);
    expect(passwordAccepted("abcdefghijkl")).toBe(false);
    expect(passwordAccepted("Abcdefghij1")).toBe(false);
  });
});

describe("newPasswordErrors", () => {
  it("rien à redire d'un mot de passe accepté et confirmé", () => {
    expect(newPasswordErrors("Abcdefghij1!", "Abcdefghij1!")).toEqual({});
  });

  it("distingue absent, faible et différent", () => {
    expect(newPasswordErrors("", "")).toEqual({
      password: "compte.required.password",
      confirmation: "compte.required.confirmation",
    });
    expect(newPasswordErrors("faible", "faible")).toEqual({ password: "compte.password.weak" });
    expect(newPasswordErrors("Abcdefghij1!", "Autre")).toEqual({ confirmation: "compte.password.mismatch" });
  });
});
