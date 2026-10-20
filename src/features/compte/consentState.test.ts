import { describe, expect, it } from "vitest";
import { consentAction, consentView, needsWithdrawConfirmation } from "./consentState.ts";

describe("consentView", () => {
  it("distingue accordé, refusé et jamais demandé", () => {
    expect(consentView({ accorde: true, le: "2026-10-20T08:00:00Z" })).toEqual({ state: "granted", at: "2026-10-20T08:00:00Z" });
    expect(consentView({ accorde: false, le: "2026-10-21T08:00:00Z" })).toEqual({ state: "refused", at: "2026-10-21T08:00:00Z" });
    expect(consentView(null)).toEqual({ state: "never" });
    expect(consentView(undefined)).toEqual({ state: "never" });
  });

  it("la date tranche : sans date, ni accordé ni refusé", () => {
    expect(consentView({ accorde: true, le: "" })).toEqual({ state: "never" });
    expect(consentView({ accorde: false, le: "  " })).toEqual({ state: "never" });
  });
});

describe("consentAction", () => {
  it("retire l'accordé, accorde le reste", () => {
    expect(consentAction({ state: "granted", at: "x" })).toBe("withdraw");
    expect(consentAction({ state: "refused", at: "x" })).toBe("grant");
    expect(consentAction({ state: "never" })).toBe("grant");
  });
});

describe("needsWithdrawConfirmation", () => {
  it("seul le retrait du traitement se confirme", () => {
    const granted = { state: "granted", at: "x" } as const;
    expect(needsWithdrawConfirmation("traitement", granted)).toBe(true);
    expect(needsWithdrawConfirmation("partage", granted)).toBe(false);
    expect(needsWithdrawConfirmation("traitement", { state: "never" })).toBe(false);
  });
});
