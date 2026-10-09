import { describe, expect, it } from "vitest";
import {
  cleanCourrier,
  type CourrierDraft,
  courrierOrganismeOf,
  courrierPageBySlug,
  courrierPages,
  fileProblem,
  httpStatusForCourrierFailure,
  MAX_BODY,
  MAX_COURRIER_FILE_BYTES,
  parseCourrierOrganismes,
  parseFreeMail,
  validateCourrier,
} from "./courrier.ts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ARLES = "22222222-2222-4222-8222-222222222222";
const CCAS = "33333333-3333-4333-8333-333333333333";

const SOCLE_ORGANISMES = [
  { id: TENANT, name: "ACCM", slug: "accm", is_tenant: true, free_mail: { enabled: true, title: null } },
  { id: ARLES, name: "Mairie d'Arles", slug: "mairie-d-arles", is_tenant: false, free_mail: { enabled: true, title: " Écrire au maire " } },
  { id: CCAS, name: "CCAS", slug: "ccas-arles", is_tenant: false, free_mail: { enabled: false, title: "Ignoré" } },
  // Socle d'avant 1.38.0 : pas de `free_mail` du tout.
  { id: "44444444-4444-4444-8444-444444444444", name: "Médiathèque", slug: "mediatheque", is_tenant: false },
];

const DRAFT: CourrierDraft = {
  subject: "Éclairage rue des Arènes",
  body: "Le lampadaire est éteint depuis une semaine.",
  senderCategory: "citoyen",
  senderCivilite: "madame",
  senderFirstName: "Camille",
  senderLastName: "Martin",
  senderEmail: "camille@example.org",
  senderPhone: "",
};

describe("parseFreeMail — fermé au doute", () => {
  it("n'ouvre que sur `enabled === true`", () => {
    for (const raw of [undefined, null, "oui", [], {}, { enabled: "true" }, { enabled: 1 }]) {
      expect(parseFreeMail(raw)).toEqual({ enabled: false, title: null });
    }
    expect(parseFreeMail({ enabled: true })).toEqual({ enabled: true, title: null });
  });

  it("un titre vide vaut le libellé par défaut ; un titre sous un courrier fermé est oublié", () => {
    expect(parseFreeMail({ enabled: true, title: "   " })).toEqual({ enabled: true, title: null });
    expect(parseFreeMail({ enabled: true, title: " Nous écrire " })).toEqual({ enabled: true, title: "Nous écrire" });
    expect(parseFreeMail({ enabled: false, title: "Nous écrire" }).title).toBeNull();
  });
});

describe("courrierOrganismeOf — qui reçoit du courrier, à cette adresse", () => {
  const organismes = parseCourrierOrganismes(SOCLE_ORGANISMES);

  it("sans slug : la collectivité elle-même, si elle reçoit du courrier", () => {
    expect(courrierOrganismeOf(organismes, null)?.id).toBe(TENANT);
    const fermee = parseCourrierOrganismes([{ ...SOCLE_ORGANISMES[0], free_mail: { enabled: false } }]);
    expect(courrierOrganismeOf(fermee, null)).toBeNull();
  });

  it("un slug : l'organisme, sans casse — jamais la collectivité sous son slug", () => {
    expect(courrierOrganismeOf(organismes, "Mairie-D-Arles")?.freeMail).toEqual({ enabled: true, title: "Écrire au maire" });
    expect(courrierOrganismeOf(organismes, "accm")).toBeNull();
  });

  it("fermé, sans `free_mail`, ou inconnu : le même « pas ici »", () => {
    expect(courrierOrganismeOf(organismes, "ccas-arles")).toBeNull();
    expect(courrierOrganismeOf(organismes, "mediatheque")).toBeNull();
    expect(courrierOrganismeOf(organismes, "nulle-part")).toBeNull();
    expect(courrierOrganismeOf(organismes, " ")).toBeNull();
  });

  it("ouvre une page aux seuls organismes à slug qui reçoivent du courrier, hors collectivité", () => {
    expect(courrierPages(organismes).map((o) => o.id)).toEqual([ARLES]);
    expect(courrierPageBySlug(organismes, "mairie-d-arles")).toEqual({
      id: ARLES,
      name: "Mairie d'Arles",
      slug: "mairie-d-arles",
      logoUrl: null,
    });
    expect(courrierPageBySlug(organismes, "ccas-arles")).toBeNull();
  });

  it("lit la réponse avec tolérance : illisible ou en double, écarté", () => {
    expect(parseCourrierOrganismes("x")).toEqual([]);
    expect(parseCourrierOrganismes([{ name: "sans id" }, SOCLE_ORGANISMES[1], SOCLE_ORGANISMES[1]])).toHaveLength(1);
  });
});

describe("validateCourrier — les mêmes règles à l'écran et au serveur", () => {
  it("un courrier complet passe", () => {
    expect(validateCourrier(DRAFT)).toEqual({});
  });

  it("objet, message, prénom et nom d'un citoyen sont obligatoires", () => {
    const errors = validateCourrier({ ...DRAFT, subject: " ", body: "", senderFirstName: "", senderLastName: "" });
    expect(Object.keys(errors).sort()).toEqual(["body", "senderFirstName", "senderLastName", "subject"]);
  });

  it("une entreprise n'a pas de prénom : seule la raison sociale est exigée", () => {
    expect(validateCourrier({ ...DRAFT, senderCategory: "entreprise", senderFirstName: "" })).toEqual({});
  });

  it("⚠️ au moins un moyen de répondre — l'erreur se range sous le courriel", () => {
    expect(validateCourrier({ ...DRAFT, senderEmail: "", senderPhone: "" })).toEqual({
      senderEmail: { key: "validation.contactRequired" },
    });
    expect(validateCourrier({ ...DRAFT, senderEmail: "", senderPhone: "06 12 34 56 78" })).toEqual({});
    expect(validateCourrier({ ...DRAFT, senderEmail: "pas-un-courriel" }).senderEmail?.key).toBe("validation.email");
    expect(validateCourrier({ ...DRAFT, senderPhone: "appelez-moi" }).senderPhone?.key).toBe("validation.phone");
  });

  it("borne la longueur du message", () => {
    expect(validateCourrier({ ...DRAFT, body: "x".repeat(MAX_BODY + 1) }).body).toEqual({
      key: "validation.maxLength",
      params: { n: MAX_BODY },
    });
  });

  it("trois fichiers au plus, 5 Mo chacun, formats fermés", () => {
    const ok = { name: "photo.JPG", size: 1000 };
    expect(validateCourrier(DRAFT, [ok, ok, ok])).toEqual({});
    expect(validateCourrier(DRAFT, [ok, ok, ok, ok]).files?.key).toBe("validation.maxFiles");
    expect(validateCourrier(DRAFT, [{ name: "gros.pdf", size: MAX_COURRIER_FILE_BYTES + 1 }]).files?.key).toBe(
      "validation.fileTooLarge",
    );
    expect(validateCourrier(DRAFT, [{ name: "virus.exe", size: 10 }]).files).toEqual({
      key: "validation.fileUnsupported",
      params: { name: "virus.exe" },
    });
  });

  it("fileProblem : vide, trop lourd, sans extension ou hors liste", () => {
    expect(fileProblem({ name: "a.pdf", size: 0 })).toBe("empty");
    expect(fileProblem({ name: "a.pdf", size: MAX_COURRIER_FILE_BYTES })).toBeNull();
    expect(fileProblem({ name: "pdf", size: 10 })).toBe("unsupported");
    expect(fileProblem({ name: "lettre.docx", size: 10 })).toBeNull();
  });
});

describe("cleanCourrier — ce qui part", () => {
  it("retire civilité et prénom d'un courrier d'entreprise, et nettoie le texte", () => {
    expect(cleanCourrier({ ...DRAFT, senderCategory: "entreprise", subject: "  Objet  " })).toMatchObject({
      subject: "Objet",
      senderCivilite: "",
      senderFirstName: "",
      senderLastName: "Martin",
    });
  });

  it("une civilité hors liste n'est pas transmise", () => {
    expect(cleanCourrier({ ...DRAFT, senderCivilite: "Docteur" }).senderCivilite).toBe("");
    expect(cleanCourrier({ ...DRAFT, senderCivilite: "Monsieur" }).senderCivilite).toBe("monsieur");
  });
});

describe("httpStatusForCourrierFailure", () => {
  it("un organisme fermé est un 404, des secrets absents un 503, Clara en panne un 502", () => {
    expect(httpStatusForCourrierFailure("courrier_unavailable")).toBe(404);
    expect(httpStatusForCourrierFailure("courrier_not_configured")).toBe(503);
    expect(httpStatusForCourrierFailure("clara_unavailable")).toBe(502);
    expect(httpStatusForCourrierFailure("challenge_required")).toBe(428);
  });
});
