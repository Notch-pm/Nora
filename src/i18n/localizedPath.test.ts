import { describe, expect, it } from "vitest";
import {
  localizedPath,
  organismePath,
  servedLanguage,
  splitLangPath,
  splitOrganismePath,
  splitScopedPath,
} from "./localizedPath.ts";

describe("splitLangPath", () => {
  it("reconnaît un préfixe de langue", () => {
    expect(splitLangPath("/en")).toEqual({ lang: "en", path: "/" });
    expect(splitLangPath("/en/demarches/abc")).toEqual({ lang: "en", path: "/demarches/abc" });
    expect(splitLangPath("/gcr/demarches/abc")).toEqual({ lang: "gcr", path: "/demarches/abc" });
  });

  it("ne prend PAS un segment de route pour une langue", () => {
    // C'est ce qui permet de lire le préfixe sans connaître la table des routes.
    expect(splitLangPath("/demarches/abc")).toEqual({ lang: null, path: "/demarches/abc" });
    expect(splitLangPath("/")).toEqual({ lang: null, path: "/" });
  });

  it("laisse passer une langue de forme valide que personne n'a activée", () => {
    // La forme se vérifie ici, la LISTE se vérifie au serveur : lui seul sait
    // ce que la collectivité a activé.
    expect(splitLangPath("/zz/demarches/abc")).toEqual({ lang: "zz", path: "/demarches/abc" });
  });
});

describe("localizedPath", () => {
  it("préfixe le chemin, sauf en français", () => {
    expect(localizedPath("en", "/")).toBe("/en");
    expect(localizedPath("en", "/demarches/abc")).toBe("/en/demarches/abc");
  });

  it("laisse le français sans préfixe : c'est le pivot, pas une traduction", () => {
    // Toutes les adresses déjà partagées continuent de fonctionner.
    expect(localizedPath("fr", "/")).toBe("/");
    expect(localizedPath("fr", "/demarches/abc")).toBe("/demarches/abc");
  });

  it("fait l'aller-retour avec splitLangPath", () => {
    for (const [lang, path] of [["en", "/"], ["br", "/demarches/x"], ["fr", "/demarches/x"]]) {
      const split = splitLangPath(localizedPath(lang, path));
      expect(split.path).toBe(path);
      expect(split.lang ?? "fr").toBe(lang);
    }
  });

  it("ignore une langue de forme invalide plutôt que de fabriquer une adresse", () => {
    expect(localizedPath("anglais!", "/demarches/x")).toBe("/demarches/x");
  });
});

/**
 * Le bogue du 2026-09-07, épinglé.
 *
 * Choisir l'anglais rechargeait la page en français et laissait l'adresse
 * inchangée : l'effet qui aligne l'adresse se rejouait sur l'état « prêt » de
 * la langue précédente — périmé le temps d'un rendu — et annulait le choix.
 *
 * Aucun test pur ne pouvait l'attraper tant que la règle vivait dans un effet ;
 * elle vit maintenant ici.
 */
describe("servedLanguage — une réponse périmée ne dicte pas l'adresse", () => {
  it("aligne l'adresse quand la réponse répond à la langue demandée", () => {
    expect(servedLanguage({ requested: "en", lang: "en" }, "en")).toBe("en");
  });

  it("ne conclut RIEN d'une réponse à la langue précédente", () => {
    // Le visiteur vient de choisir l'anglais ; le chargement anglais n'est pas
    // parti. S'en servir le renverrait au français.
    expect(servedLanguage({ requested: "fr", lang: "fr" }, "en")).toBeNull();
  });

  it("rend la langue CLAMPÉE quand le serveur a refusé celle demandée", () => {
    // `/de` sur une collectivité qui n'a pas l'allemand : la réponse répond
    // bien à « de », et dit « c'est fr » — l'adresse doit suivre.
    expect(servedLanguage({ requested: "de", lang: "fr" }, "de")).toBe("fr");
  });

  it("ne conclut rien tant que rien n'est chargé", () => {
    expect(servedLanguage(null, "en")).toBeNull();
  });
});

describe("splitOrganismePath — l'organisme dans l'adresse", () => {
  it("reconnaît un organisme et rend le chemin qui reste", () => {
    expect(splitOrganismePath("/mairie-de-fontvieille"))
      .toEqual({ organisme: "mairie-de-fontvieille", path: "/" });
    expect(splitOrganismePath("/mairie-de-fontvieille/demarches/abc"))
      .toEqual({ organisme: "mairie-de-fontvieille", path: "/demarches/abc" });
  });

  it("ne prend pas un segment de route pour un organisme", () => {
    expect(splitOrganismePath("/demarches/abc"))
      .toEqual({ organisme: null, path: "/demarches/abc" });
    expect(splitOrganismePath("/")).toEqual({ organisme: null, path: "/" });
  });

  it("⚠️ `/accessibilite` est une page de la collectivité, pas un organisme", () => {
    expect(splitOrganismePath("/accessibilite"))
      .toEqual({ organisme: null, path: "/accessibilite" });
    expect(splitScopedPath("/en/accessibilite"))
      .toEqual({ lang: "en", organisme: null, path: "/accessibilite" });
  });

  it("⚠️ `/assistant` est une page de la collectivité, pas un organisme", () => {
    expect(splitOrganismePath("/assistant"))
      .toEqual({ organisme: null, path: "/assistant" });
    expect(splitScopedPath("/mairie-de-fontvieille/assistant"))
      .toEqual({ lang: null, organisme: "mairie-de-fontvieille", path: "/assistant" });
  });

  // ⚠️ C'est LA règle qui rend l'adresse lisible sans le serveur, et le Socle
  // en tient l'autre bout : un slug y fait au moins quatre caractères. Un
  // organisme nommé « cae » serait avalé comme un code de langue.
  it("ne prend pas un segment de deux ou trois lettres pour un organisme", () => {
    expect(splitOrganismePath("/en")).toEqual({ organisme: null, path: "/en" });
    expect(splitOrganismePath("/gsw/demarches/abc"))
      .toEqual({ organisme: null, path: "/gsw/demarches/abc" });
  });
});

describe("splitScopedPath — ce qu'une adresse du portail dit d'elle-même", () => {
  it("lit la langue puis l'organisme, dans cet ordre", () => {
    expect(splitScopedPath("/en/mairie-de-fontvieille/demarches/abc"))
      .toEqual({ lang: "en", organisme: "mairie-de-fontvieille", path: "/demarches/abc" });
    expect(splitScopedPath("/mairie-de-fontvieille"))
      .toEqual({ lang: null, organisme: "mairie-de-fontvieille", path: "/" });
    expect(splitScopedPath("/en/demarches/abc/formulaire"))
      .toEqual({ lang: "en", organisme: null, path: "/demarches/abc/formulaire" });
    expect(splitScopedPath("/")).toEqual({ lang: null, organisme: null, path: "/" });
  });
});

describe("organismePath — les liens d'un écran partagé", () => {
  it("garde le périmètre de l'organisme, langue comprise", () => {
    expect(organismePath("fr", "mairie-de-fontvieille", "/demarches/abc"))
      .toBe("/mairie-de-fontvieille/demarches/abc");
    expect(organismePath("en", "mairie-de-fontvieille", "/demarches/abc"))
      .toBe("/en/mairie-de-fontvieille/demarches/abc");
    expect(organismePath("en", "mairie-de-fontvieille", "/"))
      .toBe("/en/mairie-de-fontvieille");
  });

  it("rend le chemin de la collectivité hors de tout organisme", () => {
    expect(organismePath("fr", null, "/demarches/abc")).toBe("/demarches/abc");
    expect(organismePath("en", null, "/")).toBe("/en");
  });

  // Un aller-retour : ce qu'on écrit doit se relire.
  it("se relit par splitScopedPath", () => {
    const written = organismePath("en", "mairie-de-fontvieille", "/demarches/abc/formulaire");
    expect(splitScopedPath(written))
      .toEqual({ lang: "en", organisme: "mairie-de-fontvieille", path: "/demarches/abc/formulaire" });
  });
});
