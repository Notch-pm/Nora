import { describe, expect, it } from "vitest";
import { defaultTheme, type PortalTheme } from "@fn/_shared/domain/theme.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import {
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  headerLogoUrl,
  DARK_TEXT_HALO,
  imageBackdropStyle,
  imageTextStyle,
  LIGHT_TEXT_HALO,
  isDarkColor,
  relativeLuminance,
  themeStyle,
} from "./themeStyle.ts";

/**
 * ⚠️ **Miroir volontaire** de `Socle/src/features/portal/themeStyle.test.ts` :
 * les mêmes facteurs, les mêmes encres, les mêmes noms de variables. Si les
 * deux divergent, c'est l'aperçu de l'éditeur qui ment — et personne ne s'en
 * aperçoit avant la publication.
 */
const CHARTE: Branding = {
  logoUrl: "https://exemple.fr/logo.png",
  logoWhiteUrl: "https://exemple.fr/logo-blanc.png",
  faviconUrl: "https://exemple.fr/favicon.png",
  primaryColor: "#2f6fd0",
  secondaryColor: "#ffcd57",
};

function vars(theme: PortalTheme, branding: Branding | null = CHARTE) {
  return themeStyle(theme, branding) as unknown as Record<string, string>;
}

function withHeader(patch: Partial<PortalTheme["header"]>): PortalTheme {
  return { ...defaultTheme(), header: { ...defaultTheme().header, ...patch } };
}

describe("les couleurs viennent de la charte", () => {
  it("la couleur appliquée EST celle de la collectivité", () => {
    expect(vars(defaultTheme())["--pt-primary"]).toBe("#2f6fd0");
    // ⚠️ `--brand-primary` porte la MÊME valeur : les composants d'avant le
    // thème restent justes, et gagnent l'assombrissement au passage.
    expect(vars(defaultTheme())["--brand-primary"]).toBe("#2f6fd0");
  });

  it("sans charte, on retombe sur celle de la gamme", () => {
    const style = vars(defaultTheme(), null);
    expect(style["--pt-primary"]).toBe(DEFAULT_PRIMARY);
    expect(style["--pt-accent"]).toBe(DEFAULT_SECONDARY);
  });

  it("champ par champ : une couleur illisible n'emporte pas l'autre", () => {
    const style = vars(defaultTheme(), {
      logoUrl: null,
      logoWhiteUrl: null,
      faviconUrl: null,
      primaryColor: "bleu roi",
      secondaryColor: "#ffcd57",
    });
    expect(style["--pt-primary"]).toBe(DEFAULT_PRIMARY);
    expect(style["--pt-accent"]).toBe("#ffcd57");
  });
});

describe("les échelles", () => {
  it("l'échelle de texte agit sur toutes les tailles", () => {
    expect(vars(defaultTheme())["--pt-h1"]).toBe("30px");
    const compact = vars({
      ...defaultTheme(),
      typography: { font: "systeme", textScale: "compact" },
    });
    expect(compact["--pt-h1"]).toBe("28px");
    expect(compact["--pt-body"]).toBe("13px");
  });

  it("la densité agit sur les espacements, pas sur les textes", () => {
    const airy = vars({
      ...defaultTheme(),
      shapes: { radius: "soft", shadow: "soft", density: "airy" },
    });
    expect(airy["--pt-gap"]).toBe("28px");
    expect(airy["--pt-body"]).toBe("14px");
  });

  it("les angles descendent en deux rayons cohérents", () => {
    const round = vars({
      ...defaultTheme(),
      shapes: { radius: "round", shadow: "none", density: "standard" },
    });
    expect(round["--pt-radius"]).toBe("18px");
    expect(round["--pt-radius-sm"]).toBe("14px");
    expect(round["--pt-shadow"]).toBe("none");
  });
});

describe("l'en-tête", () => {
  it("blanc par défaut, coloré sur demande, avec une encre lisible", () => {
    expect(vars(defaultTheme())["--pt-header-surface"]).toBe("#ffffff");

    const colored = vars(withHeader({ fill: "color", color: "primary" }));
    expect(colored["--pt-header-surface"]).toBe("#2f6fd0");
    // Bleu foncé : l'encre passe au blanc, calculée par luminance.
    expect(colored["--pt-header-ink"]).toBe("#ffffff");

    const yellow = vars(withHeader({ fill: "color", color: "secondary" }));
    expect(yellow["--pt-header-surface"]).toBe("#ffcd57");
    expect(isDarkColor(yellow["--pt-header-ink"])).toBe(true);
  });

  it("le menu en pilules est le seul à porter un fond et un rayon", () => {
    expect(vars(defaultTheme())["--pt-nav-bg"]).toBe("transparent");
    expect(vars(withHeader({ menu: "pills" }))["--pt-nav-bg"]).not.toBe("transparent");
    expect(vars(withHeader({ menu: "pills" }))["--pt-nav-radius"]).toBe("999px");
  });

  it("« Mon compte » discret n'est qu'un contour", () => {
    expect(vars(withHeader({ account: "discreet" }))["--pt-account-bg"]).toBe("transparent");
    expect(vars(defaultTheme())["--pt-account-bg"]).toBe("#2f6fd0");
  });

  it("le logo centré passe la barre en colonne", () => {
    expect(vars(defaultTheme())["--pt-header-direction"]).toBe("row");
    expect(vars(withHeader({ logo: "center" }))["--pt-header-direction"]).toBe("column");
  });
});

describe("accessibilité", () => {
  it("⚠️ « assombrir » fonce la couleur appliquée, pas la charte", () => {
    const theme: PortalTheme = {
      ...defaultTheme(),
      accessibility: { ...defaultTheme().accessibility, darkPrimary: true },
    };
    const applied = vars(theme)["--pt-primary"];
    expect(applied).not.toBe("#2f6fd0");
    expect(relativeLuminance(applied)!).toBeLessThan(relativeLuminance("#2f6fd0")!);
    // La charte reçue, elle, n'a pas bougé.
    expect(CHARTE.primaryColor).toBe("#2f6fd0");
  });

  it("le contraste renforcé fonce aussi la couleur principale, et les encres", () => {
    const theme: PortalTheme = {
      ...defaultTheme(),
      accessibility: { ...defaultTheme().accessibility, highContrast: true },
    };
    const strong = vars(theme);
    const normal = vars(defaultTheme());
    expect(relativeLuminance(strong["--pt-primary"])!).toBeLessThan(
      relativeLuminance(normal["--pt-primary"])!,
    );
    expect(relativeLuminance(strong["--pt-ink"])!).toBeLessThan(
      relativeLuminance(normal["--pt-ink"])!,
    );
  });

  it("⚠️ un orange ou un turquoise reçoit l'encre sombre : le blanc y perdait (relevé RGAA)", () => {
    // Sous l'ancien seuil (0,4), ces deux couleurs recevaient du blanc, à
    // 2,97 et 3,10 : 1. L'encre sombre y passe à 5,44 et 5,21.
    expect(isDarkColor("#e07b39")).toBe(false);
    expect(isDarkColor("#00a3a3")).toBe(false);

    const orange = vars(withHeader({ fill: "color", color: "primary" }), {
      ...CHARTE,
      primaryColor: "#e07b39",
    });
    expect(orange["--pt-header-ink"]).toBe("#1c2220");
    expect(orange["--pt-on-primary"]).toBe("#1c2220");
    expect(ratio(orange["--pt-on-primary"], "#e07b39")).toBeGreaterThanOrEqual(4.5);
  });

  it("le blanc reste là où il contraste le mieux", () => {
    // La charte de SNA27 : 5,02 : 1 en blanc, 3,22 en encre sombre.
    expect(isDarkColor("#3b7788")).toBe(true);
    const sna = vars(defaultTheme(), { ...CHARTE, primaryColor: "#3b7788" });
    expect(sna["--pt-on-primary"]).toBe("#ffffff");
  });

  it("le contour d'un champ tient 3 : 1, en ordinaire comme en contraste renforcé", () => {
    const strongTheme: PortalTheme = {
      ...defaultTheme(),
      accessibility: { ...defaultTheme().accessibility, highContrast: true },
    };
    for (const v of [vars(defaultTheme()), vars(strongTheme)]) {
      expect(ratio(v["--pt-field-border"], "#ffffff")).toBeGreaterThanOrEqual(3);
      expect(ratio(v["--pt-field-border"], v["--pt-surface"])).toBeGreaterThanOrEqual(3);
      // La bordure décorative, elle, reste claire : c'est un choix, pas un oubli.
      expect(v["--pt-border"]).not.toBe(v["--pt-field-border"]);
    }
  });
});

function ratio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a)!, relativeLuminance(b)!].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("headerLogoUrl", () => {
  it("le logo blanc ne sert que sur un bandeau de couleur", () => {
    expect(headerLogoUrl(defaultTheme(), CHARTE)).toBe(CHARTE.logoUrl);
    expect(headerLogoUrl(withHeader({ fill: "color", logoWhite: true }), CHARTE)).toBe(
      CHARTE.logoWhiteUrl,
    );
    expect(headerLogoUrl(withHeader({ fill: "color", logoWhite: false }), CHARTE)).toBe(
      CHARTE.logoUrl,
    );
  });

  it("⚠️ sans logo blanc déposé, on garde le logo couleur", () => {
    // Mieux vaut un logo un peu perdu sur son fond qu'un bandeau anonyme.
    const sansBlanc: Branding = { ...CHARTE, logoWhiteUrl: null };
    expect(headerLogoUrl(withHeader({ fill: "color", logoWhite: true }), sansBlanc)).toBe(
      CHARTE.logoUrl,
    );
  });

  it("sans charte du tout, il n'y a pas de logo — la pastille prend sa place", () => {
    expect(headerLogoUrl(defaultTheme(), null)).toBeNull();
  });
});

describe("le fond image d'un bloc", () => {
  /** Rapport de contraste WCAG entre deux `#rrggbb`. */
  function ratio(a: string, b: string): number {
    const la = relativeLuminance(a)!;
    const lb = relativeLuminance(b)!;
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }

  it("rend `undefined` sans image : un bloc sans fond ne porte aucun style", () => {
    expect(imageBackdropStyle(null, false)).toBeUndefined();
    expect(imageBackdropStyle("   ", true)).toBeUndefined();
  });

  // ⚠️ Le voile clair a été retiré le 2026-09-12 (décision produit) : la photo
  // se voit telle quelle. Ce test l'épingle — un dégradé qui reviendrait ici
  // serait un voile reposé sans qu'on l'ait décidé.
  it("ne pose QUE la photo, sans voile par-dessus", () => {
    const style = imageBackdropStyle("https://exemple.fr/a.jpg", false)!;
    expect(style.backgroundImage).not.toContain("linear-gradient");
    expect(style.backgroundImage).toBe('url("https://exemple.fr/a.jpg")');
    expect(style.backgroundSize).toBe("cover");
    expect(style.backgroundAttachment).toBe("scroll");
  });

  it("ancre l'image à la fenêtre quand elle est fixe", () => {
    expect(imageBackdropStyle("https://exemple.fr/a.jpg", true)!.backgroundAttachment).toBe("fixed");
  });

  it("échappe l'adresse : un guillemet ne doit pas casser la valeur CSS", () => {
    const style = imageBackdropStyle('https://exemple.fr/a".jpg', false)!;
    expect(style.backgroundImage).toContain('url("https://exemple.fr/a\\".jpg")');
  });

  // ⚠️ CE QUE LE RETRAIT DU VOILE A COÛTÉ, mesuré et épinglé — la décision est
  // produit (2026-09-12), la conséquence est factuelle : il n'y a PLUS AUCUNE
  // garantie de lisibilité sur une image. Le voile assurait 5,7 : 1 quelle que
  // soit la photo ; sur un gris moyen, qui tient lieu de photo quelconque,
  // l'encre pleine elle-même tombe à 4,1 : 1, sous le seuil AA.
  //
  // Le sous-titre passe quand même à l'encre pleine : c'est nettement mieux que
  // le gris de texte, sans être suffisant. Le jour où il faudra y revenir, la
  // bonne forme est un voile SOUS LE TEXTE SEUL.
  it("dit ce que le retrait du voile a coûté sur une image", () => {
    const photo = "#808080";
    expect(ratio("#1c2220", photo)).toBeLessThan(4.5);
    expect(ratio("#1c2220", photo)).toBeGreaterThan(ratio("#5c6663", photo));
  });
});

describe("les textes posés sur l'image du bloc de recherche", () => {
  it("ne change rien par défaut : encre du thème, sans ombre", () => {
    expect(imageTextStyle("theme", false)).toBeUndefined();
  });

  it("passe le texte en blanc", () => {
    expect(imageTextStyle("white", false)).toEqual({ color: "#ffffff" });
  });

  it("l'ombre part de tous les côtés : aucun décalage, seulement du flou", () => {
    for (const halo of [DARK_TEXT_HALO, LIGHT_TEXT_HALO]) {
      for (const layer of halo.split(/,\s*(?![^(]*\))/)) expect(layer.startsWith("0 0 ")).toBe(true);
    }
  });

  it("l'ombre prend le contre-pied du texte : sombre sous le blanc, claire sous l'encre", () => {
    expect(imageTextStyle("white", true)).toEqual({ color: "#ffffff", textShadow: DARK_TEXT_HALO });
    expect(imageTextStyle("theme", true)).toEqual({ textShadow: LIGHT_TEXT_HALO });
  });
});
