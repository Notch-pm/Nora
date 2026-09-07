import { describe, expect, it } from "vitest";
import { localizedPath, splitLangPath } from "./localizedPath.ts";

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
