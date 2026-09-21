import { describe, expect, it } from "vitest";
import type { FormSchema } from "@fn/_shared/domain/formSchema.ts";
import { parseRequesterConfig } from "@fn/_shared/domain/requesterConfig.ts";
import { answerField, chooseOrganization, type CollectDemarche, confirmIdentity, confirmOrganization, setAudience, setRequesterValue, skipField, startSession } from "./collect.ts";
import { buildRecap } from "./recap.ts";

const FORM: FormSchema = {
  version: 1,
  content: [
    {
      id: "s1",
      kind: "section",
      title: "Le dépôt",
      fields: [
        { id: "f-lieu", key: "lieu", type: "text", label: "Lieu du dépôt", required: true },
        {
          id: "f-nature", key: "nature", type: "radio", label: "Nature", required: true,
          options: [{ value: "gravats", label: "Gravats" }, { value: "autre", label: "Autre" }],
        },
      ],
    },
    { id: "f-urgent", key: "urgent", type: "boolean", label: "C'est urgent" },
    { id: "f-precisions", key: "precisions", type: "textarea", label: "Précisions" },
  ],
};

function demarche(overrides: Partial<CollectDemarche> = {}): CollectDemarche {
  return {
    id: "d1",
    name: "Signaler un problème de propreté",
    form: FORM,
    requester: parseRequesterConfig(null),
    organizations: [],
    ...overrides,
  };
}

describe("buildRecap", () => {
  it("respecte les sections, et affiche un tiret pour un champ facultatif passé", () => {
    let session = startSession(demarche());
    session = answerField(session, "f-lieu", "12 rue de la Paix");
    session = answerField(session, "f-nature", "gravats");
    session = answerField(session, "f-urgent", true);
    session = skipField(session, "f-precisions");

    const recap = buildRecap("fr", session);
    expect(recap.sections).toEqual([
      {
        id: "s1",
        title: "Le dépôt",
        rows: [
          { fieldId: "f-lieu", label: "Lieu du dépôt", value: "12 rue de la Paix" },
          { fieldId: "f-nature", label: "Nature", value: "Gravats" },
        ],
      },
      { id: "f-urgent", title: null, rows: [{ fieldId: "f-urgent", label: "C'est urgent", value: "Oui" }] },
      { id: "f-precisions", title: null, rows: [{ fieldId: "f-precisions", label: "Précisions", value: "—" }] },
    ]);
  });

  it("montre l'organisme choisi", () => {
    let session = startSession(
      demarche({
        organizations: [
          { id: "o1", name: "Mairie", slug: null, logoUrl: null },
          { id: "o2", name: "CCAS", slug: null, logoUrl: null },
        ],
      }),
    );
    session = answerField(session, "f-lieu", "Ici");
    session = answerField(session, "f-nature", "autre");
    session = answerField(session, "f-urgent", false);
    session = skipField(session, "f-precisions");
    session = chooseOrganization(session, "o2");
    session = confirmOrganization(session);

    expect(buildRecap("fr", session).organization).toEqual({ id: "o2", name: "CCAS" });
  });

  it("rend `null` sans public choisi — la demande part sans identité déclarée", () => {
    const session = startSession(demarche());
    expect(buildRecap("fr", session).identity).toBeNull();
  });

  it("traduit la civilité, laisse le reste tel quel, marque le vide d'un tiret", () => {
    const citoyenOuvert = parseRequesterConfig({
      citoyen: { enabled: true, fields: { civilite: "visible", courriel: "obligatoire", nom_usuel: "masque" } },
    });
    let session = startSession(demarche({ requester: citoyenOuvert }));
    session = setAudience(session, "citoyen");
    session = setRequesterValue(session, "civilite", "madame");
    session = setRequesterValue(session, "courriel", "a@b.fr");
    session = confirmIdentity(session);

    const identity = buildRecap("fr", session).identity;
    expect(identity?.audienceLabel).toBe("Citoyen");
    expect(identity?.rows).toEqual([
      { fieldId: "civilite", label: "Civilité", value: "Madame" },
      { fieldId: "courriel", label: "Courriel", value: "a@b.fr" },
    ]);
  });
});
