import { describe, expect, it } from "vitest";
import type { Profil } from "@fn/_shared/domain/profil.ts";
import { STRINGS } from "@/i18n/strings.ts";
import {
  coordonneesDraftOf,
  EMPTY_IDENTITE,
  PROFIL_MESSAGES,
  profilErrorKey,
  profilFailureAsAccount,
  validateCoordonnees,
  validateIdentite,
} from "./profilForm.ts";

const VALID = {
  ...EMPTY_IDENTITE,
  civilite: "madame" as const,
  prenom: " Anne ",
  nom: "Martin",
  adresse1: "1 rue des Fleurs",
  codePostal: "46000",
  ville: "Cahors",
};

describe("validateIdentite", () => {
  it("accepte l'identité minimale et vide les facultatifs en null", () => {
    const result = validateIdentite(VALID);
    expect(result).toEqual({
      ok: true,
      value: {
        civilite: "madame", prenom: "Anne", nom: "Martin", nomUsage: null, dateNaissance: null, mobile: null,
        fixe: null, adresse1: "1 rue des Fleurs", adresse2: null, codePostal: "46000", ville: "Cahors",
      },
    });
  });

  it("signale chaque champ en défaut, avec le message de sa règle", () => {
    const result = validateIdentite({ ...EMPTY_IDENTITE, codePostal: "460", mobile: "abc", dateNaissance: "12/03/1980" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toMatchObject({
      civilite: "compte.profil.error.civilite",
      prenom: "compte.profil.error.required",
      nom: "compte.profil.error.required",
      adresse1: "compte.profil.error.required",
      codePostal: "compte.profil.error.codePostal",
      ville: "compte.profil.error.required",
      mobile: "compte.profil.error.phone",
      dateNaissance: "compte.profil.error.date",
    });
  });
});

describe("validateCoordonnees", () => {
  it("laisse effacer un champ facultatif mais pas un obligatoire", () => {
    expect(validateCoordonnees({ nomUsage: "", mobile: "", fixe: "", adresse1: "2 rue X", adresse2: "", codePostal: "46000", ville: "Cahors" }))
      .toMatchObject({ ok: true, value: { mobile: null, adresse1: "2 rue X" } });
    const bad = validateCoordonnees({ nomUsage: "", mobile: "", fixe: "", adresse1: "", adresse2: "", codePostal: "46000", ville: "Cahors" });
    expect(bad).toEqual({ ok: false, errors: { adresse1: "compte.profil.error.required" } });
  });

  it("repart du profil actuel, null devenant vide", () => {
    const profil = { nomUsage: null, mobile: "0612345678", fixe: null, adresse1: "1", adresse2: null, codePostal: "46000", ville: "C" } as Profil;
    expect(coordonneesDraftOf(profil)).toEqual({
      nomUsage: "", mobile: "0612345678", fixe: "", adresse1: "1", adresse2: "", codePostal: "46000", ville: "C",
    });
  });
});

describe("les textes", () => {
  it("chaque message existe au dictionnaire", () => {
    for (const champ of ["civilite", "prenom", "codePostal", "mobile", "dateNaissance"] as const) {
      expect(STRINGS[profilErrorKey(champ)].fr).toBeTruthy();
    }
    for (const key of Object.values(PROFIL_MESSAGES)) expect(STRINGS[key].fr).toBeTruthy();
  });

  it("un refus du serveur se lit comme une mauvaise saisie, une panne comme une indisponibilité", () => {
    expect(profilFailureAsAccount("profil_refuse")).toBe("bad_request");
    expect(profilFailureAsAccount("profil_indisponible")).toBe("account_unavailable");
    expect(profilFailureAsAccount("network")).toBe("network");
  });
});
