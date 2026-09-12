import { describe, expect, it } from "vitest";
import { isArrival, pageKey, pageOf } from "./pageView.ts";

describe("pageOf — quel écran l'adresse désigne", () => {
  it("reconnaît les trois écrans, avec et sans préfixe de langue", () => {
    expect(pageOf("/")).toEqual({ page: "accueil", demarcheId: null });
    expect(pageOf("/en")).toEqual({ page: "accueil", demarcheId: null });
    expect(pageOf("/demarches/abc")).toEqual({ page: "demarche", demarcheId: "abc" });
    expect(pageOf("/oc/demarches/abc")).toEqual({ page: "demarche", demarcheId: "abc" });
    expect(pageOf("/demarches/abc/formulaire")).toEqual({ page: "formulaire", demarcheId: "abc" });
    expect(pageOf("/gsw/demarches/abc/formulaire"))
      .toEqual({ page: "formulaire", demarcheId: "abc" });
  });

  // ⚠️ Les trois pages sont un contrat partagé avec le Socle (la contrainte
  // `portal_audience_pages_page_check`) : une route ajoutée demain ne doit pas
  // se compter toute seule sous un nom approximatif.
  it("ne compte rien pour une adresse qui n'est aucun des trois écrans", () => {
    for (const path of [
      "/demarches",
      "/demarches/abc/autre",
      "/demarches/abc/formulaire/etape",
      "/actualites",
      "/en/actualites",
    ]) {
      expect(pageOf(path)).toBeNull();
    }
  });

  // « demarches » fait trois lettres minuscules : sans cette précaution, il
  // serait pris pour un code de langue et l'adresse ne se lirait plus.
  it("ne prend jamais « demarches » pour un code de langue", () => {
    expect(pageOf("/demarches/abc")).toEqual({ page: "demarche", demarcheId: "abc" });
  });

  it("tolère les barres superflues", () => {
    expect(pageOf("//demarches//abc//")).toEqual({ page: "demarche", demarcheId: "abc" });
  });
});

describe("pageKey — ce qui a déjà été compté dans l'onglet", () => {
  // ⚠️ Changer de langue sur la même page n'est PAS une nouvelle page vue :
  // sans cela, un visiteur qui bascule en breton doublerait les compteurs de la
  // page qu'il est en train de lire.
  it("est la même clé quelle que soit la langue", () => {
    expect(pageKey(pageOf("/demarches/abc")!)).toBe(pageKey(pageOf("/oc/demarches/abc")!));
    expect(pageKey(pageOf("/")!)).toBe(pageKey(pageOf("/en")!));
  });

  it("distingue les écrans et les démarches", () => {
    const keys = ["/", "/demarches/a", "/demarches/b", "/demarches/a/formulaire"]
      .map((p) => pageKey(pageOf(p)!));
    expect(new Set(keys).size).toBe(4);
  });
});

describe("isArrival — une visite est une arrivée sur le site", () => {
  const host = "laurentville.edilumen.fr";

  // ⚠️ La majorité des vraies arrivées : adresse tapée, favori, lien d'un
  // courriel ou d'une application. Les exclure viderait la mesure de son sens.
  it("compte une arrivée quand le référent est vide", () => {
    expect(isArrival({ referrer: "", host, navigationType: "navigate" })).toBe(true);
  });

  it("compte une arrivée quand le référent est un autre site", () => {
    expect(isArrival({ referrer: "https://www.google.com/", host, navigationType: "navigate" }))
      .toBe(true);
  });

  it("ne compte pas une navigation interne", () => {
    expect(isArrival({ referrer: `https://${host}/demarches/a`, host, navigationType: "navigate" }))
      .toBe(false);
  });

  it("ne compte ni un rechargement ni un retour arrière", () => {
    expect(isArrival({ referrer: "", host, navigationType: "reload" })).toBe(false);
    expect(isArrival({ referrer: "https://ailleurs.fr/", host, navigationType: "back_forward" }))
      .toBe(false);
  });

  // Plutôt perdre la finesse que la mesure : un référent illisible se lit comme
  // une arrivée.
  it("compte une arrivée quand le référent est illisible", () => {
    expect(isArrival({ referrer: "pas une url", host, navigationType: null })).toBe(true);
  });

  it("distingue un sous-domaine voisin du site lui-même", () => {
    expect(isArrival({ referrer: "https://autre.edilumen.fr/", host, navigationType: "navigate" }))
      .toBe(true);
  });
});

describe("pageOf — sous le périmètre d'un organisme", () => {
  // ⚠️ LE FILET DE CE LOT : une démarche atteinte par la page d'une mairie doit
  // continuer à se compter comme une démarche. Sans cela, ouvrir les adresses
  // d'organisme aurait éteint la mesure sur ces parcours, en silence.
  it("compte toujours la démarche et son formulaire", () => {
    expect(pageOf("/mairie-de-fontvieille/demarches/abc"))
      .toEqual({ page: "demarche", demarcheId: "abc" });
    expect(pageOf("/mairie-de-fontvieille/demarches/abc/formulaire"))
      .toEqual({ page: "formulaire", demarcheId: "abc" });
    expect(pageOf("/en/mairie-de-fontvieille/demarches/abc"))
      .toEqual({ page: "demarche", demarcheId: "abc" });
  });

  // ⚠️ Décision assumée : la page d'un organisme n'est pas comptée tant que
  // `page` n'a que trois valeurs au contrat. La compter « accueil » gonflerait
  // l'accueil de la collectivité de visites qui ne l'ont jamais vu.
  it("ne compte pas la page de l'organisme elle-même", () => {
    expect(pageOf("/mairie-de-fontvieille")).toBeNull();
    expect(pageOf("/en/mairie-de-fontvieille")).toBeNull();
  });

  it("ne confond pas le périmètre d'un organisme avec l'accueil", () => {
    expect(pageOf("/")).toEqual({ page: "accueil", demarcheId: null });
    expect(pageOf("/en")).toEqual({ page: "accueil", demarcheId: null });
  });

  // La clé de déduplication ignore le périmètre : la même démarche, vue depuis
  // l'accueil puis depuis la page d'une mairie, reste la même page.
  it("rend la même clé de page avec ou sans organisme", () => {
    const direct = pageOf("/demarches/abc");
    const scoped = pageOf("/mairie-de-fontvieille/demarches/abc");
    expect(direct).not.toBeNull();
    expect(scoped).not.toBeNull();
    expect(pageKey(direct!)).toBe(pageKey(scoped!));
  });
});
