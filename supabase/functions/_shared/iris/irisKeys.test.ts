import { describe, expect, it } from "vitest";
import { resolveIrisKey } from "./irisKeys.ts";

const ACCM = "d5227d25-f327-493a-a9a2-278397531e33";
const ROSNY = "9bd0fe9b-ff62-462e-915e-6fa539065a49";
const registry = JSON.stringify({ [ACCM]: "irs_accm", [ROSNY.toUpperCase()]: " irs_rosny " });

describe("la clé Iris de la collectivité qui dépose", () => {
  it("chaque collectivité dépose avec SA clé — la casse de l'identifiant ne décide pas", () => {
    expect(resolveIrisKey(ACCM, { registry, legacyKey: undefined })).toEqual({ ok: true, apiKey: "irs_accm" });
    expect(resolveIrisKey(ROSNY, { registry, legacyKey: undefined })).toEqual({ ok: true, apiKey: "irs_rosny" });
  });

  it("⚠️ le registre posé fait foi SEUL : une collectivité absente ne retombe pas sur la clé d'une autre", () => {
    const other = "6b760798-2b07-4c1c-81ad-b0bdd1553ecb";
    expect(resolveIrisKey(other, { registry, legacyKey: "irs_accm" })).toEqual({ ok: false, reason: "no_key" });
    expect(resolveIrisKey(ACCM, { registry: JSON.stringify({ [ACCM]: "" }), legacyKey: "irs_x" })).toEqual({
      ok: false,
      reason: "no_key",
    });
  });

  it("sans registre, la clé unique sert comme avant — déployer ce fichier ne change rien à lui seul", () => {
    expect(resolveIrisKey(ROSNY, { registry: undefined, legacyKey: "irs_accm" })).toEqual({ ok: true, apiKey: "irs_accm" });
    expect(resolveIrisKey(ROSNY, { registry: "  ", legacyKey: "irs_accm" })).toEqual({ ok: true, apiKey: "irs_accm" });
    expect(resolveIrisKey(ROSNY, { registry: undefined, legacyKey: undefined })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("⚠️ un registre illisible ne retombe pas non plus sur la clé unique : il se corrige", () => {
    for (const broken of ["{", "[]", "\"irs_x\"", "null"]) {
      expect(resolveIrisKey(ACCM, { registry: broken, legacyKey: "irs_accm" })).toEqual({ ok: false, reason: "unreadable" });
    }
  });
});
