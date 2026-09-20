import { describe, expect, it } from "vitest";
import { closedAssistant, parseAssistant } from "./assistant.ts";

describe("parseAssistant — ce que la collectivité a ouvert", () => {
  it("lit le bloc du Socle, du snake_case du contrat au camelCase du portail", () => {
    expect(parseAssistant({ enabled: true, deposit_enabled: true })).toEqual({
      enabled: true,
      depositEnabled: true,
    });
    expect(parseAssistant({ enabled: true, deposit_enabled: false })).toEqual({
      enabled: true,
      depositEnabled: false,
    });
  });

  it("⚠️ au doute, FERMÉ : un Socle d'avant 1.28.0 ne sert pas le champ", () => {
    // L'assistant dépense le crédit IA de la collectivité : ce n'est pas au
    // portail de l'ouvrir sur une lecture incertaine.
    for (const raw of [undefined, null, "oui", 1, [], [{ enabled: true }], {}]) {
      expect(parseAssistant(raw)).toEqual(closedAssistant());
    }
  });

  it("⚠️ seul un `true` littéral ouvre quelque chose", () => {
    for (const enabled of ["true", 1, "1", {}, []]) {
      expect(parseAssistant({ enabled, deposit_enabled: true })).toEqual(closedAssistant());
    }
    expect(parseAssistant({ enabled: true, deposit_enabled: "true" }).depositEnabled).toBe(false);
  });

  it("⚠️ pas de dépôt par la conversation sous un assistant fermé", () => {
    // Le Socle l'applique déjà à sa frontière ; le portail ne suspend pas ce
    // droit à la discipline d'un autre dépôt.
    expect(parseAssistant({ enabled: false, deposit_enabled: true })).toEqual(closedAssistant());
  });

  it("ne retient rien d'autre que ses deux réglages", () => {
    const parsed = parseAssistant({ enabled: true, deposit_enabled: true, agent: "x", prompt: "y" });
    expect(Object.keys(parsed).sort()).toEqual(["depositEnabled", "enabled"]);
  });
});
