import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS, speakable } from "./speakable.ts";

describe("speakable — une réponse écrite, rendue prononçable", () => {
  it("garde les mots et retire la mise en forme", () => {
    expect(speakable("Pour un **dépôt sauvage**, la démarche est *Signaler un problème*.")).toBe(
      "Pour un dépôt sauvage, la démarche est Signaler un problème.",
    );
  });

  // C'est la ponctuation qui fait les pauses à l'oral : sans elle, une liste
  // lue d'une traite devient une seule phrase interminable.
  it("fait de chaque élément de liste et de chaque ligne une phrase", () => {
    const text = "Il vous faudra :\n\n- une pièce d'identité\n- un justificatif de domicile\n\nAvez-vous ces documents ?";
    expect(speakable(text)).toBe(
      "Il vous faudra : une pièce d'identité. un justificatif de domicile. Avez-vous ces documents ?",
    );
  });

  it("ne double pas une ponctuation déjà là", () => {
    expect(speakable("C'est noté !\nÀ quelle adresse ?")).toBe("C'est noté ! À quelle adresse ?");
    expect(speakable("Merci « pour tout. »")).toBe("Merci « pour tout. »");
  });

  it("ne lit ni lien, ni adresse web, ni émoji, ni balise orpheline", () => {
    expect(speakable("Voir [la page](https://exemple.fr) 👍 ou www.exemple.fr **")).toBe("Voir la page ou.");
  });

  it("rend une chaîne vide quand il ne reste rien à dire", () => {
    expect(speakable("")).toBe("");
    expect(speakable("**  **\n\n- ")).toBe("");
  });

  it("coupe à la borne du guichet, sur une fin de phrase", () => {
    const long = "Une phrase assez longue pour remplir la borne. ".repeat(80);
    const spoken = speakable(long);
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(spoken.endsWith(".")).toBe(true);
  });
});
