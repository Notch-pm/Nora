import { describe, expect, it } from "vitest";
import { autocompleteFor } from "./autocomplete.ts";

describe("autocompleteFor", () => {
  it("associe chaque champ d'identité à son jeton standard", () => {
    expect(autocompleteFor("civilite")).toBe("honorific-prefix");
    expect(autocompleteFor("prenoms")).toBe("given-name");
    expect(autocompleteFor("nom_naissance")).toBe("family-name");
    expect(autocompleteFor("nom_usuel")).toBe("family-name");
    expect(autocompleteFor("courriel")).toBe("email");
    expect(autocompleteFor("tel_portable")).toBe("mobile tel");
    expect(autocompleteFor("tel_fixe")).toBe("home tel");
    expect(autocompleteFor("adresse")).toBe("street-address");
    expect(autocompleteFor("raison_sociale")).toBe("organization");
  });

  it("rend `undefined` pour un champ sans jeton connu — pas un attribut vide", () => {
    expect(autocompleteFor("siret")).toBeUndefined();
    expect(autocompleteFor("inconnu")).toBeUndefined();
  });
});
