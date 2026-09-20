import { describe, expect, it } from "vitest";
import type { FormSchema } from "../domain/formSchema.ts";
import {
  answerField,
  applyUpdates,
  pendingFields,
  readFieldUpdates,
  sanitizeState,
  skipField,
  viewOf,
  type CollectionState,
} from "./collection.ts";

/** Un signalement : où, quoi (choix), précision si « autre », photo facultative, courriel de suivi. */
const SCHEMA: FormSchema = {
  version: 1,
  content: [
    { id: "f-lieu", key: "lieu", type: "text", label: "Lieu", required: true, maxLength: 80 },
    {
      id: "f-nature",
      key: "nature",
      type: "radio",
      label: "Nature du problème",
      required: true,
      options: [
        { value: "depot", label: "Dépôt sauvage" },
        { value: "autre", label: "Autre" },
      ],
    },
    {
      id: "f-precisez",
      key: "precisez",
      type: "textarea",
      label: "Précisez",
      required: true,
      visibleIf: { combinator: "and", rules: [{ fieldId: "f-nature", operator: "equals", value: "autre" }] },
    },
    { id: "f-photo", key: "photo", type: "attachment", label: "Photo", maxFiles: 2, acceptedFormats: [] },
    { id: "f-courriel", key: "courriel", type: "email", label: "Courriel de suivi" },
  ],
};

const empty: CollectionState = { demarcheId: "d1", values: {}, skipped: [] };
const ids = (state: CollectionState) => pendingFields(SCHEMA, state).map((f) => f.id);

describe("viewOf — quoi demander, et comment", () => {
  it("suit l'ordre du formulaire ; ce qui se dit en conversation, ce qui se choisit en carte", () => {
    expect(viewOf(SCHEMA, empty)).toMatchObject({ mode: "conversation", remaining: 4, complete: false });
    expect(viewOf(SCHEMA, empty).pending?.id).toBe("f-lieu");
    const afterLieu = answerField(SCHEMA, empty, "f-lieu", "12 rue de la Paix");
    expect(viewOf(SCHEMA, afterLieu)).toMatchObject({ mode: "card" });
    expect(viewOf(SCHEMA, afterLieu).pending?.id).toBe("f-nature");
  });

  it("⚠️ un champ masqué n'existe pas : ni demandé, ni compté", () => {
    expect(ids(empty)).not.toContain("f-precisez");
    expect(ids(answerField(SCHEMA, empty, "f-nature", "autre"))).toContain("f-precisez");
  });

  it("est complet quand il ne reste rien à demander ET que le formulaire est valide", () => {
    let state = answerField(SCHEMA, empty, "f-lieu", "12 rue de la Paix");
    state = answerField(SCHEMA, state, "f-nature", "depot");
    expect(viewOf(SCHEMA, state).complete).toBe(false); // photo et courriel restent à proposer
    state = skipField(SCHEMA, skipField(SCHEMA, state, "f-photo"), "f-courriel");
    expect(viewOf(SCHEMA, state)).toEqual({ pending: null, mode: null, remaining: 0, complete: true });
  });

  it("⚠️ un champ OBLIGATOIRE ne se passe pas", () => {
    expect(skipField(SCHEMA, empty, "f-lieu")).toBe(empty);
    expect(skipField(SCHEMA, empty, "inconnu")).toBe(empty);
    expect(skipField(SCHEMA, empty, "f-photo").skipped).toEqual(["f-photo"]);
  });
});

describe("answerField — une carte répond sans modèle", () => {
  it("⚠️ changer une réponse purge ce qu'elle vient de masquer", () => {
    // L'usager choisit « autre », précise, puis revient sur « dépôt » : sa
    // précision ne doit pas partir dans la demande — il croit l'avoir retirée.
    let state = answerField(SCHEMA, empty, "f-nature", "autre");
    state = answerField(SCHEMA, state, "f-precisez", "Un lampadaire penche");
    state = answerField(SCHEMA, state, "f-nature", "depot");
    expect(state.values).toEqual({ "f-nature": "depot" });
  });

  it("répondre à un champ passé le retire des passés", () => {
    const state = answerField(SCHEMA, skipField(SCHEMA, empty, "f-courriel"), "f-courriel", "a@b.fr");
    expect(state.skipped).toEqual([]);
  });

  it("⚠️ une valeur hors options n'existe pas", () => {
    expect(answerField(SCHEMA, empty, "f-nature", "n'importe quoi").values).toEqual({});
  });
});

describe("applyUpdates — ce que le modèle dit avoir compris, et ce qu'on en retient", () => {
  it("retient une réponse écrite à un champ en attente", () => {
    const result = applyUpdates(SCHEMA, empty, [{ id: "f-lieu", value: "12 rue de la Paix" }]);
    expect(result.accepted).toEqual(["f-lieu"]);
    expect(result.state.values).toEqual({ "f-lieu": "12 rue de la Paix" });
  });

  it("⚠️ le modèle ne remplit JAMAIS un choix ni une pièce — même avec une valeur juste", () => {
    const result = applyUpdates(SCHEMA, empty, [
      { id: "f-nature", value: "depot" },
      { id: "f-photo", value: "photo.jpg" },
    ]);
    expect(result.rejected).toEqual(["f-nature", "f-photo"]);
    expect(result.state.values).toEqual({});
  });

  it("⚠️ il ne réécrit pas une réponse déjà donnée : corriger est un geste de l'usager", () => {
    const state = answerField(SCHEMA, empty, "f-lieu", "12 rue de la Paix");
    const result = applyUpdates(SCHEMA, state, [{ id: "f-lieu", value: "Ailleurs" }]);
    expect(result.rejected).toEqual(["f-lieu"]);
    expect(result.state.values["f-lieu"]).toBe("12 rue de la Paix");
  });

  it("écarte ce qui ne passe pas la validation du formulaire, un champ inventé, un champ masqué", () => {
    const result = applyUpdates(SCHEMA, empty, [
      { id: "f-courriel", value: "pas un courriel" },
      { id: "f-lieu", value: "x".repeat(81) },
      { id: "f-invente", value: "coucou" },
      { id: "f-precisez", value: "champ masqué" },
    ]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual(["f-courriel", "f-lieu", "f-invente", "f-precisez"]);
  });

  it("plusieurs champs d'un même message — « c'est au 12 rue…, mon courriel est… »", () => {
    const result = applyUpdates(SCHEMA, empty, [
      { id: "f-lieu", value: "12 rue de la Paix" },
      { id: "f-courriel", value: "a@b.fr" },
    ]);
    expect(result.accepted).toEqual(["f-lieu", "f-courriel"]);
  });
});

describe("readFieldUpdates — la forme de ce que rend le modèle", () => {
  it("lit des couples id/valeur, accepte un nombre, écarte le reste", () => {
    expect(
      readFieldUpdates([
        { id: "a", value: " oui " },
        { id: "b", value: 3 },
        { id: "c", value: "" },
        { id: 4, value: "x" },
        { id: "d", value: { x: 1 } },
        "bonjour",
        null,
      ]),
    ).toEqual([
      { id: "a", value: "oui" },
      { id: "b", value: "3" },
    ]);
    expect(readFieldUpdates("rien")).toEqual([]);
    expect(readFieldUpdates(Array.from({ length: 50 }, (_, i) => ({ id: "f" + i, value: "x" })))).toHaveLength(20);
  });
});

describe("sanitizeState — l'état vient du navigateur", () => {
  it("ne garde que des champs de CE formulaire, à la bonne forme", () => {
    const state = sanitizeState(SCHEMA, "d1", {
      values: {
        "f-lieu": "Ici",
        "f-nature": "inexistante",
        "f-photo": [{ uploadId: "u1", name: "p.jpg", size: 10 }],
        "f-invente": "x",
        "f-courriel": 42,
      },
      skipped: ["f-lieu", "f-courriel", "f-courriel", "inconnu", 7],
    });
    expect(state.values).toEqual({ "f-lieu": "Ici", "f-photo": [{ uploadId: "u1", name: "p.jpg", size: 10 }] });
    // `f-lieu` est obligatoire : il ne peut pas être « passé ».
    expect(state.skipped).toEqual(["f-courriel"]);
  });

  it("⚠️ purge une réponse sous un champ masqué, et tolère n'importe quoi", () => {
    expect(sanitizeState(SCHEMA, "d1", { values: { "f-nature": "depot", "f-precisez": "reste d'avant" } }).values)
      .toEqual({ "f-nature": "depot" });
    for (const raw of [null, undefined, "x", [], { values: [] }, { values: "x", skipped: "y" }]) {
      expect(sanitizeState(SCHEMA, "d1", raw)).toEqual(empty);
    }
  });

  it("borne les pièces au nombre que la démarche demande", () => {
    const three = [1, 2, 3].map((n) => ({ uploadId: "u" + n, name: "p", size: 1 }));
    expect(sanitizeState(SCHEMA, "d1", { values: { "f-photo": three } }).values).toEqual({});
  });
});
