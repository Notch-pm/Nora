import { describe, expect, it } from "vitest";
import { requesterValuesFromProfil, type Profil } from "@fn/_shared/domain/profil.ts";
import { applyLocked, lockedFromProfil } from "./profilPrefill.ts";

describe("lockedFromProfil", () => {
  const profil = { nom_usuel: "Durand", prenoms: "Anne", courriel: "a@b.fr", tel_fixe: "  " };

  it("verrouille les champs visibles que la fiche renseigne", () => {
    expect(lockedFromProfil(profil, ["nom_usuel", "prenoms"])).toEqual({ nom_usuel: "Durand", prenoms: "Anne" });
  });

  it("ignore les champs masqués par le paramétrage", () => {
    expect(lockedFromProfil(profil, ["prenoms"])).toEqual({ prenoms: "Anne" });
    expect(lockedFromProfil(profil, [])).toEqual({});
  });

  it("un champ que la fiche ne renseigne pas reste libre", () => {
    expect(lockedFromProfil(profil, ["tel_fixe", "tel_portable"])).toEqual({});
  });

  it("fonctionne avec les clés produites par requesterValuesFromProfil (celles que le serveur impose)", () => {
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
    expect(lockedFromProfil(requesterValuesFromProfil(full), ["civilite", "adresse", "tel_portable"])).toEqual({
      civilite: "madame",
      adresse: "1 rue X, 92330 Sceaux",
    });
  });
});

describe("applyLocked", () => {
  it("impose la fiche, même sur une saisie déjà faite", () => {
    expect(applyLocked({ nom_usuel: "Martin", objet: "x" }, { nom_usuel: "Durand" })).toEqual({ nom_usuel: "Durand", objet: "x" });
  });

  it("rend la même référence quand rien ne change", () => {
    const current = { nom_usuel: "Durand" };
    expect(applyLocked(current, { nom_usuel: "Durand" })).toBe(current);
    expect(applyLocked(current, {})).toBe(current);
  });

  it("ne touche pas à l'objet reçu", () => {
    const current = {};
    applyLocked(current, { prenoms: "Anne" });
    expect(current).toEqual({});
  });
});
