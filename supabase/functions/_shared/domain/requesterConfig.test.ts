import { describe, expect, it } from "vitest";
import {
  CONTACT_TYPES,
  enabledAudiences,
  parseRequesterConfig,
  requesterFieldsFor,
} from "./requesterConfig.ts";

describe("parseRequesterConfig — le défaut ne demande rien", () => {
  it("un paramétrage absent ferme tous les publics et masque tous les champs", () => {
    // Minimisation des données, reprise du Socle : le portail ne demande jamais
    // ce que la collectivité n'a pas demandé — quitte à ne rien demander.
    const config = parseRequesterConfig(null);
    expect(enabledAudiences(config)).toEqual([]);
    expect(requesterFieldsFor(config, "citoyen")).toEqual([]);
  });

  it("une valeur d'état inconnue vaut masqué, pas visible", () => {
    const config = parseRequesterConfig({
      citoyen: { enabled: true, fields: { courriel: "peut-être", nom_usuel: "visible" } },
    });
    expect(requesterFieldsFor(config, "citoyen").map((field) => field.key)).toEqual(["nom_usuel"]);
  });

  it("rend les champs ouverts dans l'ordre du Socle, avec leur caractère obligatoire", () => {
    const config = parseRequesterConfig({
      citoyen: {
        enabled: true,
        fields: { courriel: "obligatoire", prenoms: "visible", nom_usuel: "visible" },
      },
    });
    expect(requesterFieldsFor(config, "citoyen")).toEqual([
      { key: "nom_usuel", label: "Nom usuel", required: false },
      { key: "prenoms", label: "Prénom(s)", required: false },
      { key: "courriel", label: "Courriel", required: true },
    ]);
  });

  it("ne retient que les publics activés, dans l'ordre d'affichage", () => {
    const config = parseRequesterConfig({
      association: { enabled: true, fields: {} },
      citoyen: { enabled: true, fields: {} },
      entreprise: { enabled: false, fields: {} },
    });
    expect(enabledAudiences(config)).toEqual(["citoyen", "association"]);
  });

  it("traduit le public du paramétrage en type de fiche du référentiel", () => {
    // Deux vocabulaires pour la même chose : « citoyen » au paramétrage,
    // « personne » au référentiel. La traduction vit ici, une seule fois.
    expect(CONTACT_TYPES.citoyen).toBe("personne");
    expect(CONTACT_TYPES.entreprise).toBe("entreprise");
    expect(CONTACT_TYPES.association).toBe("association");
  });
});
