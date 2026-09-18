import { describe, expect, it } from "vitest";
import { parseFormSchema } from "@fn/_shared/domain/formSchema.ts";
import { piecesPresentation } from "./pieces.ts";

/** Le formulaire du recensement de Rosny : quatre pièces à téléverser. */
const FORM = parseFormSchema({
  version: 1,
  content: [
    { id: "f1", key: "date_naissance", type: "date", label: "Date de naissance" },
    {
      id: "s1",
      kind: "section",
      title: "Pièces",
      fields: [
        { id: "p1", key: "identite", type: "attachment", label: "Pièce d'identité du jeune", acceptedFormats: ["pdf"] },
        { id: "p2", key: "livret", type: "attachment", label: "Livret de famille" },
      ],
    },
  ],
});

/** Ce que la collectivité ANNONCE — rédigé autrement, et avec une pièce en plus. */
const ANNOUNCED = [
  { label: "Une pièce d'identité du jeune", description: "Carte nationale d'identité ou passeport" },
  { label: "Le livret de famille", description: null },
  { label: "Un justificatif de nationalité française", description: null },
];

describe("piecesPresentation — l'annonce et le dépôt ne se fondent jamais", () => {
  it("l'annonce est LA liste ; les pièces du formulaire restent nommées à part", () => {
    const result = piecesPresentation(ANNOUNCED, FORM);
    expect(result.kind).toBe("announced");
    if (result.kind !== "announced") return;
    expect(result.announced).toEqual(ANNOUNCED);
    // ⚠️ Omettre celles-ci cacherait une pièce que le dépôt exigera.
    expect(result.online.map((field) => field.label)).toEqual([
      "Pièce d'identité du jeune",
      "Livret de famille",
    ]);
  });

  it("⚠️ ne concatène pas : aucune pièce du formulaire ne s'ajoute à l'annonce", () => {
    const result = piecesPresentation(ANNOUNCED, FORM);
    if (result.kind !== "announced") throw new Error("annonce attendue");
    expect(result.announced).toHaveLength(ANNOUNCED.length);
  });

  it("annonce sans formulaire : l'annonce seule, rien à joindre en ligne", () => {
    expect(piecesPresentation(ANNOUNCED, null)).toEqual({
      kind: "announced",
      announced: ANNOUNCED,
      online: [],
    });
  });

  it("sans annonce, retombe sur les pièces du formulaire — la page d'avant 1.24.0", () => {
    const result = piecesPresentation([], FORM);
    expect(result.kind).toBe("form");
    if (result.kind !== "form") return;
    expect(result.online.map((field) => field.acceptedFormats)).toEqual([["pdf"], []]);
  });

  it("ni annonce ni pièce au formulaire : pas de section", () => {
    expect(piecesPresentation([], null)).toEqual({ kind: "none" });
    const sansPiece = parseFormSchema({
      version: 1,
      content: [{ id: "f1", key: "objet", type: "text", label: "Objet" }],
    });
    expect(piecesPresentation([], sansPiece)).toEqual({ kind: "none" });
  });
});
