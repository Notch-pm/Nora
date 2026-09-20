import { describe, expect, it } from "vitest";
import {
  accessibiliteTitle,
  assistantTitle,
  demarcheTitle,
  errorPageTitle,
  formulaireTitle,
  homeTitle,
  organismeTitle,
  receiptTitle,
} from "./pageTitle.ts";

describe("homeTitle", () => {
  it("nomme la collectivité, puis le site", () => {
    expect(homeTitle("fr", "Laurentville")).toBe("Laurentville — Démarches en ligne");
  });

  it("traduit le nom du site dans la langue servie", () => {
    expect(homeTitle("en", "Laurentville")).toBe("Laurentville — Online services");
  });
});

describe("accessibiliteTitle", () => {
  it("nomme la page dans la langue servie, puis la collectivité", () => {
    expect(accessibiliteTitle("fr", "Laurentville")).toBe(
      "Déclaration d'accessibilité — Laurentville",
    );
    expect(accessibiliteTitle("en", "Laurentville")).toBe("Accessibility statement — Laurentville");
  });
});

describe("assistantTitle", () => {
  it("nomme la page dans la langue servie, puis la collectivité", () => {
    expect(assistantTitle("fr", "Laurentville")).toBe("Assistant — Laurentville");
    expect(assistantTitle("en", "Laurentville")).toBe("Assistant — Laurentville");
  });
});

describe("organismeTitle", () => {
  it("nomme l'organisme, puis la collectivité", () => {
    expect(organismeTitle("Mairie d'Arles", "Laurentville")).toBe(
      "Mairie d'Arles — Laurentville",
    );
  });
});

describe("demarcheTitle", () => {
  it("nomme la démarche, puis la collectivité", () => {
    expect(demarcheTitle("Inscription scolaire", "Laurentville")).toBe(
      "Inscription scolaire — Laurentville",
    );
  });
});

describe("formulaireTitle", () => {
  it("préfixe « Formulaire : », sans compte d'erreur", () => {
    expect(formulaireTitle("fr", "Inscription scolaire", "Laurentville")).toBe(
      "Formulaire : Inscription scolaire — Laurentville",
    );
  });

  it("préfixe le nombre d'erreurs après un envoi refusé", () => {
    expect(formulaireTitle("fr", "Inscription scolaire", "Laurentville", 5)).toBe(
      "5 erreurs — Formulaire : Inscription scolaire — Laurentville",
    );
  });

  it("accorde le préfixe au singulier pour une seule erreur", () => {
    expect(formulaireTitle("fr", "Inscription scolaire", "Laurentville", 1)).toBe(
      "1 erreur — Formulaire : Inscription scolaire — Laurentville",
    );
  });

  it("traduit le préfixe et le mot « Formulaire »", () => {
    expect(formulaireTitle("en", "Inscription scolaire", "Laurentville", 5)).toBe(
      "5 errors — Form: Inscription scolaire — Laurentville",
    );
  });
});

describe("receiptTitle", () => {
  it("dit l'accusé, puis la collectivité", () => {
    expect(receiptTitle("fr", true, "Laurentville")).toBe(
      "Votre demande est enregistrée — Laurentville",
    );
  });

  it("distingue le renvoi après coupure", () => {
    expect(receiptTitle("fr", false, "Laurentville")).toBe(
      "Votre demande était déjà enregistrée — Laurentville",
    );
  });
});

describe("errorPageTitle", () => {
  it("nomme l'erreur, puis le site générique", () => {
    expect(errorPageTitle("fr", "Collectivité momentanément indisponible")).toBe(
      "Collectivité momentanément indisponible — Démarches en ligne",
    );
  });
});
