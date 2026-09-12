import { describe, expect, it } from "vitest";
import { getPublicDemarches } from "./demarcheService.ts";
import type { SocleClient, SocleReply } from "./socleClient.ts";

const replying = (reply: SocleReply): SocleClient => ({ get: async () => reply });

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
