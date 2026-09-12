import { describe, expect, it } from "vitest";
import { shouldApplyFavicon } from "./favicon.ts";

describe("shouldApplyFavicon", () => {
  it("pose l'icône de la collectivité quand il n'y en a pas encore", () => {
    expect(shouldApplyFavicon(null, "https://cdn/favicon.png")).toBe(true);
  });

  it("remplace celle d'avant quand la collectivité en a changé", () => {
    expect(shouldApplyFavicon("https://cdn/ancien.png", "https://cdn/favicon.png")).toBe(true);
  });

  it("ne repose pas une icône identique — ce serait un téléchargement par navigation", () => {
    expect(shouldApplyFavicon("https://cdn/favicon.png", "https://cdn/favicon.png")).toBe(false);
  });

  it("PAS DE FAVICON N'EST PAS UN EFFACEMENT : on garde ce que le navigateur affiche", () => {
    expect(shouldApplyFavicon("https://cdn/favicon.png", null)).toBe(false);
    expect(shouldApplyFavicon(null, null)).toBe(false);
    // Une adresse écartée par le Socle (http, chemin relatif) arrive ici à
    // `null` : elle ne doit pas davantage effacer l'icône en place.
    expect(shouldApplyFavicon("https://cdn/favicon.png", "")).toBe(false);
  });
});
