import { describe, expect, it } from "vitest";
import { assistantPriority, readsAsSentence } from "./promotion.ts";

describe("readsAsSentence — un mot-clé, ou une situation racontée", () => {
  it("une phrase de cinq mots ou plus en est une", () => {
    expect(readsAsSentence("il y a un depot sauvage devant chez moi")).toBe(true);
    expect(readsAsSentence("acte de naissance")).toBe(false);
  });

  it("rattrape la phrase courte mais parlée, par son verbe", () => {
    expect(readsAsSentence("mon voisin brûle des déchets")).toBe(true);
    expect(readsAsSentence("je voudrais signaler")).toBe(true);
    expect(readsAsSentence("le lampadaire est cassé")).toBe(true);
  });

  it("lit les accents et les apostrophes comme l'usager les tape", () => {
    expect(readsAsSentence("j'habite ici")).toBe(true);
    expect(readsAsSentence("j’habite ici")).toBe(true); // apostrophe typographique
    expect(readsAsSentence("le trottoir était bloqué")).toBe(true);
  });

  it("⚠️ « à » n'est pas le verbe « a » — sans quoi tout devient une phrase", () => {
    // Sans accents, « à » et « a » sont le même mot : c'est le piège de la
    // détection de verbe en français, et il ferait promouvoir l'assistant
    // devant quelqu'un qui savait exactement ce qu'il cherchait.
    expect(readsAsSentence("demande à la mairie")).toBe(false);
    expect(readsAsSentence("salle à louer")).toBe(false);
    // Mais « il y a » reste une phrase.
    expect(readsAsSentence("il y a des gravats")).toBe(true);
  });

  it("ne prend pas un nom pour un verbe", () => {
    for (const keyword of [
      "acte de naissance",
      "recensement citoyen",
      "salle municipale",
      "listes électorales",
      "dépôt sauvage",
      "permis de construire",
    ]) {
      expect(readsAsSentence(keyword), keyword).toBe(false);
    }
  });
});

describe("assistantPriority — où l'assistant se place dans les suggestions", () => {
  it("se tait tant que la saisie ne dit rien", () => {
    expect(assistantPriority("", 12)).toBe("none");
    expect(assistantPriority("  ", 12)).toBe("none");
    expect(assistantPriority("dé", 3)).toBe("none");
  });

  it("reste en pied de liste quand l'index trouve et qu'on tape un mot-clé", () => {
    expect(assistantPriority("dépôt", 2)).toBe("low");
    expect(assistantPriority("acte de naissance", 1)).toBe("low");
  });

  it("passe en tête quand l'usager raconte sa situation", () => {
    expect(assistantPriority("il y a un dépôt sauvage devant chez moi", 2)).toBe("high");
  });

  it("⚠️ zéro correspondance promeut TOUJOURS, même sur un seul mot", () => {
    // Il n'y a littéralement rien d'autre à montrer : l'assistant n'est plus
    // une option parmi d'autres.
    expect(assistantPriority("xyzzy", 0)).toBe("high");
    expect(assistantPriority("cimetière", 0)).toBe("high");
  });

  it("⚠️ l'usager pressé ne le voit presque jamais en tête", () => {
    // Le scénario que la règle doit protéger : quelqu'un qui sait, et que
    // l'assistant ne doit pas venir déranger.
    for (const keyword of ["acte", "état civil", "recensement", "salle des fêtes"]) {
      expect(assistantPriority(keyword, 3), keyword).toBe("low");
    }
  });
});
