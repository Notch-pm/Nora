import { describe, expect, it } from "vitest";
import { defaultTheme, type PortalTheme } from "@fn/_shared/domain/theme.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import {
  DEFAULT_PRIMARY,
  DEFAULT_SECONDARY,
  headerLogoUrl,
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
});

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
