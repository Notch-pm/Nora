import { describe, expect, it } from "vitest";
import { allFields, isSection, parseFormSchema } from "./formSchema.ts";

const CHAMP_NOM = { id: "f1", key: "nom", type: "text", label: "Votre nom", required: true };
const CHAMP_MOTIF = {
  id: "f2",
  key: "motif",
  type: "select",
  label: "Motif",
  options: [{ value: "a", label: "Nid de poule" }],
};

describe("parseFormSchema — tolérant nœud par nœud", () => {
  it("lit un schéma nominal en conservant l'ordre", () => {
    const schema = parseFormSchema({ version: 1, content: [CHAMP_NOM, CHAMP_MOTIF] });
    expect(schema).not.toBeNull();
    expect(allFields(schema!).map((field) => field.key)).toEqual(["nom", "motif"]);
  });

  it("écarte le champ illisible et garde le reste — le formulaire n'est pas perdu pour un nœud", () => {
    // Le parti du portail, déjà celui des sections de la page composée : on ne
    // rend pas à moitié, mais un nœud inconnu n'emporte pas la page.
    const schema = parseFormSchema({
      version: 1,
      content: [CHAMP_NOM, { id: "f9", key: "x", type: "signature", label: "Signature" }, CHAMP_MOTIF],
    });
    expect(allFields(schema!).map((field) => field.key)).toEqual(["nom", "motif"]);
  });

  it("écarte un champ sans clé machine : sa réponse n'aurait pas de nom dans la demande", () => {
    const schema = parseFormSchema({
      version: 1,
      content: [{ id: "f1", type: "text", label: "Sans clé" }, CHAMP_NOM],
    });
    expect(allFields(schema!).map((field) => field.key)).toEqual(["nom"]);
  });

  it("écarte une liste de choix sans choix — un sélecteur vide ne pose pas de question", () => {
    const schema = parseFormSchema({
      version: 1,
      content: [{ id: "f3", key: "vide", type: "radio", label: "Vide", options: [] }, CHAMP_NOM],
    });
    expect(allFields(schema!).map((field) => field.key)).toEqual(["nom"]);
  });

  it("aplatit les sections et écarte celles qui n'encadrent plus rien", () => {
    const schema = parseFormSchema({
      version: 1,
      content: [
        { id: "s1", kind: "section", title: "Le lieu", fields: [CHAMP_NOM] },
        { id: "s2", kind: "section", title: "Vide", fields: [{ id: "z", type: "text" }] },
      ],
    });
    expect(schema!.content).toHaveLength(1);
    expect(isSection(schema!.content[0])).toBe(true);
    expect(allFields(schema!).map((field) => field.key)).toEqual(["nom"]);
  });

  it("borne le nombre de fichiers d'une pièce et normalise ses formats", () => {
    const schema = parseFormSchema({
      version: 1,
      content: [
        {
          id: "p1",
          key: "photo",
          type: "attachment",
          label: "Photo",
          maxFiles: 99,
          acceptedFormats: [".JPG", "pdf", "jpg", ""],
        },
      ],
    });
    const field = allFields(schema!)[0];
    expect(field.type).toBe("attachment");
    if (field.type !== "attachment") return;
    expect(field.maxFiles).toBe(5);
    expect(field.acceptedFormats).toEqual(["jpg", "pdf"]);
  });

  it("retombe sur le libellé manquant plutôt que d'afficher un trou", () => {
    const schema = parseFormSchema({ version: 1, content: [{ id: "f1", key: "nom", type: "text" }] });
    expect(allFields(schema!)[0].label).toBe("nom");
  });

  it("refuse une version qu'il ne sait pas lire, plutôt que d'en deviner la moitié", () => {
    expect(parseFormSchema({ version: 2, content: [CHAMP_NOM] })).toBeNull();
  });

  it("un formulaire absent, vide ou illisible vaut « pas de formulaire », pas une erreur", () => {
    expect(parseFormSchema(null)).toBeNull();
    expect(parseFormSchema({ version: 1, content: [] })).toBeNull();
    expect(parseFormSchema("bonjour")).toBeNull();
    expect(parseFormSchema({ version: 1 })).toBeNull();
  });

  it("lit les conditions, et ignore une règle sans champ cible", () => {
    const schema = parseFormSchema({
      version: 1,
      content: [
        {
          ...CHAMP_NOM,
          visibleIf: {
            combinator: "or",
            rules: [{ fieldId: "f2", operator: "equals", value: "a" }, { operator: "equals" }],
          },
        },
      ],
    });
    expect(allFields(schema!)[0].visibleIf).toEqual({
      combinator: "or",
      rules: [{ fieldId: "f2", operator: "equals", value: "a" }],
    });
  });
});
