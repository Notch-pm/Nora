import { describe, expect, it } from "vitest";
import {
  type Demarche,
  type DemarcheOrganization,
  demarchesOfOrganization,
  organizationBySlug,
  villesOf,
} from "./demarche.ts";

const ACCM: DemarcheOrganization = {
  id: "accm",
  name: "ACCM",
  slug: "laurentville",
  logoUrl: "https://exemple.fr/accm.png",
};
const ARLES: DemarcheOrganization = {
  id: "arles",
  name: "Mairie d'Arles",
  slug: "mairie-d-arles",
  logoUrl: "https://exemple.fr/arles.png",
};
const CRAU: DemarcheOrganization = {
  id: "crau",
  name: "Mairie de Saint Martin de Crau",
  slug: "mairie-annexe",
  // Pas de logo à elle : la liste affichera une pastille, jamais celui d'ACCM.
  logoUrl: null,
};
/** Un organisme auquel personne n'a donné de slug : il n'a pas d'adresse. */
const SANS_SLUG: DemarcheOrganization = {
  id: "sans",
  name: "Service sans slug",
  slug: null,
  logoUrl: null,
};

function demarche(id: string, organizations: DemarcheOrganization[]): Demarche {
  return {
    id,
    name: `Démarche ${id}`,
    description: null,
    estimatedMinutes: null,
    organizations,
    audiences: [],
    category: null,
  };
}

const CATALOGUE: Demarche[] = [
  demarche("etat-civil", [ACCM, ARLES]),
  demarche("voirie", [ARLES, CRAU]),
  demarche("urbanisme", [ACCM]),
  demarche("interne", [SANS_SLUG]),
];

describe("organizationBySlug — l'organisme qu'une adresse désigne", () => {
  it("trouve l'organisme par son slug, où qu'il apparaisse dans le catalogue", () => {
    expect(organizationBySlug(CATALOGUE, "mairie-d-arles", "accm")).toEqual(ARLES);
    // `mairie-annexe` n'apparaît que sur la deuxième démarche.
    expect(organizationBySlug(CATALOGUE, "mairie-annexe", "accm")).toEqual(CRAU);
  });

  // ⚠️ La page de la collectivité, c'est l'accueil du portail. La servir aussi
  // sous son slug ferait deux adresses pour la même page.
  it("écarte la collectivité elle-même", () => {
    expect(organizationBySlug(CATALOGUE, "laurentville", "accm")).toBeNull();
  });

  it("ne trouve rien pour un slug inventé, vide, ou absent du catalogue", () => {
    expect(organizationBySlug(CATALOGUE, "mairie-de-nulle-part", "accm")).toBeNull();
    expect(organizationBySlug(CATALOGUE, "", "accm")).toBeNull();
    expect(organizationBySlug(CATALOGUE, "   ", "accm")).toBeNull();
    expect(organizationBySlug([], "mairie-d-arles", "accm")).toBeNull();
  });

  // Un organisme sans slug reste une entrée du filtre et une puce sur les
  // cartes : il n'a simplement pas de page.
  it("n'ouvre aucune page pour un organisme sans slug", () => {
    expect(organizationBySlug(CATALOGUE, "sans", "accm")).toBeNull();
    expect(organizationBySlug(CATALOGUE, "null", "accm")).toBeNull();
  });

  // Une adresse tapée en majuscules par un habitant doit ouvrir la page.
  it("ignore la casse et les espaces autour du slug", () => {
    expect(organizationBySlug(CATALOGUE, "Mairie-D-Arles", "accm")).toEqual(ARLES);
    expect(organizationBySlug(CATALOGUE, " mairie-d-arles ", "accm")).toEqual(ARLES);
  });
});

describe("demarchesOfOrganization — ce que cet organisme propose", () => {
  it("ne garde que les démarches de cet organisme, dans l'ordre du catalogue", () => {
    expect(demarchesOfOrganization(CATALOGUE, "arles").map((d) => d.id))
      .toEqual(["etat-civil", "voirie"]);
    expect(demarchesOfOrganization(CATALOGUE, "crau").map((d) => d.id)).toEqual(["voirie"]);
  });

  // La collectivité racine propose les siennes : c'est ce que rend l'accueil,
  // et la fonction n'a pas de cas particulier pour elle.
  it("répond aussi pour la collectivité elle-même", () => {
    expect(demarchesOfOrganization(CATALOGUE, "accm").map((d) => d.id))
      .toEqual(["etat-civil", "urbanisme"]);
  });

  it("rend une liste vide pour un organisme inconnu", () => {
    expect(demarchesOfOrganization(CATALOGUE, "personne")).toEqual([]);
  });
});

describe("villesOf — la liste du menu « Ma ville »", () => {
  it("rend les organismes qui ont une page, triés par nom, avec leur logo", () => {
    expect(villesOf(CATALOGUE, "accm")).toEqual([
      { id: "arles", name: "Mairie d'Arles", slug: "mairie-d-arles", logoUrl: "https://exemple.fr/arles.png" },
      { id: "crau", name: "Mairie de Saint Martin de Crau", slug: "mairie-annexe", logoUrl: null },
    ]);
  });

  // ⚠️ La page de la collectivité est l'accueil du portail : une entrée de
  // menu vers elle ferait deux chemins vers la même page.
  it("écarte la collectivité elle-même", () => {
    expect(villesOf(CATALOGUE, "accm").some((v) => v.id === "accm")).toBe(false);
    // Et si on visite le portail d'un autre tenant, c'est l'autre qui sort.
    expect(villesOf(CATALOGUE, "arles").map((v) => v.id)).toEqual(["accm", "crau"]);
  });

  // Sans slug, pas d'adresse : une entrée de menu qui ne mène nulle part.
  it("écarte un organisme sans slug", () => {
    expect(villesOf(CATALOGUE, "accm").some((v) => v.id === "sans")).toBe(false);
  });

  it("ne nomme chaque ville qu'une fois, quel que soit le nombre de démarches", () => {
    const villes = villesOf(CATALOGUE, "accm");
    expect(new Set(villes.map((v) => v.id)).size).toBe(villes.length);
  });

  it("rend une liste vide quand rien n'est publié", () => {
    expect(villesOf([], "accm")).toEqual([]);
  });

  // Le tri est celui d'une liste lue en français : « Étoile » avant « Fontvieille ».
  it("trie sans se laisser piéger par les accents", () => {
    const etoile: DemarcheOrganization = {
      id: "etoile",
      name: "Étoile-sur-Rhône",
      slug: "etoile-sur-rhone",
      logoUrl: null,
    };
    const fontvieille: DemarcheOrganization = {
      id: "font",
      name: "Fontvieille",
      slug: "mairie-de-fontvieille",
      logoUrl: null,
    };
    const catalogue = [demarche("d", [fontvieille, etoile])];
    expect(villesOf(catalogue, "accm").map((v) => v.name)).toEqual([
      "Étoile-sur-Rhône",
      "Fontvieille",
    ]);
  });
});

describe("villesOf — les organismes qui reçoivent du courrier libre", () => {
  it("⚠️ ajoute un organisme SANS démarche publiée, sans logo propre", () => {
    const villes = villesOf(CATALOGUE, "accm", [{ id: "fontvieille", name: "Fontvieille", slug: "mairie-de-fontvieille" }]);
    expect(villes.map((v) => v.id)).toEqual(["fontvieille", "arles", "crau"]);
    expect(villes[0].logoUrl).toBeNull();
  });

  it("le catalogue passe d'abord : un organisme qui publie garde son logo", () => {
    const villes = villesOf(CATALOGUE, "accm", [{ id: "arles", name: "Arles (doublon)", slug: "mairie-d-arles" }]);
    expect(villes.find((v) => v.id === "arles")).toEqual({
      id: "arles",
      name: "Mairie d'Arles",
      slug: "mairie-d-arles",
      logoUrl: "https://exemple.fr/arles.png",
    });
  });

  it("mêmes exclusions : ni la collectivité, ni un organisme sans slug", () => {
    expect(
      villesOf([], "accm", [
        { id: "accm", name: "ACCM", slug: "laurentville" },
        { id: "x", name: "Sans adresse", slug: null },
      ]),
    ).toEqual([]);
  });
});
