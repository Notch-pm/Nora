import { describe, expect, it } from "vitest";
import { validateCourrier } from "@fn/_shared/domain/courrier.ts";
import { STRINGS } from "@/i18n/strings.ts";
import { COURRIER_SEND_ERROR_KEYS } from "./sendErrors.ts";
import { senderFields, splitCourrierErrors, toCourrierDraft } from "./sender.ts";

const label = (key: string) => key;

describe("senderFields — le bloc d'identité, fixé par le portail", () => {
  it("un citoyen : civilité facultative, prénom et nom obligatoires, puis de quoi répondre", () => {
    expect(senderFields("citoyen", label).map((f) => [f.key, f.required])).toEqual([
      ["civilite", false],
      ["prenoms", true],
      ["nom_usuel", true],
      ["courriel", false],
      ["tel_portable", false],
    ]);
  });

  it("une entreprise ou une association : la raison sociale, sous son propre libellé", () => {
    expect(senderFields("entreprise", label)[0]).toEqual({ key: "raison_sociale", label: "courrierLibre.companyName", required: true });
    expect(senderFields("association", label)[0].label).toBe("courrierLibre.associationName");
  });
});

describe("toCourrierDraft / splitCourrierErrors — l'aller et le retour", () => {
  const values = { civilite: "monsieur", prenoms: "Paul", nom_usuel: "Durand", raison_sociale: "Durand SARL", courriel: "", tel_portable: "" };

  it("la raison sociale part comme nom d'une entreprise ; le prénom saisi avant n'est pas repris", () => {
    const draft = toCourrierDraft({ subject: "S", body: "B" }, "entreprise", values);
    expect(draft).toMatchObject({ senderLastName: "Durand SARL", senderFirstName: "", senderCivilite: "" });
  });

  it("range les erreurs de l'expéditeur sous les clés du bloc, le reste sous son nom", () => {
    const draft = toCourrierDraft({ subject: "", body: "B" }, "citoyen", values);
    const { text, sender } = splitCourrierErrors(validateCourrier(draft), "citoyen");
    expect(Object.keys(text)).toEqual(["subject"]);
    expect(sender).toEqual({ courriel: { key: "validation.contactRequired" } });
  });
});

describe("les refus d'envoi ont tous une phrase", () => {
  it("chaque code renvoie à une clé du dictionnaire", () => {
    for (const key of Object.values(COURRIER_SEND_ERROR_KEYS)) expect(STRINGS[key]?.fr, key).toBeTruthy();
  });
});
