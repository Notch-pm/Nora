import { describe, expect, it } from "vitest";
import type { FormSchema } from "../domain/formSchema.ts";
import {
  answerField,
  applyUpdates,
  coerceUpdate,
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
  it("suit l'ordre du formulaire ; tout se dit, sauf une pièce jointe", () => {
    expect(viewOf(SCHEMA, empty)).toMatchObject({ mode: "conversation", assist: false, remaining: 4 });
    expect(viewOf(SCHEMA, empty).pending?.id).toBe("f-lieu");

    // Un choix se dit aussi — mais son contrôle reste offert en repli.
    const afterLieu = answerField(SCHEMA, empty, "f-lieu", "12 rue de la Paix");
    expect(viewOf(SCHEMA, afterLieu)).toMatchObject({ mode: "conversation", assist: true });
    expect(viewOf(SCHEMA, afterLieu).pending?.id).toBe("f-nature");

    // Une pièce jointe, elle, ne se raconte pas : c'est une carte.
    const afterNature = answerField(SCHEMA, afterLieu, "f-nature", "depot");
    expect(viewOf(SCHEMA, afterNature)).toMatchObject({ mode: "card", assist: false });
    expect(viewOf(SCHEMA, afterNature).pending?.id).toBe("f-photo");
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
    expect(viewOf(SCHEMA, state)).toEqual({
      pending: null,
      mode: null,
      assist: false,
      controls: [],
      assists: [],
      remaining: 0,
      complete: true,
    });
  });

  it("⚠️ un champ OBLIGATOIRE ne se passe pas", () => {
    expect(skipField(SCHEMA, empty, "f-lieu")).toBe(empty);
    expect(skipField(SCHEMA, empty, "inconnu")).toBe(empty);
    expect(skipField(SCHEMA, empty, "f-photo").skipped).toEqual(["f-photo"]);
  });
});

describe("viewOf(asking) — c'est le MODÈLE qui mène, donc qui décide de l'ordre", () => {
  it("montre le contrôle d'un champ demandé qui ne se dit pas, même s'il n'est pas le premier", () => {
    // Le modèle parle de la photo alors que trois champs écrits la précèdent :
    // c'est le dépôt de fichier qu'il faut afficher, pas le premier en attente.
    const view = viewOf(SCHEMA, empty, ["f-photo"]);
    expect(view.controls.map((f) => f.id)).toEqual(["f-photo"]);
    expect(view.pending?.id).toBe("f-lieu"); // l'ordre du formulaire ne change pas
  });

  it("offre en repli le contrôle d'un champ à options demandé", () => {
    const view = viewOf(SCHEMA, empty, ["f-nature"]);
    expect(view.assists.map((f) => f.id)).toEqual(["f-nature"]);
    // Un champ à options se DIT : il n'impose pas son contrôle.
    expect(view.controls).toEqual([]);
  });

  it("⚠️ un champ inventé, déjà répondu ou masqué tombe en silence", () => {
    const answered = answerField(SCHEMA, empty, "f-lieu", "Ici");
    for (const asking of [["f-invente"], ["f-lieu"], ["f-precisez"]]) {
      const view = viewOf(SCHEMA, answered, asking);
      // Rien de ce que le modèle a nommé n'est retenu ; on retombe sur le
      // repli, et le prochain champ en attente se dit — donc aucun contrôle.
      expect(view.controls).toEqual([]);
      expect(view.assists).toEqual([]);
    }
  });

  it("⚠️ sans `asking`, un contrôle n'apparaît que si le prochain champ NE SE DIT PAS", () => {
    // Afficher un contrôle pour un champ qui se raconte redonnerait à l'écran
    // la parole qu'on vient de lui retirer.
    expect(viewOf(SCHEMA, empty).controls).toEqual([]);
    let state = answerField(SCHEMA, empty, "f-lieu", "Ici");
    state = answerField(SCHEMA, state, "f-nature", "depot");
    expect(viewOf(SCHEMA, state).pending?.id).toBe("f-photo");
    expect(viewOf(SCHEMA, state).controls.map((f) => f.id)).toEqual(["f-photo"]);
  });

  it("plusieurs champs demandés à la fois — le modèle groupe ce qui va ensemble", () => {
    const view = viewOf(SCHEMA, empty, ["f-nature", "f-photo"]);
    expect(view.assists.map((f) => f.id)).toEqual(["f-nature"]);
    expect(view.controls.map((f) => f.id)).toEqual(["f-photo"]);
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

/** Une proposition du modèle. `inferred` par défaut : c'est le cas courant. */
const up = (id: string, value: string | string[], extra: Partial<FieldUpdate> = {}): FieldUpdate => ({
  id,
  value,
  origin: "inferred",
  ...extra,
});

describe("applyUpdates — ce que le modèle dit avoir compris, et ce qu'on en retient", () => {
  it("retient une réponse écrite à un champ en attente", () => {
    const said = "c'est au 12 rue de la Paix";
    const result = applyUpdates(SCHEMA, empty, [up("f-lieu", "12 rue de la Paix")], said);
    expect(result.accepted).toEqual(["f-lieu"]);
    expect(result.state.values).toEqual({ "f-lieu": "12 rue de la Paix" });
  });

  it("⚠️ le modèle ne remplit JAMAIS une pièce jointe — même avec une valeur qui en a l'air", () => {
    const result = applyUpdates(SCHEMA, empty, [up("f-photo", "photo.jpg")], "voici la photo");
    expect(result.rejected).toEqual(["f-photo"]);
    expect(result.state.values).toEqual({});
  });

  it("retient un choix DIT en toutes lettres, ramené à la valeur du schéma publié", () => {
    const result = applyUpdates(SCHEMA, empty, [up("f-nature", "Dépôt sauvage")], "un dépôt sauvage");
    expect(result.accepted).toEqual(["f-nature"]);
    expect(result.state.values).toEqual({ "f-nature": "depot" });
  });

  it("⚠️ il ne réécrit pas une réponse déjà donnée : corriger est un geste de l'usager", () => {
    const state = answerField(SCHEMA, empty, "f-lieu", "12 rue de la Paix");
    const result = applyUpdates(SCHEMA, state, [up("f-lieu", "Ailleurs")], "ailleurs");
    expect(result.rejected).toEqual(["f-lieu"]);
    expect(result.state.values["f-lieu"]).toBe("12 rue de la Paix");
  });

  it("⚠️ un champ que l'usager a renseigné LUI-MÊME n'est plus jamais réécrit, même vidé", () => {
    // `touched` survit à la purge de la valeur : sans cette mémoire, le modèle
    // se précipiterait pour remplir à nouveau ce que l'usager vient d'effacer.
    const mine = answerField(SCHEMA, empty, "f-courriel", "moi@exemple.fr");
    const emptied = answerField(SCHEMA, mine, "f-courriel", "");
    expect(emptied.touched).toEqual(["f-courriel"]);
    const result = applyUpdates(SCHEMA, emptied, [up("f-courriel", "autre@exemple.fr")], "autre@exemple.fr");
    expect(result.rejected).toEqual(["f-courriel"]);
  });

  it("écarte ce qui ne passe pas la validation du formulaire, un champ inventé, un champ masqué", () => {
    const result = applyUpdates(SCHEMA, empty, [
      up("f-courriel", "pas un courriel"),
      up("f-lieu", "x".repeat(81)),
      up("f-invente", "coucou"),
      up("f-precisez", "champ masqué"),
    ], "peu importe");
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual(["f-courriel", "f-lieu", "f-invente", "f-precisez"]);
  });

  it("plusieurs champs d'un même message — « c'est au 12 rue…, mon courriel est… »", () => {
    const said = "c'est au 12 rue de la Paix, mon courriel est a@b.fr";
    const result = applyUpdates(SCHEMA, empty, [
      up("f-lieu", "12 rue de la Paix"),
      up("f-courriel", "a@b.fr"),
    ], said);
    expect(result.accepted).toEqual(["f-lieu", "f-courriel"]);
  });
});

describe("passer un champ — le modèle mène, il lui faut pouvoir le dire", () => {
  it("⚠️ un facultatif refusé se PASSE, sinon le récapitulatif ne s'ouvre jamais", () => {
    // Sans ce geste, le champ reste en attente : le modèle le redemanderait
    // sans fin, et `complete` n'arriverait pas.
    const result = applyUpdates(SCHEMA, empty, [up("f-courriel", "", { skip: true })], "non merci");
    expect(result.accepted).toEqual(["f-courriel"]);
    expect(result.state.skipped).toEqual(["f-courriel"]);
    expect(pendingFields(SCHEMA, result.state).map((f) => f.id)).not.toContain("f-courriel");
  });

  it("⚠️ un champ OBLIGATOIRE ne se passe pas, même si le modèle le demande", () => {
    const result = applyUpdates(SCHEMA, empty, [up("f-lieu", "", { skip: true })], "je ne sais pas");
    expect(result.rejected).toEqual(["f-lieu"]);
    expect(result.state.skipped).toEqual([]);
  });

  it("passer n'écrit aucune valeur, et ne pose aucune origine", () => {
    const result = applyUpdates(SCHEMA, empty, [up("f-courriel", "", { skip: true })], "non");
    expect(result.state.values).toEqual({});
    expect(result.state.origins).toEqual({});
  });
});

describe("l'origine d'une valeur — tranchée par le SERVEUR, sur les mots réels", () => {
  it("« repris » se mérite : la citation doit figurer dans ce que l'usager a écrit", () => {
    const said = "c'est au 12 rue de la Paix";
    const result = applyUpdates(
      SCHEMA,
      empty,
      [up("f-lieu", "12 rue de la Paix", { origin: "extracted", source: "12 rue de la Paix" })],
      said,
    );
    expect(result.state.origins["f-lieu"]).toEqual({ origin: "extracted", source: "12 rue de la Paix" });
  });

  it("⚠️ une citation que l'usager n'a jamais prononcée retombe en « déduit »", () => {
    // Le modèle jure « repris » ; le serveur ne l'en croit pas. Se tromper vers
    // le badge jaune fait relire une valeur juste ; vers le vert, signer une
    // valeur inventée.
    const result = applyUpdates(
      SCHEMA,
      empty,
      [up("f-lieu", "12 rue de la Paix", { origin: "extracted", source: "12 rue de la Paix", reason: "au jugé" })],
      "je ne sais plus où exactement",
    );
    expect(result.state.origins["f-lieu"]).toEqual({ origin: "inferred", reason: "au jugé" });
  });

  it("⚠️ un choix RAPPROCHÉ des mots de l'usager est une déduction, pas une reprise", () => {
    // « des gravats » → « Dépôt sauvage » : l'usager n'a pas prononcé le
    // libellé, c'est un rapprochement avec notre liste. Badge « à confirmer ».
    const rapproche = applyUpdates(
      SCHEMA,
      empty,
      [up("f-nature", "Dépôt sauvage", { origin: "extracted", reason: "vous parlez de gravats" })],
      "il y a des gravats",
    );
    expect(rapproche.state.origins["f-nature"]).toEqual({
      origin: "inferred",
      reason: "vous parlez de gravats",
    });

    // Prononcé tel quel, en revanche, c'est bien une reprise.
    const dit = applyUpdates(SCHEMA, empty, [up("f-nature", "Dépôt sauvage")], "c'est un dépôt sauvage");
    expect(dit.state.origins["f-nature"]).toEqual({ origin: "extracted", source: "Dépôt sauvage" });
  });

  it("« rédigé pour vous » ne vaut que pour un texte long", () => {
    const state = answerField(SCHEMA, empty, "f-nature", "autre");
    const result = applyUpdates(
      SCHEMA,
      state,
      [up("f-precisez", "Un lampadaire penche depuis l'orage.", { origin: "generated" })],
      "le lampadaire penche depuis l'orage de samedi",
    );
    expect(result.state.origins["f-precisez"]).toEqual({ origin: "generated" });
  });

  it("une valeur reprise par l'USAGER perd son badge et devient sienne", () => {
    const said = "c'est au 12 rue de la Paix";
    const posed = applyUpdates(SCHEMA, empty, [up("f-lieu", "12 rue de la Paix")], said).state;
    expect(posed.origins["f-lieu"]).toBeDefined();
    const corrected = answerField(SCHEMA, posed, "f-lieu", "14 rue de la Paix");
    expect(corrected.origins["f-lieu"]).toBeUndefined();
    expect(corrected.touched).toEqual(["f-lieu"]);
  });
});

describe("readFieldUpdates — la forme de ce que rend le modèle", () => {
  it("lit des couples id/valeur, accepte un nombre, un booléen, un tableau, écarte le reste", () => {
    expect(
      readFieldUpdates([
        { id: "a", value: " oui " },
        { id: "b", value: 3 },
        { id: "c", value: "" },
        { id: 4, value: "x" },
        { id: "d", value: { x: 1 } },
        { id: "e", value: true },
        { id: "f", value: [" un ", "", { x: 1 }, "deux"] },
        { id: "g", value: [] },
        "bonjour",
        null,
      ]),
    ).toEqual([
      // ⚠️ `inferred` au doute : une origine absente ne vaut jamais « repris ».
      { id: "a", value: "oui", origin: "inferred", source: undefined, reason: undefined },
      { id: "b", value: "3", origin: "inferred", source: undefined, reason: undefined },
      { id: "e", value: "true", origin: "inferred", source: undefined, reason: undefined },
      { id: "f", value: ["un", "deux"], origin: "inferred", source: undefined, reason: undefined },
    ]);
    expect(readFieldUpdates("rien")).toEqual([]);
    expect(readFieldUpdates(Array.from({ length: 50 }, (_, i) => ({ id: "f" + i, value: "x" })))).toHaveLength(20);
  });
});

/** De quoi éprouver chaque type sans déranger les comptes du signalement. */
const TYPES: FormSchema = {
  version: 1,
  content: [
    {
      id: "f-jour",
      key: "jour",
      type: "date",
      label: "Jour souhaité",
    },
    {
      id: "f-accord",
      key: "accord",
      type: "boolean",
      label: "J'accepte d'être recontacté",
    },
    {
      id: "f-creneaux",
      key: "creneaux",
      type: "checkboxes",
      label: "Créneaux possibles",
      options: [
        { value: "matin", label: "Le matin" },
        { value: "soir", label: "Le soir" },
      ],
    },
    { id: "f-quantite", key: "quantite", type: "number", label: "Quantité" },
  ],
};

const field = (id: string) => TYPES.content.find((node) => node.id === id) as never;

describe("coerceUpdate — la valeur rendue par le modèle, ramenée au schéma publié", () => {
  it("apparie un choix par sa valeur ou par son LIBELLÉ, accents et casse indifférents", () => {
    const nature = SCHEMA.content.find((node) => node.id === "f-nature") as never;
    expect(coerceUpdate(nature, "depot")).toBe("depot");
    expect(coerceUpdate(nature, "Dépôt sauvage")).toBe("depot");
    expect(coerceUpdate(nature, "  DEPOT SAUVAGE  ")).toBe("depot");
  });

  it("⚠️ n'invente jamais une option : un libellé inconnu ne rend rien", () => {
    const nature = SCHEMA.content.find((node) => node.id === "f-nature") as never;
    expect(coerceUpdate(nature, "du plutonium")).toBeNull();
  });

  it("lit des cases à cocher, dédoublonne, et refuse tout le lot si une case est inventée", () => {
    expect(coerceUpdate(field("f-creneaux"), ["Le matin", "matin", "soir"])).toEqual(["matin", "soir"]);
    expect(coerceUpdate(field("f-creneaux"), "Le soir")).toEqual(["soir"]);
    expect(coerceUpdate(field("f-creneaux"), ["matin", "la nuit"])).toBeNull();
  });

  it("lit un oui/non, et rien d'autre", () => {
    expect(coerceUpdate(field("f-accord"), "Oui")).toBe(true);
    expect(coerceUpdate(field("f-accord"), "non")).toBe(false);
    expect(coerceUpdate(field("f-accord"), "true")).toBe(true);
    expect(coerceUpdate(field("f-accord"), "peut-être")).toBeNull();
  });

  it("⚠️ n'accepte une date qu'en AAAA-MM-JJ, et qu'un jour qui existe", () => {
    // `validateForm` ne vérifie aucun format de date : c'est la SEULE barrière.
    expect(coerceUpdate(field("f-jour"), "2026-09-24")).toBe("2026-09-24");
    expect(coerceUpdate(field("f-jour"), "24/09/2026")).toBeNull();
    expect(coerceUpdate(field("f-jour"), "2026-02-31")).toBeNull();
    expect(coerceUpdate(field("f-jour"), "jeudi")).toBeNull();
  });

  it("refuse un nombre qui n'en est pas, et une pièce jointe quoi qu'il arrive", () => {
    expect(coerceUpdate(field("f-quantite"), "12")).toBe("12");
    expect(coerceUpdate(field("f-quantite"), "beaucoup")).toBeNull();
    const photo = SCHEMA.content.find((node) => node.id === "f-photo") as never;
    expect(coerceUpdate(photo, "photo.jpg")).toBeNull();
  });

  it("⚠️ « non » à une question facultative est une RÉPONSE : le champ est passé, pas reposé", () => {
    // `isBlank(false)` étant vrai, ranger `false` laisserait le champ en
    // attente — et l'assistant reposerait la question sans fin.
    const vide: CollectionState = { demarcheId: "d1", values: {}, skipped: [], origins: {}, touched: [] };
    const result = applyUpdates(TYPES, vide, [up("f-accord", "non")], "non merci");
    expect(result.accepted).toEqual(["f-accord"]);
    expect(result.state.skipped).toEqual(["f-accord"]);
    expect(pendingFields(TYPES, result.state).map((f) => f.id)).not.toContain("f-accord");
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
