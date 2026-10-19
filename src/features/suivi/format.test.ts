import { describe, expect, it } from "vitest";
import { STRINGS } from "@/i18n/strings.ts";
import { formatDate, formatDateTime, formatSize, STATUS_KEYS } from "./format.ts";

describe("formatDate", () => {
  it("date longue en français, dans le fuseau de Paris et non celui de l'appareil", () => {
    // 23h30 UTC le 1er octobre = 01h30 le 2 octobre à Paris (UTC+2).
    expect(formatDate("2026-10-01T23:30:00Z", "fr")).toBe("2 octobre 2026");
  });

  it("rend un instant illisible tel quel", () => {
    expect(formatDate("pas une date", "fr")).toBe("pas une date");
  });

  it("ajoute l'heure pour un message", () => {
    expect(formatDateTime("2026-10-01T12:05:00Z", "fr")).toMatch(/^1 octobre 2026.*14:05$/);
  });
});

describe("formatSize", () => {
  it("choisit l'unité", () => {
    expect(formatSize(500, "fr")).toMatch(/500/);
    expect(formatSize(2048, "fr")).toMatch(/^2/);
    expect(formatSize(5 * 1024 * 1024, "fr")).toMatch(/^5/);
  });

  it("ne dit rien d'une taille inconnue", () => {
    expect(formatSize(null, "fr")).toBeNull();
  });
});

describe("STATUS_KEYS", () => {
  it("ne désigne que des clés qui existent", () => {
    for (const key of Object.values(STATUS_KEYS)) expect(STRINGS).toHaveProperty(key);
  });

  it("dit les libellés attendus", () => {
    expect(STRINGS[STATUS_KEYS.en_attente].fr).toBe("En attente de votre réponse");
    expect(STRINGS[STATUS_KEYS.traitee].fr).toBe("Traitée");
  });
});
