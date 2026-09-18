import { describe, expect, it } from "vitest";
import { emptyUserCommunication, parseUserCommunication } from "./userCommunication.ts";

/** Ce que le Socle sert, tel que le contrat 1.24.0 le décrit (recensement d'ACCM). */
const SERVI = {
  delays: { processingTimeValue: 15, processingTimeUnit: "jour" },
  audience: { note: "Concerne les jeunes de nationalité française." },
  attachments: {
    items: [
      { label: "Une pièce d'identité du jeune", description: "Carte nationale d'identité ou passeport" },
      { label: "Le livret de famille", description: "" },
    ],
  },
  faq: {
    items: [{ question: "J'ai dépassé les trois mois, est-ce trop tard ?", answer: "Non." }],
  },
};

describe("parseUserCommunication — ce que la collectivité a écrit", () => {
  it("traduit les quatre blocs dans le vocabulaire du portail", () => {
    expect(parseUserCommunication(SERVI)).toEqual({
      responseDelay: { value: 15, unit: "jour" },
      audienceNote: "Concerne les jeunes de nationalité française.",
      announcedPieces: [
        { label: "Une pièce d'identité du jeune", description: "Carte nationale d'identité ou passeport" },
        // Une précision vide n'est pas une précision.
        { label: "Le livret de famille", description: null },
      ],
      faq: [{ question: "J'ai dépassé les trois mois, est-ce trop tard ?", answer: "Non." }],
    });
  });

  // ⚠️ Les défauts de cette colonne sont VIDES — l'inverse de
  // `communication_config`, dont un `null` se lit « visible ».
  it("⚠️ `null` = rien d'écrit : tout est vide, rien n'est inventé", () => {
    for (const raw of [null, undefined, "texte", 42, [], {}]) {
      expect(parseUserCommunication(raw)).toEqual(emptyUserCommunication());
    }
    expect(emptyUserCommunication()).toEqual({
      responseDelay: null,
      audienceNote: null,
      announcedPieces: [],
      faq: [],
    });
  });

  it("un bloc abîmé est vide, sans emporter ses voisins", () => {
    const parsed = parseUserCommunication({ ...SERVI, delays: "trois semaines", attachments: [] });
    expect(parsed.responseDelay).toBeNull();
    expect(parsed.announcedPieces).toEqual([]);
    expect(parsed.audienceNote).toBe("Concerne les jeunes de nationalité française.");
    expect(parsed.faq).toHaveLength(1);
  });
});

describe("le délai — l'unité vient de la donnée, jamais du nombre", () => {
  const delay = (delays: unknown) => parseUserCommunication({ delays }).responseDelay;

  it("garde chacune des quatre unités du Socle", () => {
    for (const unit of ["jour_ouvre", "jour", "semaine", "mois"]) {
      expect(delay({ processingTimeValue: 2, processingTimeUnit: unit })).toEqual({ value: 2, unit });
    }
  });

  it("⚠️ `0` n'est pas un délai : ce serait promettre une réponse immédiate", () => {
    expect(delay({ processingTimeValue: 0, processingTimeUnit: "jour" })).toBeNull();
  });

  it("une valeur qui n'est pas un entier de 1 à 999 ne s'affiche pas", () => {
    for (const value of [null, -3, 1.5, 1000, "3", Number.NaN]) {
      expect(delay({ processingTimeValue: value, processingTimeUnit: "semaine" })).toBeNull();
    }
  });

  // L'éditeur du Socle retombe sur `jour` (il faut bien pré-remplir un
  // sélecteur) ; une page publique n'invente pas d'unité.
  it("⚠️ sans unité connue, pas de délai — même avec une valeur", () => {
    expect(delay({ processingTimeValue: 48 })).toBeNull();
    expect(delay({ processingTimeValue: 48, processingTimeUnit: "heure" })).toBeNull();
  });
});

describe("la note de public, les pièces, la FAQ", () => {
  it("une note vide ou blanche n'est pas une note", () => {
    expect(parseUserCommunication({ audience: { note: "  " } }).audienceNote).toBeNull();
    expect(parseUserCommunication({ audience: { note: 12 } }).audienceNote).toBeNull();
  });

  it("une pièce sans intitulé est écartée — une puce orpheline ne nomme rien", () => {
    const parsed = parseUserCommunication({
      attachments: { items: [{ label: "", description: "De moins de trois mois" }, "pas un objet", null] },
    });
    expect(parsed.announcedPieces).toEqual([]);
  });

  it("une question sans réponse, ou l'inverse, est écartée", () => {
    const parsed = parseUserCommunication({
      faq: {
        items: [
          { question: "Restée en l'air ?", answer: " " },
          { question: "", answer: "Réponse orpheline." },
          { question: "Où ?", answer: "À l'accueil." },
        ],
      },
    });
    expect(parsed.faq).toEqual([{ question: "Où ?", answer: "À l'accueil." }]);
  });
});
