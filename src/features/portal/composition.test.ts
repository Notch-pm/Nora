import { describe, expect, it } from "vitest";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import {
  filterDemarchesByQuery,
  gridColumnsClass,
  MAX_SHORTCUTS,
  orderDemarchesForSection,
  resolveShortcuts,
} from "./composition.ts";

function demarche(id: string, name: string, description: string | null = null): Demarche {
  return { id, name, description, estimatedMinutes: null };
}

describe("orderDemarchesForSection", () => {
  it("remonte les démarches épinglées en tête quand pinnedFirst est vrai", () => {
    const demarches = [
      demarche("a", "Acte de naissance"),
      demarche("b", "Carte d'identité"),
      demarche("c", "Éclairage public"),
    ];
    const ordered = orderDemarchesForSection(demarches, ["c"], true);
    expect(ordered.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("garde l'ordre publié par le Socle quand pinnedFirst est faux", () => {
    const demarches = [
      demarche("a", "Acte de naissance"),
      demarche("b", "Carte d'identité"),
      demarche("c", "Éclairage public"),
    ];
    // Une démarche épinglée mais pinnedFirst désactivé : l'ordre ne bouge pas.
    const ordered = orderDemarchesForSection(demarches, ["c"], false);
    expect(ordered.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });
});

describe("filterDemarchesByQuery", () => {
  it("ignore la casse", () => {
    const demarches = [demarche("a", "Acte de naissance")];
    expect(filterDemarchesByQuery(demarches, "ACTE").map((d) => d.id)).toEqual(["a"]);
  });

  it("ignore les accents, dans la requête comme dans la démarche", () => {
    const demarches = [demarche("a", "Éclairage public")];
    expect(filterDemarchesByQuery(demarches, "eclairage").map((d) => d.id)).toEqual(["a"]);
  });

  it("cherche aussi dans la description", () => {
    const demarches = [
      demarche("a", "Formulaire", "Demande de raccordement électrique"),
      demarche("b", "Autre démarche", null),
    ];
    expect(filterDemarchesByQuery(demarches, "raccordement").map((d) => d.id)).toEqual(["a"]);
  });

  it("une requête vide ne filtre rien", () => {
    const demarches = [demarche("a", "Acte de naissance"), demarche("b", "Carte d'identité")];
    expect(filterDemarchesByQuery(demarches, "   ")).toEqual(demarches);
  });

  it("écarte ce qui ne correspond pas", () => {
    const demarches = [demarche("a", "Acte de naissance")];
    expect(filterDemarchesByQuery(demarches, "passeport")).toEqual([]);
  });
});

describe("resolveShortcuts", () => {
  it("ignore un raccourci dont l'id est absent du catalogue", () => {
    const demarches = [demarche("a", "Acte de naissance")];
    const shortcuts = resolveShortcuts(["a", "id-disparu"], demarches);
    expect(shortcuts.map((d) => d.id)).toEqual(["a"]);
  });

  it("s'arrête à MAX_SHORTCUTS même si la liste reçue est plus longue", () => {
    const demarches = Array.from({ length: MAX_SHORTCUTS + 2 }, (_, i) =>
      demarche(`id-${i}`, `Démarche ${i}`),
    );
    const shortcuts = resolveShortcuts(
      demarches.map((d) => d.id),
      demarches,
    );
    expect(shortcuts).toHaveLength(MAX_SHORTCUTS);
  });
});

describe("gridColumnsClass", () => {
  it("produit la classe littérale attendue pour 2, 3 et 4 colonnes", () => {
    expect(gridColumnsClass(2)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-2");
    expect(gridColumnsClass(3)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-3");
    expect(gridColumnsClass(4)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-4");
  });
});
