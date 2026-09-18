import { describe, expect, it } from "vitest";
import { getPublicDemarche, getPublicDemarches } from "./demarcheService.ts";
import type { SocleClient, SocleReply } from "./socleClient.ts";

const replying = (reply: SocleReply): SocleClient => ({ get: async () => reply });

/** Un descriptif tel que l'étape « Communication usager » l'écrit : du Markdown. */
const DESCRIPTIF = [
  "Tout jeune Français doit se faire recenser **dans les trois mois** qui suivent ses 16 ans.",
  "",
  "- attestation remise sur place",
  "",
  "> Conservez-la : il n'en est pas délivré de duplicata.",
].join("\n");

describe("le descriptif usager est du Markdown (contrat 1.24.0)", () => {
  it("sur une carte sans résumé, n'en garde que le premier paragraphe, marques retirées", async () => {
    const body = [{ id: "p1", name: "Recensement", short_description: null, user_description: DESCRIPTIF }];
    const result = await getPublicDemarches("t1", replying({ kind: "ok", body }), "fr");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarches[0].description).toBe(
      "Tout jeune Français doit se faire recenser dans les trois mois qui suivent ses 16 ans.",
    );
  });

  it("le résumé écrit par la collectivité passe toujours avant", async () => {
    const body = [{ id: "p1", name: "Recensement", short_description: "Obligatoire à 16 ans.", user_description: DESCRIPTIF }];
    const result = await getPublicDemarches("t1", replying({ kind: "ok", body }), "fr");
    expect(result.ok && result.demarches[0].description).toBe("Obligatoire à 16 ans.");
  });

  it("sur le DÉTAIL, le descriptif arrive entier et en Markdown, et le résumé n'y retombe pas", async () => {
    // Le repli de la carte ferait ici commencer la page deux fois par le même
    // paragraphe : une fois dans l'en-tête, une fois dans le descriptif.
    const body = { id: "p1", name: "Recensement", short_description: null, user_description: DESCRIPTIF };
    const result = await getPublicDemarche("t1", "p1", replying({ kind: "ok", body }), "fr");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarche.userDescription).toBe(DESCRIPTIF);
    expect(result.demarche.description).toBeNull();
  });
});

describe("getPublicDemarche — ce que la collectivité écrit pour ses usagers", () => {
  const DETAIL = {
    id: "p1",
    name: "Certificat d'urbanisme",
    input_duration_minutes: 15,
    translations: { en: { name: "Planning certificate" } },
    user_communication: {
      delays: { processingTimeValue: 2, processingTimeUnit: "mois" },
      audience: { note: "Ouverte à toute personne, propriétaire ou non." },
      attachments: { items: [{ label: "Un plan de situation du terrain", description: "Obligatoire" }] },
      faq: { items: [{ question: "Quelle différence avec un permis ?", answer: "Le certificat informe." }] },
    },
  };

  it("lit les quatre blocs, à côté de la durée de saisie — sans les confondre", async () => {
    const result = await getPublicDemarche("t1", "p1", replying({ kind: "ok", body: DETAIL }), "fr");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Remplir : 15 minutes. Obtenir une réponse : 2 mois. Deux champs.
    expect(result.demarche.estimatedMinutes).toBe(15);
    expect(result.demarche.userCommunication).toEqual({
      responseDelay: { value: 2, unit: "mois" },
      audienceNote: "Ouverte à toute personne, propriétaire ou non.",
      announcedPieces: [{ label: "Un plan de situation du terrain", description: "Obligatoire" }],
      faq: [{ question: "Quelle différence avec un permis ?", answer: "Le certificat informe." }],
    });
  });

  it("⚠️ n'est pas traduit : servi en anglais, il reste le texte français", async () => {
    const result = await getPublicDemarche("t1", "p1", replying({ kind: "ok", body: DETAIL }), "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarche.name).toBe("Planning certificate");
    expect(result.demarche.userCommunication.faq[0].question).toBe("Quelle différence avec un permis ?");
  });

  it("⚠️ `null` = rien d'écrit : des blocs vides, aucun texte composé", async () => {
    const body = { ...DETAIL, user_communication: null };
    const result = await getPublicDemarche("t1", "p1", replying({ kind: "ok", body }), "fr");
    expect(result.ok && result.demarche.userCommunication).toEqual({
      responseDelay: null,
      audienceNote: null,
      announcedPieces: [],
      faq: [],
    });
  });

  // Le Socle ne la sert pas au portail ; si un jour un détail la portait, elle
  // ne deviendrait pas pour autant la FAQ de l'usager.
  it("⚠️ la FAQ de l'AGENT ne traverse jamais, même servie par erreur", async () => {
    const body = {
      ...DETAIL,
      user_communication: null,
      knowledge_base: { faq: [{ question: "Consigne interne ?", answer: "Réservée à l'agent." }] },
    };
    const result = await getPublicDemarche("t1", "p1", replying({ kind: "ok", body }), "fr");
    expect(result.ok && result.demarche.userCommunication.faq).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Consigne interne");
  });
});

/**
 * Ce que le Socle sert : des organismes qui proposent la démarche, avec leur
 * slug depuis le contrat 1.22.0.
 */
const CATALOGUE = [
  {
    id: "p1",
    name: "Acte de mariage",
    organizations: [
      { id: "o-accm", name: "ACCM", slug: "laurentville", logo_url: "https://exemple.fr/accm.png" },
      // Logo servi en clair : écarté comme toute image d'une page publique.
      {
        id: "o-arles",
        name: "Mairie d'Arles",
        slug: "mairie-d-arles",
        logo_url: "http://exemple.fr/arles.png",
      },
      // Organisme auquel personne n'a donné de slug : il n'a pas d'adresse.
      { id: "o-nu", name: "Service sans slug" },
      // Entrée inexploitable : ni identifiant ni nom — écartée, comme avant.
      { id: "o-vide" },
    ],
  },
];

describe("getPublicDemarches — les organismes et leur adresse", () => {
  it("lit le slug de chaque organisme, et traite son absence comme null", async () => {
    const result = await getPublicDemarches("t1", replying({ kind: "ok", body: CATALOGUE }), "fr");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarches[0].organizations).toEqual([
      { id: "o-accm", name: "ACCM", slug: "laurentville", logoUrl: "https://exemple.fr/accm.png" },
      { id: "o-arles", name: "Mairie d'Arles", slug: "mairie-d-arles", logoUrl: null },
      { id: "o-nu", name: "Service sans slug", slug: null, logoUrl: null },
    ]);
  });

  // ⚠️ Un slug qui n'est pas un texte ne devient pas une adresse : il finirait
  // dans un chemin d'URL, et le portail ne construit pas d'adresse avec ce
  // qu'il n'a pas su lire.
  it("écarte un slug qui n'est pas un texte", async () => {
    const body = [{ id: "p1", name: "N", organizations: [{ id: "o", name: "O", slug: 42 }] }];
    const result = await getPublicDemarches("t1", replying({ kind: "ok", body }), "fr");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarches[0].organizations).toEqual([
      { id: "o", name: "O", slug: null, logoUrl: null },
    ]);
  });
});
