import { describe, expect, it } from "vitest";
import { brandingStyle } from "./theme.ts";

describe("brandingStyle", () => {
  it("ne pose que les couleurs renseignées — l'autre garde son défaut", () => {
    expect(brandingStyle({ logoUrl: null, logoWhiteUrl: null, primaryColor: "#1f8a5b", secondaryColor: null }))
      .toEqual({ "--brand-primary": "#1f8a5b" });
  });

  it("pose les deux quand la charte est complète", () => {
    expect(
      brandingStyle({ logoUrl: "https://x/l.png", logoWhiteUrl: null, primaryColor: "#1f8a5b", secondaryColor: "#ffcd57" }),
    ).toEqual({ "--brand-primary": "#1f8a5b", "--brand-secondary": "#ffcd57" });
  });

  it("ne pose rien sans charte", () => {
    expect(brandingStyle(null)).toEqual({});
  });
});
