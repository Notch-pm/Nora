import { describe, expect, it } from "vitest";
import {
  type Demarche,
  type DemarcheOrganization,
  demarchesOfOrganization,
  organizationBySlug,
} from "./demarche.ts";

const ACCM: DemarcheOrganization = { id: "accm", name: "ACCM", slug: "laurentville" };
const ARLES: DemarcheOrganization = { id: "arles", name: "Mairie d'Arles", slug: "mairie-d-arles" };
const CRAU: DemarcheOrganization = {
  id: "crau",
  name: "Mairie de Saint Martin de Crau",
  slug: "mairie-annexe",
};
/** Un organisme auquel personne n'a donné de slug : il n'a pas d'adresse. */
const SANS_SLUG: DemarcheOrganization = { id: "sans", name: "Service sans slug", slug: null };

function demarche(id: string, organizations: DemarcheOrganization[]): Demarche {
  return {
    id,
    name: `Démarche ${id}`,
    description: null,
    estimatedMinutes: null,
    organizations,
    audiences: [],
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
