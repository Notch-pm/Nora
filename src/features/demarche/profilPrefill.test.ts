import { describe, expect, it } from "vitest";
import { requesterValuesFromProfil, type Profil } from "@fn/_shared/domain/profil.ts";
import { hasPrefillFor, mergePrefill } from "./profilPrefill.ts";

describe("mergePrefill", () => {
  const profil = { nom_usuel: "Durand", prenoms: "Anne", courriel: "a@b.fr" };

  it("remplit les champs visibles et vides", () => {
    expect(mergePrefill({}, profil, ["nom_usuel", "prenoms"])).toEqual({ nom_usuel: "Durand", prenoms: "Anne" });
  });

  it("n'écrase jamais une saisie", () => {
    expect(mergePrefill({ nom_usuel: "Martin" }, profil, ["nom_usuel", "prenoms"])).toEqual({
      nom_usuel: "Martin",
      prenoms: "Anne",
    });
  });

  it("une saisie faite d'espaces compte pour vide", () => {
    expect(mergePrefill({ prenoms: "  " }, profil, ["prenoms"])).toEqual({ prenoms: "Anne" });
  });

  it("ignore les champs masqués par le paramétrage", () => {
    expect(mergePrefill({}, profil, ["prenoms"])).toEqual({ prenoms: "Anne" });
    expect(mergePrefill({}, profil, [])).toEqual({});
  });

  it("rend la même référence quand rien ne change", () => {
    const current = { nom_usuel: "Martin" };
    expect(mergePrefill(current, profil, ["nom_usuel"])).toBe(current);
  });

  it("ne touche pas à l'objet reçu", () => {
    const current = {};
    mergePrefill(current, profil, ["prenoms"]);
    expect(current).toEqual({});
  });

  it("fonctionne avec les clés produites par requesterValuesFromProfil", () => {
    const full: Profil = {
      civilite: "madame",
      prenom: "Anne",
      nom: "Durand",
      nomUsage: null,
      dateNaissance: null,
      courriel: "a@b.fr",
      mobile: null,
      fixe: null,
      adresse1: "1 rue X",
      adresse2: null,
      codePostal: "92330",
      ville: "Sceaux",
      consentements: { traitement: null, partage: null },
    };
    const values = requesterValuesFromProfil(full);
    expect(mergePrefill({}, values, ["civilite", "adresse", "tel_portable"])).toEqual({
      civilite: "madame",
      adresse: "1 rue X, 92330 Sceaux",
    });
  });
});

describe("hasPrefillFor", () => {
  it("vrai seulement si un champ visible recevrait une valeur", () => {
    expect(hasPrefillFor({ prenoms: "Anne" }, ["prenoms"])).toBe(true);
    expect(hasPrefillFor({ prenoms: "Anne" }, ["nom_usuel"])).toBe(false);
    expect(hasPrefillFor({ prenoms: " " }, ["prenoms"])).toBe(false);
  });
});
