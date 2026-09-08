import { describe, expect, it } from "vitest";
import { getPublishedPage } from "./pageService.ts";
import type { SocleClient, SocleReply } from "./socleClient.ts";

const replying = (reply: SocleReply): SocleClient => ({ get: async () => reply });

const PUBLISHED = {
  slug: "accueil",
  published_at: "2026-09-05T12:21:10Z",
  version: 1,
  sections: [
    { id: "r", kind: "recherche", title: "Trouvez", subtitle: "24 h/24", placeholder: "Ex.", show_shortcuts: true, shortcuts: ["p1"] },
    { id: "g", kind: "demarches", title: "Les plus demandées", columns: 4, pinned_first: true, pinned: ["p1", "p2"] },
    { id: "n", kind: "actus", title: "Actus", layout: "grid", count: 3, show_dates: true },
    { id: "c", kind: "compte", title: "Votre espace", subtitle: "Suivez" },
    { id: "t", kind: "texte", title: "Aide", body: "Un agent…", align: "center" },
    {
      id: "i",
      kind: "texte-image",
      title: "Nos équipements",
      body: "La piscine est ouverte toute l'année.",
      image_url: "https://exemple.fr/piscine.jpg",
      alt: "La piscine municipale",
      layout: "image-first",
    },
    { id: "x", kind: "carrousel", title: "Inconnu" },
  ],
};

describe("getPublishedPage — traduction", () => {
  it("traduit dans le vocabulaire du portail et ne garde que ce qu'il sait rendre", async () => {
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: PUBLISHED }), "fr");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.page) return;
    expect(result.page.publishedAt).toBe("2026-09-05T12:21:10Z");
    // `actus` (rien à afficher) et `carrousel` (inconnu) sont ignorés.
    expect(result.page.sections.map((s) => s.kind)).toEqual([
      "recherche",
      "demarches",
      "compte",
      "texte",
      "texte-image",
    ]);
    expect(result.page.sections[1]).toEqual({
      id: "g",
      kind: "demarches",
      title: "Les plus demandées",
      columns: 4,
      pinnedFirst: true,
      pinned: ["p1", "p2"],
      // Absent du corps servi : pas de filtre. C'est ce que le Socle sert pour
      // les pages composées avant qu'il existe.
      audienceFilter: false,
    });
    expect(result.page.sections[3]).toMatchObject({ kind: "texte", align: "center" });
    expect(result.page.sections[4]).toEqual({
      id: "i",
      kind: "texte-image",
      title: "Nos équipements",
      body: "La piscine est ouverte toute l'année.",
      imageUrl: "https://exemple.fr/piscine.jpg",
      alt: "La piscine municipale",
      layout: "image-first",
    });
  });

  it("porte le filtre « Je suis… » quand la collectivité l'a demandé", async () => {
    const body = {
      ...PUBLISHED,
      sections: [{ ...PUBLISHED.sections[1], audience_filter: true }],
    };
    const result = await getPublishedPage("t1", replying({ kind: "ok", body }), "fr");
    if (!result.ok || !result.page) throw new Error("attendu une page");
    expect(result.page.sections[0]).toMatchObject({ kind: "demarches", audienceFilter: true });
  });

  describe("l'image d'un bloc texte et image", () => {
    const withImage = (image_url: unknown) => ({
      ...PUBLISHED,
      sections: [{ ...PUBLISHED.sections[5], image_url }],
    });

    it("n'entre qu'en https absolue — le reste devient « pas d'image », pas une image cassée", async () => {
      // ⚠️ Plus strict que le Socle, qui accepte `http://` et les chemins
      // absolus : le portail est servi en https (contenu mixte bloqué) et
      // n'héberge aucun média de collectivité (chemin absolu = 404).
      for (const url of [
        "javascript:alert(1)",
        "data:image/svg+xml,<svg/>",
        "http://exemple.fr/a.jpg",
        "/media/a.jpg",
        42,
        null,
      ]) {
        const result = await getPublishedPage(
          "t1",
          replying({ kind: "ok", body: withImage(url) }),
          "fr",
        );
        if (!result.ok || !result.page) throw new Error("attendu une page");
        // Le bloc reste rendu : le texte de la collectivité ne disparaît pas
        // avec son illustration.
        expect(result.page.sections[0], String(url)).toMatchObject({
          kind: "texte-image",
          imageUrl: null,
          body: "La piscine est ouverte toute l'année.",
        });
      }
    });

    it("traduit le texte alternatif comme les autres textes", async () => {
      // Une synthèse vocale lit ce texte-là : le laisser en français ne
      // traduirait la page que pour ceux qui la voient.
      const body = {
        ...PUBLISHED,
        sections: [
          {
            ...PUBLISHED.sections[5],
            translations: { en: { title: "Our facilities", alt: "The municipal pool" } },
          },
        ],
      };
      const result = await getPublishedPage("t1", replying({ kind: "ok", body }), "en");
      if (!result.ok || !result.page) throw new Error("attendu une page");
      expect(result.page.sections[0]).toMatchObject({
        title: "Our facilities",
        alt: "The municipal pool",
        // Le repli reste CHAMP PAR CHAMP : le paragraphe non traduit tient bon.
        body: "La piscine est ouverte toute l'année.",
      });
    });

    it("ramène un ordre inconnu au texte d'abord", async () => {
      const body = {
        ...PUBLISHED,
        sections: [{ ...PUBLISHED.sections[5], layout: "image-au-milieu" }],
      };
      const result = await getPublishedPage("t1", replying({ kind: "ok", body }), "fr");
      if (!result.ok || !result.page) throw new Error("attendu une page");
      expect(result.page.sections[0]).toMatchObject({ layout: "text-first" });
    });
  });

  it("vide les raccourcis quand ils sont masqués — le rendu n'a pas à connaître le commutateur", async () => {
    const body = { ...PUBLISHED, sections: [{ ...PUBLISHED.sections[0], show_shortcuts: false }] };
    const result = await getPublishedPage("t1", replying({ kind: "ok", body }), "fr");
    if (!result.ok || !result.page) throw new Error("attendu une page");
    expect(result.page.sections[0]).toMatchObject({ kind: "recherche", shortcuts: [] });
  });

  it("demande la page d'accueil de la collectivité résolue", async () => {
    const asked: string[] = [];
    const socle: SocleClient = {
      get: async (path) => {
        asked.push(path);
        return { kind: "not_found" };
      },
    };
    await getPublishedPage("8f1e0d3a-0000-4000-8000-000000000001", socle, "fr");
    expect(asked).toEqual(["/v1/portal/page?tenant_id=8f1e0d3a-0000-4000-8000-000000000001&slug=accueil"]);
  });
});

describe("getPublishedPage — absence et pannes", () => {
  it("rend `page: null` sur 404 — jamais publiée n'est pas une erreur", async () => {
    expect(await getPublishedPage("t1", replying({ kind: "not_found" }), "fr")).toEqual({ ok: true, page: null });
  });

  it("distingue la clé refusée d'une panne", async () => {
    expect(await getPublishedPage("t1", replying({ kind: "auth_failed" }), "fr")).toEqual({
      ok: false,
      reason: "socle_misconfigured",
    });
    expect(await getPublishedPage("t1", replying({ kind: "unreachable" }), "fr")).toEqual({
      ok: false,
      reason: "socle_unavailable",
    });
  });

  it("traite une réponse sans date de publication comme illisible", async () => {
    // Un 200 sans `published_at` n'est pas une page publiée : plutôt une
    // indisponibilité qu'une page rendue sans savoir de quand elle date.
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: { sections: [] } }), "fr");
    expect(result).toEqual({ ok: false, reason: "socle_unavailable" });
  });
});

describe("getPublishedPage — pied de page", () => {
  it("traduit le pied de page et ne garde que ses sous-blocs texte", async () => {
    const body = {
      ...PUBLISHED,
      sections: [
        {
          id: "f",
          kind: "footer",
          title: "",
          background: "#1F2937",
          columns: 2,
          children: [
            { id: "c", kind: "texte", title: "Contact", body: "1 place", align: "left" },
            { id: "x", kind: "carrousel" },
          ],
        },
      ],
    };
    const result = await getPublishedPage("t1", replying({ kind: "ok", body }), "fr");
    if (!result.ok || !result.page) throw new Error("attendu une page");
    expect(result.page.sections[0]).toEqual({
      id: "f",
      kind: "footer",
      title: "",
      background: "#1f2937",
      columns: 2,
      children: [{ id: "c", kind: "texte", title: "Contact", body: "1 place", align: "left" }],
    });
  });

  it("ramène une couleur malformée au sombre par défaut", async () => {
    const body = { ...PUBLISHED, sections: [{ id: "f", kind: "footer", background: "url(x)" }] };
    const result = await getPublishedPage("t1", replying({ kind: "ok", body }), "fr");
    if (!result.ok || !result.page) throw new Error("attendu une page");
    expect(result.page.sections[0]).toMatchObject({ background: "#0f1f18", columns: 3, children: [] });
  });
});

/**
 * Les textes de la page dans la langue du visiteur (contrat 1.14.0).
 *
 * ⚠️ Résolus ICI, à la frontière : plus loin, `section.title` est un titre à
 * afficher. C'est ce qui laisse `domain/page.ts` et les écrans inchangés.
 */
describe("getPublishedPage — la langue du visiteur", () => {
  const TRADUITE = {
    slug: "accueil",
    published_at: "2026-09-05T12:21:10Z",
    version: 1,
    sections: [
      {
        id: "t",
        kind: "texte",
        title: "Nos horaires",
        body: "Du lundi au vendredi.",
        align: "left",
        // Le titre est traduit, le paragraphe non : le repli se voit.
        translations: { en: { title: "Opening hours" } },
      },
      {
        id: "f",
        kind: "footer",
        title: "",
        background: "#0f1f18",
        columns: 3,
        children: [
          {
            id: "c",
            kind: "texte",
            title: "Contact",
            body: "1 place de la Mairie",
            align: "left",
            translations: { en: { title: "Contact us" } },
          },
        ],
      },
    ],
  };

  it("sert les textes traduits", async () => {
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: TRADUITE }), "en");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.page) return;
    expect(result.page.sections[0].title).toBe("Opening hours");
  });

  it("replie CHAQUE champ séparément", async () => {
    // Replier la langue entière parce que le paragraphe manque masquerait un
    // titre que la collectivité a bel et bien traduit.
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: TRADUITE }), "en");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.page) return;
    const texte = result.page.sections[0];
    expect(texte.kind).toBe("texte");
    if (texte.kind !== "texte") return;
    expect(texte.body).toBe("Du lundi au vendredi.");
  });

  it("traduit aussi les sous-blocs du pied de page", async () => {
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: TRADUITE }), "en");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.page) return;
    const footer = result.page.sections[1];
    expect(footer.kind).toBe("footer");
    if (footer.kind !== "footer") return;
    expect(footer.children[0].title).toBe("Contact us");
    expect(footer.children[0].body).toBe("1 place de la Mairie");
  });

  it("rend le français quand la langue n'a rien de traduit", async () => {
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: TRADUITE }), "br");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.page) return;
    expect(result.page.sections[0].title).toBe("Nos horaires");
  });

  it("ne se laisse pas abîmer par une page servie sans traductions", async () => {
    // Un Socle d'avant le contrat 1.14.0 : rien ne change, tout est français.
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: PUBLISHED }), "en");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.page) return;
    expect(result.page.sections[0].kind).toBe("recherche");
  });
});
