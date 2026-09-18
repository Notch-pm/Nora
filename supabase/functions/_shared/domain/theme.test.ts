import { describe, expect, it } from "vitest";
import { defaultTheme, fontStack, FONTS, parseTheme } from "./theme.ts";

/**
 * ⚠️ **Miroir volontaire** de `Socle/src/features/portal/portalTheme.test.ts` et
 * de son `public-api/_shared/portalTheme.test.ts`. Les trois suites épinglent
 * les mêmes règles sur le même JSON — c'est la seule chose qui garantisse que
 * l'éditeur, l'API et le portail lisent le thème de la même façon.
 */
describe("parseTheme — ce qui n'est pas un thème", () => {
  it("rend les défauts, jamais null", () => {
    for (const raw of [null, undefined, "thème", 42, []]) {
      expect(parseTheme(raw)).toEqual(defaultTheme());
    }
  });

  it("⚠️ un Socle d'avant le contrat 1.17.0 ne casse rien", () => {
    // Le champ `theme` n'existait pas : le portail prend les défauts et sert la
    // page. C'est la seule chose qui permette de déployer les deux côtés dans
    // n'importe quel ordre.
    expect(parseTheme(undefined)).toEqual(defaultTheme());
  });

  it("les défauts n'activent aucun correctif d'accessibilité, ni de lien", () => {
    expect(defaultTheme().accessibility).toEqual({
      highContrast: false,
      darkPrimary: false,
      declaration: "",
      declarationLink: false,
    });
  });

  it("⚠️ un Socle d'avant le contrat 1.25.0 ne sert pas de lien : la mention reste un texte", () => {
    const theme = parseTheme({ accessibility: { declaration: "Partiellement conforme" } });
    expect(theme.accessibility.declaration).toBe("Partiellement conforme");
    expect(theme.accessibility.declarationLink).toBe(false);
  });

  it("lit le lien résolu par le Socle", () => {
    const theme = parseTheme({ accessibility: { declaration: "", declaration_link: true } });
    expect(theme.accessibility.declarationLink).toBe(true);
    // Une valeur qui n'est pas un booléen ne vaut pas « oui ».
    expect(parseTheme({ accessibility: { declaration_link: "oui" } }).accessibility.declarationLink)
      .toBe(false);
  });

  it("aucune couleur ne franchit — elles vivent dans la charte", () => {
    const theme = parseTheme({
      typography: { font: "rubik" },
      primary_color: "#ff0000",
      colors: { primary: "#ff0000" },
    });
    expect(JSON.stringify(theme)).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe("parseTheme — tolérance champ par champ", () => {
  it("⚠️ une valeur inconnue retombe sur SON défaut, sans emporter ses voisines", () => {
    const theme = parseTheme({
      typography: { font: "comic-sans", text_scale: "comfortable" },
      shapes: { radius: "round", shadow: 7, density: "airy" },
      header: { fill: "color", color: "mauve", logo: "center" },
      accessibility: { high_contrast: true, dark_primary: "oui", declaration: "Audit du 12 juin" },
    });

    expect(theme.typography.textScale).toBe("comfortable");
    expect(theme.shapes.radius).toBe("round");
    expect(theme.shapes.density).toBe("airy");
    expect(theme.header.fill).toBe("color");
    expect(theme.header.logo).toBe("center");
    expect(theme.accessibility.highContrast).toBe(true);
    expect(theme.accessibility.declaration).toBe("Audit du 12 juin");

    expect(theme.typography.font).toBe(defaultTheme().typography.font);
    expect(theme.shapes.shadow).toBe(defaultTheme().shapes.shadow);
    expect(theme.header.color).toBe(defaultTheme().header.color);
    expect(theme.accessibility.darkPrimary).toBe(false);
  });

  it("un bloc illisible ou absent prend ses défauts, les autres restent", () => {
    const theme = parseTheme({
      typography: "n'importe quoi",
      shapes: { radius: "square", shadow: "strong", density: "compact" },
    });
    expect(theme.typography).toEqual(defaultTheme().typography);
    expect(theme.header).toEqual(defaultTheme().header);
    expect(theme.shapes).toEqual({ radius: "square", shadow: "strong", density: "compact" });
  });

  it("écarte une déclaration démesurée plutôt que de la tronquer à moitié", () => {
    expect(parseTheme({ accessibility: { declaration: "a".repeat(301) } }).accessibility
      .declaration).toBe("");
  });
});

describe("parseTheme — snake_case du contrat → camelCase du portail", () => {
  it("traduit les clés, et ne lit QUE celles du contrat", () => {
    const theme = parseTheme({
      typography: { text_scale: "compact" },
      header: { logo_white: false },
      accessibility: { high_contrast: true, dark_primary: true },
    });
    expect(theme.typography.textScale).toBe("compact");
    expect(theme.header.logoWhite).toBe(false);
    expect(theme.accessibility.highContrast).toBe(true);
    expect(theme.accessibility.darkPrimary).toBe(true);

    // Le camelCase est le vocabulaire du PORTAIL, pas celui de la réponse :
    // l'accepter en entrée ferait croire que le contrat le sert.
    const camel = parseTheme({ typography: { textScale: "compact" }, header: { logoWhite: false } });
    expect(camel.typography.textScale).toBe("standard");
    expect(camel.header.logoWhite).toBe(true);
  });

  it("les quatre polices du catalogue traversent, et rien d'autre", () => {
    for (const font of FONTS) {
      expect(parseTheme({ typography: { font } }).typography.font).toBe(font);
    }
    expect(parseTheme({ typography: { font: "marianne" } }).typography.font).toBe(
      defaultTheme().typography.font,
    );
  });
});

describe("fontStack", () => {
  it("⚠️ chaque pile se termine par un repli générique", () => {
    // Une police web qui n'arrive pas — réseau lent, fichier absent — laisse la
    // page lisible plutôt qu'au choix du navigateur.
    for (const font of FONTS) {
      expect(fontStack(font)).toMatch(/sans-serif$/);
    }
  });

  it("nomme les familles que `public/fonts/fonts.css` déclare", () => {
    expect(fontStack("nunito-sans")).toContain("'Nunito Sans'");
    expect(fontStack("public-sans")).toContain("'Public Sans'");
    expect(fontStack("rubik")).toContain("'Rubik'");
    // « Système » ne nomme AUCUNE des familles auto-hébergées : c'est tout son
    // objet — zéro téléchargement. (`'Segoe UI'` est déjà sur la machine.)
    for (const hosted of ["Nunito Sans", "Public Sans", "Rubik"]) {
      expect(fontStack("systeme")).not.toContain(hosted);
    }
  });
});
