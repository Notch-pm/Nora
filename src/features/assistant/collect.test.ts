import { describe, expect, it } from "vitest";
import type { FormSchema } from "@fn/_shared/domain/formSchema.ts";
import { parseRequesterConfig } from "@fn/_shared/domain/requesterConfig.ts";
import {
  answerField,
  applyServerCollection,
  assistantWrites,
  chooseOrganization,
  type CollectDemarche,
  clearCollect,
  type CollectStorage,
  collectionPayload,
  confirmIdentity,
  confirmOrganization,
  effectiveOrganizationId,
  loadCollect,
  mergeTimeline,
  needsIdentity,
  needsOrganizationChoice,
  parseStoredCollect,
  progressOf,
  receiptNote,
  reopenField,
  reopenIdentity,
  reopenOrganization,
  saveCollect,
  setAudience,
  setRequesterValue,
  skipField,
  startedNote,
  startSession,
  stepOf,
  toDemandeSubmission,
} from "./collect.ts";

function memoryStorage(initial: Record<string, string> = {}): CollectStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const PROPRETE_FORM: FormSchema = {
  version: 1,
  content: [
    { id: "f-lieu", key: "lieu", type: "text", label: "Lieu du dépôt", required: true, help: "Adresse ou repère" },
    {
      id: "f-nature",
      key: "nature",
      type: "radio",
      label: "Nature",
      required: true,
      options: [{ value: "gravats", label: "Gravats" }, { value: "autre", label: "Autre" }],
    },
    { id: "f-precisions", key: "precisions", type: "textarea", label: "Précisions" },
  ],
};

function demarche(overrides: Partial<CollectDemarche> = {}): CollectDemarche {
  return {
    id: "d1",
    name: "Signaler un problème de propreté",
    form: PROPRETE_FORM,
    requester: parseRequesterConfig(null),
    organizations: [],
    ...overrides,
  };
}

const CITOYEN_OUVERT = parseRequesterConfig({
  citoyen: { enabled: true, fields: { courriel: "obligatoire" } },
});

describe("startSession", () => {
  it("ouvre sans réponse, sans appel au modèle", () => {
    const session = startSession(demarche());
    expect(session.collection).toEqual({ demarcheId: "d1", values: {}, skipped: [], origins: {}, touched: [] });
    expect(stepOf(session)).toBe("fields");
  });

  it("confirme d'emblée l'organisme s'il n'y a rien à choisir (0 ou 1)", () => {
    expect(startSession(demarche({ organizations: [] })).organizationConfirmed).toBe(true);
    expect(
      startSession(demarche({ organizations: [{ id: "o1", name: "Mairie", slug: null, logoUrl: null }] }))
        .organizationConfirmed,
    ).toBe(true);
    expect(
      startSession(
        demarche({
          organizations: [
            { id: "o1", name: "Mairie", slug: null, logoUrl: null },
            { id: "o2", name: "CCAS", slug: null, logoUrl: null },
          ],
        }),
      ).organizationConfirmed,
    ).toBe(false);
  });

  it("confirme d'emblée l'identité si la collectivité n'a ouvert aucun public", () => {
    expect(startSession(demarche()).identityConfirmed).toBe(true);
    expect(startSession(demarche({ requester: CITOYEN_OUVERT })).identityConfirmed).toBe(false);
  });

  it("présélectionne le premier public ouvert — même règle que FormulairePage", () => {
    expect(startSession(demarche()).audience).toBeNull();
    expect(startSession(demarche({ requester: CITOYEN_OUVERT })).audience).toBe("citoyen");
  });
});

describe("needsOrganizationChoice / needsIdentity", () => {
  it("reflètent le nombre d'organismes et les publics ouverts", () => {
    expect(needsOrganizationChoice(demarche({ organizations: [] }))).toBe(false);
    expect(
      needsOrganizationChoice(
        demarche({ organizations: [{ id: "o1", name: "A", slug: null, logoUrl: null }, { id: "o2", name: "B", slug: null, logoUrl: null }] }),
      ),
    ).toBe(true);
    expect(needsIdentity(demarche())).toBe(false);
    expect(needsIdentity(demarche({ requester: CITOYEN_OUVERT }))).toBe(true);
  });
});

describe("stepOf — la machine d'étapes", () => {
  it("reste à « fields » tant qu'un champ obligatoire manque", () => {
    let session = startSession(demarche());
    expect(stepOf(session)).toBe("fields");
    session = answerField(session, "f-lieu", "12 rue de la Paix");
    expect(stepOf(session)).toBe("fields");
    session = answerField(session, "f-nature", "gravats");
    // f-precisions est facultatif : sans réponse ni « Passer », il reste en attente.
    expect(stepOf(session)).toBe("fields");
    session = skipField(session, "f-precisions");
    expect(stepOf(session)).toBe("recap");
  });

  it("passe par « organization » avant « recap » quand il y a un choix", () => {
    const twoOrgs = demarche({
      organizations: [
        { id: "o1", name: "Mairie", slug: null, logoUrl: null },
        { id: "o2", name: "CCAS", slug: null, logoUrl: null },
      ],
    });
    let session = startSession(twoOrgs);
    session = answerField(session, "f-lieu", "Ici");
    session = answerField(session, "f-nature", "autre");
    session = skipField(session, "f-precisions");
    expect(stepOf(session)).toBe("organization");
    session = chooseOrganization(session, "o2");
    expect(stepOf(session)).toBe("organization"); // choisi, mais pas encore confirmé
    session = confirmOrganization(session);
    expect(stepOf(session)).toBe("recap");
  });

  it("passe par « identity » avant « recap » quand un public est ouvert", () => {
    let session = startSession(demarche({ requester: CITOYEN_OUVERT }));
    session = answerField(session, "f-lieu", "Ici");
    session = answerField(session, "f-nature", "autre");
    session = skipField(session, "f-precisions");
    expect(stepOf(session)).toBe("identity");
    session = setAudience(session, "citoyen");
    session = setRequesterValue(session, "courriel", "a@b.fr");
    session = confirmIdentity(session);
    expect(stepOf(session)).toBe("recap");
  });
});

describe("applyServerCollection", () => {
  it("remplace l'état local, nettoyé contre le formulaire", () => {
    const session = startSession(demarche());
    const next = applyServerCollection(session, { demarcheId: "d1", values: { "f-lieu": "Ici" }, skipped: [] });
    expect(next?.collection.values).toEqual({ "f-lieu": "Ici" });
  });

  it("ignore une réponse qui parle d'une autre démarche", () => {
    const session = startSession(demarche());
    const next = applyServerCollection(session, { demarcheId: "autre", values: { "f-lieu": "Ici" }, skipped: [] });
    expect(next).toBe(session);
  });

  it("ne plante pas sans session", () => {
    expect(applyServerCollection(null, { demarcheId: "d1", values: {}, skipped: [] })).toBeNull();
  });
});

describe("reopenField — « Modifier » du récapitulatif", () => {
  const CONDITIONAL_FORM: FormSchema = {
    version: 1,
    content: [
      {
        id: "f-mode", key: "mode", type: "radio", label: "Mode", required: true,
        options: [{ value: "maison", label: "Maison" }, { value: "appartement", label: "Appartement" }],
      },
      {
        id: "f-etage", key: "etage", type: "text", label: "Étage", required: true,
        visibleIf: { combinator: "and", rules: [{ fieldId: "f-mode", operator: "equals", value: "appartement" }] },
      },
    ],
  };

  it("vide la réponse et dit combien d'AUTRES réponses tombent en cascade", () => {
    let session = startSession(demarche({ form: CONDITIONAL_FORM }));
    session = answerField(session, "f-mode", "appartement");
    session = answerField(session, "f-etage", "3");
    expect(stepOf(session)).toBe("recap");

    const { session: reopened, purgedCount } = reopenField(session, "f-mode");
    expect(reopened.collection.values).toEqual({});
    expect(purgedCount).toBe(1); // f-etage, masqué par la disparition de f-mode
    expect(stepOf(reopened)).toBe("fields");
  });

  it("ne compte pas le champ rouvert lui-même", () => {
    let session = startSession(demarche());
    session = answerField(session, "f-lieu", "Ici");
    const { purgedCount } = reopenField(session, "f-lieu");
    expect(purgedCount).toBe(0);
  });
});

describe("reopenOrganization / reopenIdentity", () => {
  it("redemandent une confirmation, sans effacer le choix précédent", () => {
    const twoOrgs = demarche({
      organizations: [
        { id: "o1", name: "Mairie", slug: null, logoUrl: null },
        { id: "o2", name: "CCAS", slug: null, logoUrl: null },
      ],
    });
    let session = startSession(twoOrgs);
    session = chooseOrganization(session, "o1");
    session = confirmOrganization(session);
    session = reopenOrganization(session);
    expect(session.organizationConfirmed).toBe(false);
    expect(session.organizationId).toBe("o1"); // pré-rempli avec le choix précédent

    let withAudience = startSession(demarche({ requester: CITOYEN_OUVERT }));
    withAudience = setAudience(withAudience, "citoyen");
    withAudience = confirmIdentity(withAudience);
    withAudience = reopenIdentity(withAudience);
    expect(withAudience.identityConfirmed).toBe(false);
    expect(withAudience.audience).toBe("citoyen");
  });
});

describe("effectiveOrganizationId", () => {
  it("rend le seul organisme possible sans qu'il ait fallu choisir", () => {
    const session = startSession(demarche({ organizations: [{ id: "o1", name: "Mairie", slug: null, logoUrl: null }] }));
    expect(effectiveOrganizationId(session)).toBe("o1");
  });

  it("rend `null` tant qu'un choix entre plusieurs organismes n'est pas fait", () => {
    const session = startSession(
      demarche({
        organizations: [
          { id: "o1", name: "Mairie", slug: null, logoUrl: null },
          { id: "o2", name: "CCAS", slug: null, logoUrl: null },
        ],
      }),
    );
    expect(effectiveOrganizationId(session)).toBeNull();
  });
});

describe("collectionPayload — jamais l'identité ni l'organisme", () => {
  it("ne porte que ce que le formulaire connaît", () => {
    let session = startSession(demarche({ requester: CITOYEN_OUVERT }));
    session = answerField(session, "f-lieu", "Ici");
    session = setAudience(session, "citoyen");
    session = setRequesterValue(session, "courriel", "a@b.fr");
    expect(collectionPayload(session)).toEqual({
      demarcheId: "d1",
      values: { "f-lieu": "Ici" },
      skipped: [],
      origins: {},
      // ⚠️ `touched` voyage : le serveur n'a pas de mémoire, et sans lui le
      // garde-fou « l'assistant ne réécrit pas ce que j'ai saisi » ne tiendrait
      // qu'un seul tour.
      touched: ["f-lieu"],
    });
  });
});

describe("progressOf — ce que dit la barre du co-pilote", () => {
  it("compte les champs visibles, et ceux qui portent une réponse", () => {
    let session = startSession(demarche());
    expect(progressOf(session)).toEqual({ done: 0, total: 3, remainingRequired: 2 });

    session = answerField(session, "f-lieu", "12 rue de la Paix");
    expect(progressOf(session)).toEqual({ done: 1, total: 3, remainingRequired: 1 });

    session = answerField(session, "f-nature", "gravats");
    expect(progressOf(session)).toEqual({ done: 2, total: 3, remainingRequired: 0 });
  });

  it("⚠️ un champ PASSÉ n'est pas un champ rempli", () => {
    // « Précisions — facultatif », que l'usager choisit de ne pas donner : il
    // ne fait pas monter le compteur, il cesse seulement d'être demandé. Une
    // barre qui avancerait en sautant des questions mentirait sur le travail
    // accompli.
    let session = startSession(demarche());
    session = skipField(session, "f-precisions");
    expect(progressOf(session)).toEqual({ done: 0, total: 3, remainingRequired: 2 });
  });

  it("⚠️ un champ MASQUÉ ne compte pas — il n'est pas du formulaire de cet usager", () => {
    const conditionnel: FormSchema = {
      version: 1,
      content: [
        ...PROPRETE_FORM.content,
        {
          id: "f-autre",
          key: "autre",
          type: "text",
          label: "Laquelle ?",
          required: true,
          visibleIf: { combinator: "and", rules: [{ fieldId: "f-nature", operator: "equals", value: "autre" }] },
        },
      ],
    };
    let session = startSession(demarche({ form: conditionnel }));
    expect(progressOf(session).total).toBe(3);

    session = answerField(session, "f-nature", "autre");
    expect(progressOf(session)).toEqual({ done: 1, total: 4, remainingRequired: 2 });
  });
});

describe("assistantWrites — ce qu'on annonce à voix haute", () => {
  /** Une session où l'assistant a écrit, comme le ferait un tour de conversation. */
  function written(): ReturnType<typeof startSession> {
    const session = startSession(demarche());
    return {
      ...session,
      collection: {
        ...session.collection,
        values: { "f-lieu": "12 rue de la Paix", "f-nature": "gravats" },
        origins: {
          "f-lieu": { origin: "extracted", source: "au 12 rue de la Paix" },
          "f-nature": { origin: "inferred", reason: "vous parlez de gravats" },
        },
      },
    };
  }

  it("⚠️ annonce le LIBELLÉ d'une option, jamais son code machine", () => {
    // « gravats » est une valeur du Socle ; « Gravats » est ce que l'usager lit.
    expect(assistantWrites(written())).toEqual([
      { id: "f-lieu", label: "Lieu du dépôt", value: "12 rue de la Paix" },
      { id: "f-nature", label: "Nature", value: "Gravats" },
    ]);
  });

  it("⚠️ n'annonce PAS ce que l'usager a saisi lui-même", () => {
    // Il vient de le taper : le lui relire serait du bruit, et le mot
    // « renseigné par l'assistant » serait faux.
    const session = answerField(startSession(demarche()), "f-lieu", "12 rue de la Paix");
    expect(assistantWrites(session)).toEqual([]);
  });

  it("se tait sur un champ corrigé à la main après coup", () => {
    const corrected = answerField(written(), "f-lieu", "14 rue de la Paix");
    expect(assistantWrites(corrected).map((entry) => entry.id)).toEqual(["f-nature"]);
  });
});

describe("toDemandeSubmission", () => {
  it("dépose sans identité quand aucun public n'a été choisi", () => {
    let session = startSession(demarche());
    session = answerField(session, "f-lieu", "12 rue de la Paix");
    session = answerField(session, "f-nature", "gravats");
    session = skipField(session, "f-precisions");
    const submission = toDemandeSubmission(session, "sub-1");
    expect(submission).toEqual({
      demarcheId: "d1",
      organizationId: null,
      formData: { lieu: "12 rue de la Paix", nature: "gravats" },
      requester: null,
      submissionId: "sub-1",
      attachments: [],
    });
  });

  it("porte l'identité déclarée quand un public a été choisi", () => {
    let session = startSession(demarche({ requester: CITOYEN_OUVERT }));
    session = answerField(session, "f-lieu", "Ici");
    session = answerField(session, "f-nature", "autre");
    session = skipField(session, "f-precisions");
    session = setAudience(session, "citoyen");
    session = setRequesterValue(session, "courriel", "a@b.fr");
    session = confirmIdentity(session);
    const submission = toDemandeSubmission(session, "sub-2");
    expect(submission.requester).toEqual({ contact_type: "personne", courriel: "a@b.fr" });
  });
});

describe("mergeTimeline", () => {
  const m = (id: string) => ({ id });

  it("place une note avant les messages quand elle est apparue au tout début", () => {
    const timeline = mergeTimeline([m("a"), m("b")], [startedNote("X", 0)]);
    expect(timeline.map((e) => e.kind)).toEqual(["note", "message", "message"]);
  });

  it("place une note juste après le message qui précédait sa création", () => {
    const note = startedNote("X", 1);
    const timeline = mergeTimeline([m("a"), m("b")], [note]);
    expect(timeline).toEqual([
      { kind: "message", message: m("a") },
      { kind: "note", note },
      { kind: "message", message: m("b") },
    ]);
  });

  it("place plusieurs notes à la fin, dans l'ordre", () => {
    const start = startedNote("X", 2);
    const receipt = receiptNote("X", 2, { reference: "DEM-1", status: "a_traiter", created: true });
    const timeline = mergeTimeline([m("a"), m("b")], [start, receipt]);
    expect(timeline.slice(2)).toEqual([
      { kind: "note", note: start },
      { kind: "note", note: receipt },
    ]);
  });
});

describe("persistance sessionStorage", () => {
  const session = startSession(demarche());

  it("range et relit un recueil en cours", () => {
    const storage = memoryStorage();
    saveCollect(storage, { session, notes: [] });
    const loaded = loadCollect(storage);
    expect(loaded?.session?.demarche.id).toBe("d1");
    expect(loaded?.session?.collection).toEqual(session.collection);
  });

  it("efface l'entrée quand il n'y a plus rien à garder", () => {
    const storage = memoryStorage({ "nora.assistant.collect": "vieille-entree" });
    saveCollect(storage, { session: null, notes: [] });
    expect(loadCollect(storage)).toBeNull();
  });

  it("garde une note même après que la session est close", () => {
    const storage = memoryStorage();
    const note = receiptNote("Propreté", 3, { reference: "DEM-1", status: "a_traiter", created: true });
    saveCollect(storage, { session: null, notes: [note] });
    expect(loadCollect(storage)).toEqual({ session: null, notes: [note] });
  });

  it("purge une entrée illisible plutôt que de la relire à chaque fois", () => {
    const storage = memoryStorage({ "nora.assistant.collect": "{ pas du JSON" });
    expect(loadCollect(storage)).toBeNull();
    expect(storage.getItem("nora.assistant.collect")).toBeNull();
  });

  it("un stockage qui lève ne fait planter ni la lecture, ni l'écriture, ni l'effacement", () => {
    const storage: CollectStorage = {
      getItem: () => { throw new Error("navigation privée"); },
      setItem: () => { throw new Error("navigation privée"); },
      removeItem: () => { throw new Error("navigation privée"); },
    };
    expect(loadCollect(storage)).toBeNull();
    expect(() => saveCollect(storage, { session, notes: [] })).not.toThrow();
    expect(() => clearCollect(storage)).not.toThrow();
  });

  it("`parseStoredCollect` rend `null` pour ce qui ne convainc pas", () => {
    expect(parseStoredCollect(null)).toBeNull();
    expect(parseStoredCollect("[]")).toBeNull();
    expect(parseStoredCollect(JSON.stringify({ session: { demarche: { id: "d1" } }, notes: [] }))).toEqual({
      session: null,
      notes: [],
    });
  });

  it("`parseStoredCollect` écarte une note sans référence lisible", () => {
    const raw = JSON.stringify({ session: null, notes: [{ id: "n1", afterMessageCount: 0, kind: "receipt" }] });
    expect(parseStoredCollect(raw)).toEqual({ session: null, notes: [] });
  });
});
