import { describe, expect, it } from "vitest";
import { connexionUrl, safeRetour } from "./retour.ts";

describe("safeRetour", () => {
  it("accepte un chemin relatif interne, avec requête et ancre", () => {
    expect(safeRetour("/demarches/abc")).toBe("/demarches/abc");
    expect(safeRetour("/en/mairie/demarches/abc/formulaire")).toBe("/en/mairie/demarches/abc/formulaire");
    expect(safeRetour("/compte/demandes?x=1#haut")).toBe("/compte/demandes?x=1#haut");
    expect(safeRetour("/")).toBe("/");
  });

  it("refuse tout ce qui sort du site", () => {
    for (const bad of [
      "https://autre.example",
      "//autre.example",
      "//autre.example/chemin",
      "/\\autre.example",
      "\\\\autre.example",
      "javascript:alert(1)",
      "demarches/abc",
      "",
      " /demarches",
      "/a\tb",
      "/a\nb",
      "/a\\b",
    ]) {
      expect(safeRetour(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("refuse l'absent et le démesuré", () => {
    expect(safeRetour(null)).toBeNull();
    expect(safeRetour(undefined)).toBeNull();
    expect(safeRetour("/" + "a".repeat(600))).toBeNull();
  });
});

describe("connexionUrl", () => {
  it("encode le chemin de retour", () => {
    expect(connexionUrl("/compte/connexion", "/demarches/a b?x=1")).toBe(
      "/compte/connexion?retour=%2Fdemarches%2Fa%20b%3Fx%3D1",
    );
  });

  it("n'ajoute rien si le retour n'est pas sûr", () => {
    expect(connexionUrl("/compte/connexion", "//autre.example")).toBe("/compte/connexion");
  });
});
