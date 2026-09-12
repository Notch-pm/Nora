import { describe, expect, it } from "vitest";
import { brandingStyle, parseRememberedBranding } from "./theme.ts";

describe("brandingStyle", () => {
  it("ne pose que les couleurs renseignées — l'autre garde son défaut", () => {
    expect(brandingStyle({ logoUrl: null, logoWhiteUrl: null, faviconUrl: null, primaryColor: "#1f8a5b", secondaryColor: null }))
      .toEqual({ "--brand-primary": "#1f8a5b" });
  });

  it("pose les deux quand la charte est complète", () => {
    expect(
      brandingStyle({ logoUrl: "https://x/l.png", logoWhiteUrl: null, faviconUrl: null, primaryColor: "#1f8a5b", secondaryColor: "#ffcd57" }),
    ).toEqual({ "--brand-primary": "#1f8a5b", "--brand-secondary": "#ffcd57" });
  });

  it("ne pose rien sans charte", () => {
    expect(brandingStyle(null)).toEqual({});
  });
});

describe("parseRememberedBranding", () => {
  it("relit la charte mémorisée", () => {
    const branding = {
      logoUrl: "https://cdn/logo.png",
      logoWhiteUrl: null,
      faviconUrl: "https://cdn/favicon.png",
      primaryColor: "#1f8a5b",
      secondaryColor: "#ffcd57",
    };
    expect(parseRememberedBranding(JSON.stringify(branding))).toEqual(branding);
  });

  it("jette une couleur qui n'est pas un #rrggbb — elle irait dans un style", () => {
    expect(
      parseRememberedBranding('{"primaryColor":"red; background:url(x)","secondaryColor":"#FFCD57"}'),
    ).toEqual({
      logoUrl: null,
      logoWhiteUrl: null,
      faviconUrl: null,
      primaryColor: null,
      // Majuscules : le Socle sert du minuscule, ce n'est pas ce qu'il a écrit.
      secondaryColor: null,
    });
  });

  it("jette un logo qui n'est pas en https — il irait dans un src", () => {
    expect(parseRememberedBranding('{"logoUrl":"javascript:alert(1)"}')?.logoUrl).toBeNull();
  });

  it("ne relit rien d'une mémoire vide ou illisible", () => {
    expect(parseRememberedBranding(null)).toBeNull();
    expect(parseRememberedBranding("pas du json")).toBeNull();
    expect(parseRememberedBranding("null")).toBeNull();
  });
});
