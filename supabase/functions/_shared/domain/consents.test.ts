import { describe, expect, it } from "vitest";
import {
  CONSENTS,
  consentErrorKey,
  defaultConsentAnswers,
  isConsentKind,
  normalizeConsents,
  parseConsentAnswers,
  toConsentAnswers,
  validateConsents,
} from "./consents.ts";

describe("le catalogue — fermé, deux consentements, l'obligatoire d'abord", () => {
  it("est celui d'Iris : traitement obligatoire et décoché, partage facultatif et coché", () => {
    expect(CONSENTS.map((c) => c.kind)).toEqual(["traitement", "partage"]);
    expect(CONSENTS.find((c) => c.kind === "traitement")).toEqual({
      kind: "traitement",
      required: true,
      defaultGranted: false,
    });
    expect(CONSENTS.find((c) => c.kind === "partage")).toEqual({
      kind: "partage",
      required: false,
      defaultGranted: true,
    });
  });

  it("ne reconnaît rien d'autre", () => {
    expect(isConsentKind("traitement")).toBe(true);
    expect(isConsentKind("partage")).toBe(true);
    expect(isConsentKind("email")).toBe(false);
    expect(isConsentKind(null)).toBe(false);
  });

  it("ouvre le formulaire avec traitement décoché et partage coché", () => {
    expect(defaultConsentAnswers()).toEqual({ traitement: false, partage: true });
  });
});

describe("validateConsents — le consentement obligatoire retient l'envoi", () => {
  it("refuse tant que traitement n'est pas coché", () => {
    expect(validateConsents({ traitement: false, partage: true })).toEqual({
      [consentErrorKey("traitement")]: { key: "validation.consentRequired" },
    });
    expect(validateConsents({})).toEqual({
      "consent.traitement": { key: "validation.consentRequired" },
    });
  });

  it("laisse passer un partage refusé : il est facultatif", () => {
    expect(validateConsents({ traitement: true, partage: false })).toEqual({});
  });
});

describe("toConsentAnswers — tout le catalogue part, une absence vaut refus", () => {
  it("rend les deux réponses dans l'ordre du catalogue", () => {
    expect(toConsentAnswers({ traitement: true, partage: false })).toEqual([
      { kind: "traitement", granted: true },
      { kind: "partage", granted: false },
    ]);
  });

  it("ne laisse jamais un consentement non répondu : absent = false", () => {
    expect(toConsentAnswers({ traitement: true })).toEqual([
      { kind: "traitement", granted: true },
      { kind: "partage", granted: false },
    ]);
  });
});

describe("parseConsentAnswers — lecture tolérante d'un état rangé", () => {
  it("garde les booléens, retombe sur les défauts pour le reste", () => {
    expect(parseConsentAnswers({ traitement: true, partage: false })).toEqual({ traitement: true, partage: false });
    expect(parseConsentAnswers({ traitement: "oui", autre: true })).toEqual({ traitement: false, partage: true });
    expect(parseConsentAnswers(null)).toEqual({ traitement: false, partage: true });
    expect(parseConsentAnswers([true, true])).toEqual({ traitement: false, partage: true });
  });
});

describe("normalizeConsents — la garde serveur, miroir de celle d'Iris", () => {
  it("accepte les deux réponses et les rend dans l'ordre du catalogue", () => {
    expect(
      normalizeConsents([
        { kind: "partage", granted: false },
        { kind: "traitement", granted: true },
      ]),
    ).toEqual({
      ok: true,
      consents: [
        { kind: "traitement", granted: true },
        { kind: "partage", granted: false },
      ],
    });
  });

  it("un partage omis vaut refus, pas défaut", () => {
    expect(normalizeConsents([{ kind: "traitement", granted: true }])).toEqual({
      ok: true,
      consents: [
        { kind: "traitement", granted: true },
        { kind: "partage", granted: false },
      ],
    });
  });

  it("refuse un dépôt sans consentements — l'écran pose toujours la question", () => {
    expect(normalizeConsents(undefined).ok).toBe(false);
    expect(normalizeConsents(null).ok).toBe(false);
    expect(normalizeConsents("oui").ok).toBe(false);
  });

  it("refuse le consentement obligatoire absent ou refusé", () => {
    expect(normalizeConsents([]).ok).toBe(false);
    expect(normalizeConsents([{ kind: "traitement", granted: false }, { kind: "partage", granted: true }]).ok).toBe(false);
  });

  it("refuse tout ce qui n'est pas { kind, granted } du catalogue", () => {
    // Le libellé se compose chez Iris : l'envoyer serait refusé là-bas aussi.
    expect(normalizeConsents([{ kind: "traitement", granted: true, statement: "J'accepte" }]).ok).toBe(false);
    expect(normalizeConsents([{ kind: "email", granted: true }]).ok).toBe(false);
    expect(normalizeConsents([{ kind: "traitement", granted: "oui" }]).ok).toBe(false);
    expect(normalizeConsents(["traitement"]).ok).toBe(false);
    expect(
      normalizeConsents([
        { kind: "traitement", granted: true },
        { kind: "traitement", granted: true },
      ]).ok,
    ).toBe(false);
    expect(
      normalizeConsents([
        { kind: "traitement", granted: true },
        { kind: "partage", granted: true },
        { kind: "partage", granted: false },
      ]).ok,
    ).toBe(false);
  });
});
