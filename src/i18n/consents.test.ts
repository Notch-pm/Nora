import { describe, expect, it } from "vitest";
import { t } from "./t.ts";
import { COVERED_LANGUAGES } from "./strings.ts";

/**
 * ⚠️ Les phrases FRANÇAISES des consentements sont celles qu'Iris consigne
 * (`Iris/supabase/functions/_shared/consents/catalog.ts`, `consentStatement`),
 * recopiées ici MOT POUR MOT. Iris recompose la phrase côté serveur depuis le
 * nom de la collectivité ; le portail, lui, n'envoie que la réponse. Si ces
 * deux textes divergent, ce que l'usager a lu n'est plus ce qui est archivé —
 * et la preuve ne prouve plus rien. Changer l'un, c'est changer l'autre, et
 * ce test est là pour qu'on ne l'oublie pas.
 */
const IRIS_TRAITEMENT =
  "J'accepte que les informations fournies ici soient utilisées dans le cadre du traitement de ma demande.";
const IRIS_PARTAGE = (organisme: string) =>
  `J'accepte de partager ces informations aux services de ${organisme} ` +
  "afin d'améliorer le traitement de ma demande et de mes futures demandes.";

describe("les phrases de consentement sont celles qu'Iris consigne", () => {
  it("traitement — mot pour mot", () => {
    expect(t("fr", "consent.traitement")).toBe(IRIS_TRAITEMENT);
  });

  it("partage — mot pour mot, le nom de la collectivité interpolé", () => {
    expect(t("fr", "consent.partage", { organisme: "Nantes Métropole" })).toBe(IRIS_PARTAGE("Nantes Métropole"));
  });

  it("le repli sans nom est celui d'Iris (« la collectivité »)", () => {
    expect(t("fr", "consent.organismFallback")).toBe("la collectivité");
    expect(t("fr", "consent.partage", { organisme: t("fr", "consent.organismFallback") })).toBe(
      IRIS_PARTAGE("la collectivité"),
    );
  });

  it("chaque langue nomme la collectivité dans le partage, et son libellé court", () => {
    for (const lang of COVERED_LANGUAGES) {
      expect(t(lang, "consent.partage", { organisme: "ZZZ" })).toContain("ZZZ");
      expect(t(lang, "consent.partage.short", { organisme: "ZZZ" })).toContain("ZZZ");
    }
  });
});
