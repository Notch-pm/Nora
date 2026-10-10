import { describe, expect, it } from "vitest";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import { organismeEmptyKey, visibleOrganismeDemarches } from "./composition.ts";

const ORG = { id: "org-1", name: "Mairie d'Arles", slug: "arles", logoUrl: null };

function demarche(
  id: string,
  name: string,
  audiences: Demarche["audiences"] = ["citoyen"],
): Demarche {
  return { id, name, description: null, estimatedMinutes: null, organizations: [ORG], audiences, category: null };
}

describe("visibleOrganismeDemarches", () => {
  const demarches = [
    demarche("a", "Acte de naissance", ["citoyen"]),
    demarche("b", "Voirie", ["citoyen", "entreprise"]),
    demarche("c", "Domiciliation d'entreprise", ["entreprise"]),
  ];

  it("sans recherche ni public, rien n'est filtré", () => {
    expect(visibleOrganismeDemarches(demarches, "", null)).toEqual(demarches);
  });

  it("filtre par recherche", () => {
    expect(visibleOrganismeDemarches(demarches, "entreprise", null).map((d) => d.id)).toEqual([
      "c",
    ]);
  });

  it("filtre par public, sur le résultat déjà réduit par la recherche", () => {
    // « Voirie » matche la recherche ET vise les deux publics : les deux
    // filtres se cumulent, ils ne se remplacent pas.
    expect(visibleOrganismeDemarches(demarches, "voirie", "entreprise").map((d) => d.id)).toEqual([
      "b",
    ]);
  });

  it("public seul, sans recherche", () => {
    expect(visibleOrganismeDemarches(demarches, "", "entreprise").map((d) => d.id)).toEqual([
      "b",
      "c",
    ]);
  });
});

describe("organismeEmptyKey", () => {
  it("sans recherche ni public : le texte propre à un organisme sans rien publié", () => {
    expect(organismeEmptyKey(false, null)).toBe("empty.organization");
  });

  it("une recherche en cours prime sur tout le reste", () => {
    expect(organismeEmptyKey(true, "entreprise")).toBe("empty.search");
  });

  it("un public choisi, sans recherche : les deux filtres à la fois", () => {
    // Cette page a déjà un organisme « choisi » de fait : avec un public en
    // plus, on retombe donc sur le texte à deux filtres, comme l'accueil.
    expect(organismeEmptyKey(false, "entreprise")).toBe("empty.filters");
  });
});
