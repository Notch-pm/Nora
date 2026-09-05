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
    { id: "x", kind: "carrousel", title: "Inconnu" },
  ],
};

describe("getPublishedPage — traduction", () => {
  it("traduit dans le vocabulaire du portail et ne garde que ce qu'il sait rendre", async () => {
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: PUBLISHED }));
    expect(result.ok).toBe(true);
    if (!result.ok || !result.page) return;
    expect(result.page.publishedAt).toBe("2026-09-05T12:21:10Z");
    // `actus` (rien à afficher) et `carrousel` (inconnu) sont ignorés.
    expect(result.page.sections.map((s) => s.kind)).toEqual(["recherche", "demarches", "compte", "texte"]);
    expect(result.page.sections[1]).toEqual({
      id: "g",
      kind: "demarches",
      title: "Les plus demandées",
      columns: 4,
      pinnedFirst: true,
      pinned: ["p1", "p2"],
    });
    expect(result.page.sections[3]).toMatchObject({ kind: "texte", align: "center" });
  });

  it("vide les raccourcis quand ils sont masqués — le rendu n'a pas à connaître le commutateur", async () => {
    const body = { ...PUBLISHED, sections: [{ ...PUBLISHED.sections[0], show_shortcuts: false }] };
    const result = await getPublishedPage("t1", replying({ kind: "ok", body }));
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
    await getPublishedPage("8f1e0d3a-0000-4000-8000-000000000001", socle);
    expect(asked).toEqual(["/v1/portal/page?tenant_id=8f1e0d3a-0000-4000-8000-000000000001&slug=accueil"]);
  });
});

describe("getPublishedPage — absence et pannes", () => {
  it("rend `page: null` sur 404 — jamais publiée n'est pas une erreur", async () => {
    expect(await getPublishedPage("t1", replying({ kind: "not_found" }))).toEqual({ ok: true, page: null });
  });

  it("distingue la clé refusée d'une panne", async () => {
    expect(await getPublishedPage("t1", replying({ kind: "auth_failed" }))).toEqual({
      ok: false,
      reason: "socle_misconfigured",
    });
    expect(await getPublishedPage("t1", replying({ kind: "unreachable" }))).toEqual({
      ok: false,
      reason: "socle_unavailable",
    });
  });

  it("traite une réponse sans date de publication comme illisible", async () => {
    // Un 200 sans `published_at` n'est pas une page publiée : plutôt une
    // indisponibilité qu'une page rendue sans savoir de quand elle date.
    const result = await getPublishedPage("t1", replying({ kind: "ok", body: { sections: [] } }));
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
    const result = await getPublishedPage("t1", replying({ kind: "ok", body }));
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
    const result = await getPublishedPage("t1", replying({ kind: "ok", body }));
    if (!result.ok || !result.page) throw new Error("attendu une page");
    expect(result.page.sections[0]).toMatchObject({ background: "#0f1f18", columns: 3, children: [] });
  });
});
