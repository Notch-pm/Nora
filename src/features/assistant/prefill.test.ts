import { describe, expect, it } from "vitest";
import {
  buildPrefill,
  parsePrefill,
  prefillStorageKey,
  readAndClearPrefill,
  serializePrefill,
  writePrefill,
  type DemarchePrefill,
  type PrefillStorage,
} from "./prefill.ts";
import { answerField, chooseOrganization, setAudience, setConsent, setRequesterValue, startSession, type CollectDemarche } from "./collect.ts";
import { parseRequesterConfig } from "@fn/_shared/domain/requesterConfig.ts";
import type { FormSchema } from "@fn/_shared/domain/formSchema.ts";

function memoryStorage(initial: Record<string, string> = {}): PrefillStorage {
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

const FORM: FormSchema = {
  version: 1,
  content: [{ id: "f-lieu", key: "lieu", type: "text", label: "Lieu", required: true }],
};

function demarche(overrides: Partial<CollectDemarche> = {}): CollectDemarche {
  return {
    id: "d1",
    name: "Une démarche",
    form: FORM,
    requester: parseRequesterConfig({ citoyen: { enabled: true, fields: { courriel: "obligatoire" } } }),
    organizations: [{ id: "o1", name: "Mairie", slug: null, logoUrl: null }],
    tenantName: "Nantes Métropole",
    ...overrides,
  };
}

describe("prefillStorageKey", () => {
  it("une clé par démarche", () => {
    expect(prefillStorageKey("d1")).toBe("nora.assistant.prefill.d1");
    expect(prefillStorageKey("d2")).not.toBe(prefillStorageKey("d1"));
  });
});

describe("buildPrefill", () => {
  it("retient les réponses, l'identité, l'organisme — jamais l'état d'étape", () => {
    let session = startSession(demarche());
    session = answerField(session, "f-lieu", "12 rue de la Paix");
    session = chooseOrganization(session, "o1");
    session = setAudience(session, "citoyen");
    session = setRequesterValue(session, "courriel", "a@b.fr");
    session = setConsent(session, "traitement", true);

    expect(buildPrefill(session)).toEqual({
      values: { "f-lieu": "12 rue de la Paix" },
      requesterValues: { courriel: "a@b.fr" },
      audience: "citoyen",
      organizationId: "o1",
      consents: { traitement: true, partage: true },
    });
  });
});

describe("parsePrefill", () => {
  it("lit une entrée valide", () => {
    const prefill: DemarchePrefill = {
      values: { "f-lieu": "Ici" },
      requesterValues: { courriel: "a@b.fr" },
      audience: "entreprise",
      organizationId: "o2",
      consents: { traitement: true, partage: false },
    };
    expect(parsePrefill(serializePrefill(prefill))).toEqual(prefill);
  });

  it("rend `null` pour du JSON illisible ou une forme inattendue", () => {
    expect(parsePrefill(null)).toBeNull();
    expect(parsePrefill("{ pas du JSON")).toBeNull();
    expect(parsePrefill("[]")).toBeNull();
  });

  it("retombe sur des défauts vides quand les blocs manquent ou sont abîmés", () => {
    expect(parsePrefill(JSON.stringify({}))).toEqual({
      values: {},
      requesterValues: {},
      audience: null,
      organizationId: null,
      // Les défauts du catalogue : la case obligatoire reste à cocher.
      consents: { traitement: false, partage: true },
    });
  });

  it("écarte une audience inconnue, garde seulement les valeurs de chaînes", () => {
    const raw = JSON.stringify({
      values: { a: "x" },
      requesterValues: { courriel: "a@b.fr", age: 42 },
      audience: "robot",
      organizationId: "",
      consents: { traitement: "oui", partage: false },
    });
    expect(parsePrefill(raw)).toEqual({
      values: { a: "x" },
      requesterValues: { courriel: "a@b.fr" },
      audience: null,
      organizationId: null,
      consents: { traitement: false, partage: false },
    });
  });
});

describe("writePrefill / readAndClearPrefill", () => {
  const prefill: DemarchePrefill = {
    values: { "f-lieu": "Ici" },
    requesterValues: {},
    audience: null,
    organizationId: null,
    consents: { traitement: true, partage: true },
  };

  it("dépose, puis lit UNE fois avant d'effacer", () => {
    const storage = memoryStorage();
    writePrefill(storage, "d1", prefill);
    expect(readAndClearPrefill(storage, "d1")).toEqual(prefill);
    expect(readAndClearPrefill(storage, "d1")).toBeNull();
  });

  it("ne s'applique jamais à une autre démarche", () => {
    const storage = memoryStorage();
    writePrefill(storage, "d1", prefill);
    expect(readAndClearPrefill(storage, "d2")).toBeNull();
    // Toujours là pour la bonne démarche.
    expect(readAndClearPrefill(storage, "d1")).toEqual(prefill);
  });

  it("un stockage qui lève ne fait planter ni la lecture ni l'écriture", () => {
    const storage: PrefillStorage = {
      getItem: () => { throw new Error("navigation privée"); },
      setItem: () => { throw new Error("navigation privée"); },
      removeItem: () => { throw new Error("navigation privée"); },
    };
    expect(() => writePrefill(storage, "d1", prefill)).not.toThrow();
    expect(readAndClearPrefill(storage, "d1")).toBeNull();
  });
});
