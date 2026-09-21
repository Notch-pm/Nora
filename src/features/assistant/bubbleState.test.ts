import { describe, expect, it } from "vitest";
import { CLOSED, panelSize, readBubbleUi } from "./bubbleState.ts";

describe("readBubbleUi — au doute, fermé", () => {
  it("relit une bulle ouverte, avec la démarche d'où elle vient", () => {
    expect(readBubbleUi({ open: true, focusDemarcheId: "d1" })).toEqual({ open: true, focusDemarcheId: "d1" });
    expect(readBubbleUi({ open: true })).toEqual({ open: true, focusDemarcheId: null });
  });

  it("⚠️ tout ce qui n'est pas franchement ouvert est fermé", () => {
    // S'ouvrir sans que personne ne l'ait demandé serait le pire défaut d'une
    // bulle : une clé abîmée ne doit donc jamais l'ouvrir.
    for (const raw of [null, undefined, "x", 3, [], {}, { open: "true" }, { open: 1 }, { open: false }]) {
      expect(readBubbleUi(raw)).toEqual(CLOSED);
    }
  });

  it("une démarche vide ou d'un autre type ne vaut pas une démarche", () => {
    expect(readBubbleUi({ open: true, focusDemarcheId: "" }).focusDemarcheId).toBeNull();
    expect(readBubbleUi({ open: true, focusDemarcheId: 42 }).focusDemarcheId).toBeNull();
  });
});

describe("panelSize — le cadre s'adapte, le contenu ne se recroqueville pas", () => {
  it("s'élargit pour relire et pour se nommer, se resserre pour le reste", () => {
    expect(panelSize("recap")).toBe("large");
    expect(panelSize("identity")).toBe("large");
    expect(panelSize("fields")).toBe("compact");
    expect(panelSize("organization")).toBe("compact");
    expect(panelSize(null)).toBe("compact");
  });
});
