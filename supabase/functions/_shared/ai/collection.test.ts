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
  type FieldUpdate,
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

const empty: CollectionState = { demarcheId: "d1", values: {}, skipped: [], origins: {}, touched: [] };
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
  const quoted = (id: string, value: string, source: string): FieldUpdate =>
    ({ id, value, origin: "extracted", source });

  it("retient une réponse écrite à un champ en attente, et garde sa citation", () => {
    const result = applyUpdates(
      SCHEMA,
      empty,
      [quoted("f-lieu", "12 rue de la Paix", "au 12 rue de la Paix")],
      "c'est au 12 rue de la Paix",
    );
    expect(result.accepted).toEqual(["f-lieu"]);
    expect(result.state.values).toEqual({ "f-lieu": "12 rue de la Paix" });
    expect(result.state.origins["f-lieu"]).toEqual({ origin: "extracted", source: "au 12 rue de la Paix" });
  });

  it("⚠️ « repris » se MÉRITE : une citation absente des mots de l'usager retombe en « déduit »", () => {
    // Le badge vert dit « vous l'avez dit ». Le décerner sur une valeur
    // inventée ferait signer à l'usager un texte qu'il n'a jamais prononcé.
    const result = applyUpdates(
      SCHEMA,
      empty,
      [{ id: "f-lieu", value: "12 rue de la Paix", origin: "extracted", source: "jamais prononcé", reason: "au jugé" }],
      "il y a des gravats",
    );
    expect(result.accepted).toEqual(["f-lieu"]);
    expect(result.state.origins["f-lieu"]).toEqual({ origin: "inferred", reason: "au jugé" });
  });

  it("déduit un choix depuis le LIBELLÉ d'une option, et n'écrit que sa valeur", () => {
    const result = applyUpdates(
      SCHEMA,
      empty,
      [{ id: "f-nature", value: "Dépôt sauvage", origin: "inferred", reason: "vous parlez de gravats" }],
      "il y a des gravats devant chez moi",
    );
    expect(result.accepted).toEqual(["f-nature"]);
    // C'est la VALEUR qui entre, jamais le libellé : c'est elle que la demande portera.
    expect(result.state.values["f-nature"]).toBe("depot");
    expect(result.state.origins["f-nature"]).toEqual({ origin: "inferred", reason: "vous parlez de gravats" });
  });

  it("⚠️ une option inventée n'entre pas — le champ reste simplement à demander", () => {
    const result = applyUpdates(
      SCHEMA,
      empty,
      [{ id: "f-nature", value: "Tag sur un mur", origin: "inferred" }],
      "il y a un tag",
    );
    expect(result.rejected).toEqual(["f-nature"]);
    expect(result.state.values).toEqual({});
  });

  it("un choix que l'usager a PRONONCÉ est repris, pas déduit", () => {
    // Même entrée que le test précédent côté modèle : c'est le serveur qui
    // tranche l'origine, sur les mots réels.
    const result = applyUpdates(
      SCHEMA,
      empty,
      [{ id: "f-nature", value: "Dépôt sauvage", origin: "inferred", reason: "rapprochement" }],
      "je signale un dépôt sauvage",
    );
    expect(result.state.origins["f-nature"]).toEqual({ origin: "extracted", source: "Dépôt sauvage" });
  });

  it("⚠️ le modèle ne remplit JAMAIS une pièce jointe", () => {
    const result = applyUpdates(SCHEMA, empty, [quoted("f-photo", "photo.jpg", "photo.jpg")], "photo.jpg");
    expect(result.rejected).toEqual(["f-photo"]);
    expect(result.state.values).toEqual({});
  });

  it("⚠️ il ne réécrit pas une réponse déjà donnée : corriger est un geste de l'usager", () => {
    const state = answerField(SCHEMA, empty, "f-lieu", "12 rue de la Paix");
    const result = applyUpdates(SCHEMA, state, [quoted("f-lieu", "Ailleurs", "Ailleurs")], "Ailleurs");
    expect(result.rejected).toEqual(["f-lieu"]);
    expect(result.state.values["f-lieu"]).toBe("12 rue de la Paix");
  });

  it("⚠️ il ne touche plus un champ que l'usager a renseigné lui-même — MÊME VIDÉ", () => {
    // C'est le cas de « corriger » : le champ est rouvert, donc en attente, et
    // sans cette mémoire le modèle le remplirait au tour suivant.
    const state: CollectionState = { ...empty, touched: ["f-lieu"] };
    const result = applyUpdates(SCHEMA, state, [quoted("f-lieu", "Ailleurs", "Ailleurs")], "Ailleurs");
    expect(result.rejected).toEqual(["f-lieu"]);
    expect(result.state.values).toEqual({});
  });

  it("« rédigé pour vous » ne vaut que pour un texte long", () => {
    const opened = answerField(SCHEMA, empty, "f-nature", "autre");
    const long = applyUpdates(
      SCHEMA,
      opened,
      [{ id: "f-precisez", value: "Un lampadaire penche au-dessus du trottoir.", origin: "generated" }],
      "le lampadaire penche",
    );
    expect(long.state.origins["f-precisez"]).toEqual({ origin: "generated" });
    // La même prétention sur un champ court retombe en « déduit ».
    const short = applyUpdates(SCHEMA, empty, [{ id: "f-lieu", value: "Ici", origin: "generated" }], "ici");
    expect(short.state.origins["f-lieu"]).toEqual({ origin: "inferred" });
  });

  it("écarte ce qui ne passe pas la validation du formulaire, un champ inventé, un champ masqué", () => {
    const result = applyUpdates(
      SCHEMA,
      empty,
      [
        quoted("f-courriel", "pas un courriel", "pas un courriel"),
        quoted("f-lieu", "x".repeat(81), "x"),
        quoted("f-invente", "coucou", "coucou"),
        quoted("f-precisez", "champ masqué", "champ masqué"),
      ],
      "n'importe quoi",
    );
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual(["f-courriel", "f-lieu", "f-invente", "f-precisez"]);
  });

  it("plusieurs champs d'un même message — « c'est au 12 rue…, mon courriel est… »", () => {
    const said = "c'est au 12 rue de la Paix, mon courriel est a@b.fr";
    const result = applyUpdates(
      SCHEMA,
      empty,
      [quoted("f-lieu", "12 rue de la Paix", "12 rue de la Paix"), quoted("f-courriel", "a@b.fr", "a@b.fr")],
      said,
    );
    expect(result.accepted).toEqual(["f-lieu", "f-courriel"]);
  });
});

describe("readFieldUpdates — la forme de ce que rend le modèle", () => {
  it("lit des couples id/valeur, accepte un nombre, écarte le reste", () => {
    expect(
      readFieldUpdates([
        { id: "a", value: " oui ", origin: "extracted", source: " parce que " },
        { id: "b", value: 3 },
        { id: "c", value: "" },
        { id: 4, value: "x" },
        { id: "d", value: { x: 1 } },
        "bonjour",
        null,
      ]),
    ).toEqual([
      { id: "a", value: "oui", origin: "extracted", source: "parce que" },
      { id: "b", value: "3", origin: "inferred" },
    ]);
    expect(readFieldUpdates("rien")).toEqual([]);
    expect(readFieldUpdates(Array.from({ length: 50 }, (_, i) => ({ id: "f" + i, value: "x" })))).toHaveLength(20);
  });

  it("⚠️ « déduit » AU DOUTE : une origine absente, inconnue ou abîmée ne vaut jamais « repris »", () => {
    const updates = readFieldUpdates([
      { id: "a", value: "x" },
      { id: "b", value: "x", origin: "inventée" },
      { id: "c", value: "x", origin: 7 },
      { id: "d", value: "x", origin: "generated" },
    ]);
    expect(updates.map((u) => u.origin)).toEqual(["inferred", "inferred", "inferred", "generated"]);
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

  it("⚠️ une origine ne survit qu'attachée à une valeur, et jamais mal formée", () => {
    const state = sanitizeState(SCHEMA, "d1", {
      values: { "f-lieu": "Ici" },
      origins: {
        "f-lieu": { origin: "extracted", source: "c'est ici" },
        // Sans valeur : il n'y a plus rien à qualifier.
        "f-courriel": { origin: "inferred", reason: "au jugé" },
        "f-invente": { origin: "extracted" },
      },
    });
    expect(state.origins).toEqual({ "f-lieu": { origin: "extracted", source: "c'est ici" } });

    for (const broken of [{ origin: "inventée" }, { origin: 7 }, "x", null, []]) {
      expect(sanitizeState(SCHEMA, "d1", { values: { "f-lieu": "Ici" }, origins: { "f-lieu": broken } }).origins)
        .toEqual({});
    }
  });

  it("⚠️ un champ touché reste touché MÊME SANS VALEUR — c'est tout l'intérêt", () => {
    const state = sanitizeState(SCHEMA, "d1", {
      values: {},
      touched: ["f-lieu", "f-lieu", "f-invente", 7],
    });
    expect(state.touched).toEqual(["f-lieu"]);
  });

  it("⚠️ un champ touché sous un champ MASQUÉ ne survit pas : il n'est plus du formulaire", () => {
    // `f-precisez` n'existe que si nature = « autre ».
    expect(sanitizeState(SCHEMA, "d1", { values: {}, touched: ["f-precisez"] }).touched).toEqual([]);
    expect(
      sanitizeState(SCHEMA, "d1", { values: { "f-nature": "autre" }, touched: ["f-precisez"] }).touched,
    ).toEqual(["f-precisez"]);
  });

  it("tolère l'absence complète d'origines et de champs touchés — un onglet d'avant le lot", () => {
    const state = sanitizeState(SCHEMA, "d1", { values: { "f-lieu": "Ici" }, skipped: [] });
    expect(state.origins).toEqual({});
    expect(state.touched).toEqual([]);
  });
});

describe("answerField — qui a répondu, et ce que le badge en garde", () => {
  it("⚠️ une réponse de l'USAGER n'a pas d'origine, et marque le champ comme sien", () => {
    const state = answerField(SCHEMA, empty, "f-lieu", "12 rue de la Paix");
    expect(state.origins["f-lieu"]).toBeUndefined();
    expect(state.touched).toEqual(["f-lieu"]);
  });

  it("⚠️ corriger à la main efface le badge posé par l'assistant", () => {
    const filled = applyUpdates(
      SCHEMA,
      empty,
      [{ id: "f-lieu", value: "12 rue de la Paix", origin: "extracted", source: "12 rue de la Paix" }],
      "au 12 rue de la Paix",
    ).state;
    expect(filled.origins["f-lieu"]).toMatchObject({ origin: "extracted" });
    expect(filled.touched).toEqual([]);

    const corrected = answerField(SCHEMA, filled, "f-lieu", "14 rue de la Paix");
    expect(corrected.origins["f-lieu"]).toBeUndefined();
    expect(corrected.touched).toEqual(["f-lieu"]);
  });
});
