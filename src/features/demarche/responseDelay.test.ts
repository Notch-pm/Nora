import { describe, expect, it } from "vitest";
import type { ResponseDelay } from "@fn/_shared/domain/userCommunication.ts";
import { responseDelayText as raw } from "./responseDelay.ts";

// `Intl` sépare le nombre de l'unité d'une espace INSÉCABLE (« 3 semaines » ne
// se coupe pas en fin de ligne) ; les attentes s'écrivent plus lisiblement
// avec une espace ordinaire.
const responseDelayText = (lang: string, delay: ResponseDelay) => raw(lang, delay).replace(/\s/g, " ");

describe("responseDelayText — l'unité de la collectivité, dans la langue de l'outil", () => {
  it("écrit chacune des quatre unités en français", () => {
    expect(responseDelayText("fr", { value: 5, unit: "jour_ouvre" })).toBe("5 jours ouvrés");
    expect(responseDelayText("fr", { value: 15, unit: "jour" })).toBe("15 jours");
    expect(responseDelayText("fr", { value: 3, unit: "semaine" })).toBe("3 semaines");
    expect(responseDelayText("fr", { value: 2, unit: "mois" })).toBe("2 mois");
  });

  it("accorde au singulier", () => {
    expect(responseDelayText("fr", { value: 1, unit: "jour_ouvre" })).toBe("1 jour ouvré");
    expect(responseDelayText("fr", { value: 1, unit: "semaine" })).toBe("1 semaine");
  });

  // ⚠️ « 30 » ne dit pas si ce sont trente jours ou trente jours ouvrés : le
  // même nombre donne quatre textes, selon l'unité servie.
  it("⚠️ n'infère jamais l'unité du nombre", () => {
    const texts = (["jour_ouvre", "jour", "semaine", "mois"] as const).map((unit) =>
      responseDelayText("fr", { value: 30, unit }),
    );
    expect(new Set(texts).size).toBe(4);
  });

  it("parle la langue du visiteur quand l'outil la couvre", () => {
    expect(responseDelayText("en", { value: 3, unit: "semaine" })).toBe("3 weeks");
    expect(responseDelayText("en", { value: 5, unit: "jour_ouvre" })).toBe("5 working days");
    // Les trois formes du russe, qu'un dictionnaire à deux formes raterait.
    expect(responseDelayText("ru", { value: 2, unit: "mois" })).toBe("2 месяца");
    expect(responseDelayText("ru", { value: 15, unit: "jour" })).toBe("15 дней");
  });

  it("dans une langue que l'outil ne couvre pas, reste en français — comme son étiquette", () => {
    expect(responseDelayText("br", { value: 3, unit: "semaine" })).toBe("3 semaines");
  });
});
