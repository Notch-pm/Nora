import { describe, expect, it } from "vitest";
import { isRtl, localizedText, parseLanguages, PIVOT_LANGUAGE, resolveLang } from "./languages.ts";

describe("parseLanguages", () => {
  it("garde les langues de la collectivité, français en tête", () => {
    expect(parseLanguages(["en", "br"])).toEqual(["fr", "en", "br"]);
    expect(parseLanguages(["fr", "en"])).toEqual(["fr", "en"]);
  });

  it("rend au moins le français, quoi qu'on lui donne", () => {
    // Un portail sans langue par défaut n'aurait rien à afficher.
    expect(parseLanguages(null)).toEqual(["fr"]);
    expect(parseLanguages("en")).toEqual(["fr"]);
    expect(parseLanguages([])).toEqual(["fr"]);
  });

  it("écarte les entrées abîmées une à une", () => {
    expect(parseLanguages(["EN ", 42, "anglais!", "en", "br"])).toEqual(["fr", "en", "br"]);
  });
});

describe("resolveLang — c'est le serveur qui tranche", () => {
  const available = ["fr", "en", "ar"];

  it("sert la langue demandée quand la collectivité l'a activée", () => {
    expect(resolveLang("en", available)).toBe("en");
    expect(resolveLang(" AR ", available)).toBe("ar");
  });

  it("retombe sur le français pour tout le reste", () => {
    // Langue désactivée depuis, préfixe d'URL inventé, code mal formé, absence.
    expect(resolveLang("br", available)).toBe(PIVOT_LANGUAGE);
    expect(resolveLang("xyz!", available)).toBe(PIVOT_LANGUAGE);
    expect(resolveLang(null, available)).toBe(PIVOT_LANGUAGE);
    expect(resolveLang("en", ["fr"])).toBe(PIVOT_LANGUAGE);
  });
});

describe("isRtl", () => {
  it("reconnaît les écritures de droite à gauche", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("fa")).toBe(true);
    expect(isRtl("ar-MA")).toBe(true);
  });

  it("ne compte PAS le kurde kurmandji parmi elles", () => {
    // `ku` au catalogue du Socle, c'est le kurmandji, en alphabet latin. Le
    // sorani (`ckb`, en alphabet arabe) n'y est pas.
    expect(isRtl("ku")).toBe(false);
    expect(isRtl("fr")).toBe(false);
    expect(isRtl("br")).toBe(false);
  });
});

describe("localizedText — le repli champ par champ", () => {
  const translations = {
    en: { name: "Birth certificate", short_description: "To get a copy." },
    br: { name: "Testeni ganedigezh" },
  };

  it("rend la traduction quand elle existe", () => {
    expect(localizedText("Acte de naissance", translations, "en", "name"))
      .toBe("Birth certificate");
  });

  it("replie CHAQUE champ séparément", () => {
    // Le breton a l'intitulé, pas le résumé : l'un s'affiche traduit, l'autre
    // en français. Replier la langue entière masquerait l'intitulé traduit.
    expect(localizedText("Acte de naissance", translations, "br", "name"))
      .toBe("Testeni ganedigezh");
    expect(localizedText("Pour obtenir une copie.", translations, "br", "short_description"))
      .toBe("Pour obtenir une copie.");
  });

  it("sert le français tel quel pour la langue pivot, sans lire les traductions", () => {
    expect(localizedText("Acte de naissance", { fr: { name: "Autre chose" } }, "fr", "name"))
      .toBe("Acte de naissance");
  });

  it("traite une chaîne vide comme une absence, pas comme un texte", () => {
    expect(localizedText("Acte", { en: { name: "   " } }, "en", "name")).toBe("Acte");
  });

  it("rend null quand ni traduction ni français n'existent", () => {
    // `null` se compose (`?? autreChamp`) là où `""` afficherait un vide.
    expect(localizedText(null, translations, "br", "short_description")).toBeNull();
    expect(localizedText("  ", null, "en", "name")).toBeNull();
  });

  it("ne se laisse pas abîmer par une colonne illisible", () => {
    expect(localizedText("Acte", "n'importe quoi", "en", "name")).toBe("Acte");
    expect(localizedText("Acte", [{ en: "x" }], "en", "name")).toBe("Acte");
    expect(localizedText("Acte", { en: "Birth" }, "en", "name")).toBe("Acte");
  });
});
