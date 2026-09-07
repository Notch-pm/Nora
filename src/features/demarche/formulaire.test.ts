import { describe, expect, it } from "vitest";
import type { FormSchema } from "@fn/_shared/domain/formSchema.ts";
import { isSection } from "@fn/_shared/domain/formSchema.ts";
import {
  isFieldRequired,
  toFormData,
  toRequester,
  validateForm,
  validateRequester,
  visibleFields,
  visibleNodes,
} from "./formulaire.ts";

/** Un formulaire où « précisez » ne s'affiche que si le motif est « autre ». */
const SCHEMA: FormSchema = {
  version: 1,
  content: [
    {
      id: "f-motif",
      key: "motif",
      type: "radio",
      label: "Motif",
      required: true,
      options: [
        { value: "voirie", label: "Voirie" },
        { value: "autre", label: "Autre" },
      ],
    },
    {
      id: "f-precisez",
      key: "precisez",
      type: "text",
      label: "Précisez",
      required: true,
      visibleIf: { combinator: "and", rules: [{ fieldId: "f-motif", operator: "equals", value: "autre" }] },
    },
    {
      id: "f-courriel",
      key: "courriel_contact",
      type: "email",
      label: "Courriel de suivi",
    },
  ],
};

describe("visibilité — un champ masqué n'existe pas", () => {
  it("cache le champ conditionnel tant que la condition n'est pas satisfaite", () => {
    expect(visibleFields(SCHEMA, {}).map((f) => f.key)).toEqual(["motif", "courriel_contact"]);
    expect(visibleFields(SCHEMA, { "f-motif": "autre" }).map((f) => f.key)).toEqual([
      "motif",
      "precisez",
      "courriel_contact",
    ]);
  });

  it("fait disparaître une section dont tous les champs sont masqués", () => {
    const schema: FormSchema = {
      version: 1,
      content: [
        {
          id: "s1",
          kind: "section",
          title: "Détails",
          fields: [
            {
              id: "f1",
              key: "detail",
              type: "text",
              label: "Détail",
              visibleIf: { combinator: "and", rules: [{ fieldId: "absent", operator: "isNotEmpty" }] },
            },
          ],
        },
      ],
    };
    expect(visibleNodes(schema, {})).toEqual([]);
    const shown = visibleNodes(schema, { absent: "oui" });
    expect(shown).toHaveLength(1);
    expect(isSection(shown[0])).toBe(true);
  });
});

describe("validation", () => {
  it("réclame les champs obligatoires visibles, et eux seuls", () => {
    // `precisez` est obligatoire mais masqué : il ne peut pas retenir l'envoi
    // d'une réponse que l'usager ne voit pas.
    expect(Object.keys(validateForm(SCHEMA, {}))).toEqual(["f-motif"]);
    expect(Object.keys(validateForm(SCHEMA, { "f-motif": "autre" }))).toEqual(["f-precisez"]);
  });

  it("vérifie la forme d'une adresse électronique", () => {
    const errors = validateForm(SCHEMA, { "f-motif": "voirie", "f-courriel": "pas-une-adresse" });
    expect(errors["f-courriel"]).toEqual({ key: "validation.email" });
    expect(validateForm(SCHEMA, { "f-motif": "voirie", "f-courriel": "a@b.fr" })).toEqual({});
  });

  it("ne bloque jamais sur une pièce justificative, même obligatoire", () => {
    // Le dépôt de pièces n'existe pas encore : refuser l'envoi pour une pièce
    // qu'on ne sait pas recevoir enfermerait l'usager.
    const schema: FormSchema = {
      version: 1,
      content: [
        {
          id: "p1",
          key: "photo",
          type: "attachment",
          label: "Photo",
          required: true,
          maxFiles: 1,
          acceptedFormats: ["jpg"],
        },
      ],
    };
    expect(isFieldRequired(schema.content[0] as never, {})).toBe(true);
    expect(validateForm(schema, {})).toEqual({});
  });
});

describe("toFormData — on saisit par id, on dépose par key", () => {
  it("indexe les réponses par la clé machine, jamais par l'identifiant", () => {
    const data = toFormData(SCHEMA, { "f-motif": "voirie", "f-courriel": " a@b.fr " });
    expect(data).toEqual({ motif: "voirie", courriel_contact: "a@b.fr" });
  });

  it("ne dépose pas la réponse d'un champ redevenu masqué", () => {
    // L'usager a répondu « autre », précisé, puis changé d'avis : sa précision
    // n'est plus une réponse, et ne doit pas arriver dans la demande.
    const data = toFormData(SCHEMA, { "f-motif": "voirie", "f-precisez": "un texte oublié" });
    expect(data).not.toHaveProperty("precisez");
  });

  it("convertit un nombre saisi, et laisse tomber les réponses vides", () => {
    const schema: FormSchema = {
      version: 1,
      content: [
        { id: "n", key: "quantite", type: "number", label: "Quantité" },
        { id: "t", key: "texte", type: "text", label: "Texte" },
      ],
    };
    expect(toFormData(schema, { n: "12", t: "   " })).toEqual({ quantite: 12 });
  });

  it("n'envoie pas de pièce jointe : une clé vide vaudrait « répondu, mais rien »", () => {
    const schema: FormSchema = {
      version: 1,
      content: [
        { id: "p1", key: "photo", type: "attachment", label: "Photo", maxFiles: 1, acceptedFormats: [] },
      ],
    };
    expect(toFormData(schema, { p1: ["fichier"] })).toEqual({});
  });
});

describe("identité du requérant", () => {
  const fields = [
    { key: "nom_usuel", label: "Nom usuel", required: true },
    { key: "courriel", label: "Courriel", required: true },
    { key: "tel_fixe", label: "Téléphone fixe", required: false },
  ];

  it("réclame les champs obligatoires et vérifie le courriel", () => {
    expect(Object.keys(validateRequester(fields, {}))).toEqual(["nom_usuel", "courriel"]);
    expect(validateRequester(fields, { nom_usuel: "Dupont", courriel: "x" }).courriel).toEqual({
      key: "validation.email",
    });
  });

  it("dépose l'identité aux clés du Socle, sans les champs laissés vides", () => {
    // Ces clés-là sont lues telles quelles par Iris pour rapprocher l'usager du
    // référentiel : les renommer casserait le rapprochement.
    expect(
      toRequester("personne", fields, { nom_usuel: " Dupont ", courriel: "a@b.fr", tel_fixe: "" }),
    ).toEqual({ contact_type: "personne", nom_usuel: "Dupont", courriel: "a@b.fr" });
  });
});
