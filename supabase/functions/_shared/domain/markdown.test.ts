import { describe, expect, it } from "vitest";
import { markdownSummary, parseInline, parseMarkdown, safeHref } from "./markdown.ts";

describe("parseMarkdown — les citations", () => {
  // Le descriptif du recensement d'ACCM, tel qu'il est publié.
  const RECENSEMENT = [
    "Tout jeune Français doit se faire recenser **dans les trois mois**.",
    "",
    "> Conservez soigneusement l'attestation : la mairie n'en délivre pas de duplicata.",
  ].join("\n");

  it("lit des lignes `>` comme une citation, formatage compris", () => {
    const blocks = parseMarkdown(RECENSEMENT);
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "quote"]);
    expect(blocks[1]).toEqual({
      kind: "quote",
      lines: [[{ kind: "text", text: "Conservez soigneusement l'attestation : la mairie n'en délivre pas de duplicata." }]],
    });
  });

  it("garde ensemble des lignes `>` consécutives, et saute la ligne `>` vide", () => {
    const [quote] = parseMarkdown("> premier\n>\n> second");
    expect(quote).toEqual({
      kind: "quote",
      lines: [[{ kind: "text", text: "premier" }], [{ kind: "text", text: "second" }]],
    });
  });

  it("un `>` au milieu d'une phrase reste du texte", () => {
    expect(parseMarkdown("âge > 16 ans")[0].kind).toBe("paragraph");
  });

  it("une ligne ordinaire après la citation la referme", () => {
    expect(parseMarkdown("> citée\nPlus citée").map((b) => b.kind)).toEqual(["quote", "paragraph"]);
  });
});

describe("markdownSummary — un résumé en texte brut", () => {
  it("prend le premier paragraphe, sans ses marques", () => {
    expect(
      markdownSummary(
        "## Qui est concerné ?\n\nLe **certificat** indique les [règles](https://exemple.fr) applicables.\n\n- a\n- b",
      ),
    ).toBe("Le certificat indique les règles applicables.");
  });

  it("joint les lignes d'un paragraphe d'une espace", () => {
    expect(markdownSummary("Première ligne\nseconde ligne")).toBe("Première ligne seconde ligne");
  });

  it("sans paragraphe, se rabat sur le premier bloc", () => {
    expect(markdownSummary("- **pièce** d'identité\n- livret de famille")).toBe(
      "pièce d'identité · livret de famille",
    );
  });

  it("⚠️ du HTML reste du texte, jamais une balise", () => {
    expect(markdownSummary("<b>gras</b>")).toBe("<b>gras</b>");
  });

  it("rien à résumer, c'est `null`", () => {
    expect(markdownSummary("  \n ")).toBeNull();
  });
});

describe("parseMarkdown — les blocs", () => {
  it("lit titres, paragraphes et listes, dans l'ordre", () => {
    const blocks = parseMarkdown(
      [
        "Laurentville s'engage.",
        "",
        "# État de conformité",
        "",
        "## Non-conformités",
        "- critère 1.1",
        "- critère 3.2",
        "",
        "1. Accueil",
        "2. Formulaire",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "heading", "heading", "list", "list"]);
    expect(blocks[1]).toEqual({
      kind: "heading",
      level: 1,
      children: [{ kind: "text", text: "État de conformité" }],
    });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[4]).toMatchObject({ kind: "list", ordered: true });
  });

  it("garde les sauts de ligne de l'auteur à l'intérieur d'un paragraphe", () => {
    const [paragraph] = parseMarkdown("Défenseur des droits\nLibre réponse 71120\n75342 Paris CEDEX 07");
    expect(paragraph).toMatchObject({ kind: "paragraph" });
    expect(paragraph.kind === "paragraph" && paragraph.lines).toHaveLength(3);
  });

  it("une liste numérotée qui suit une liste à puces en est une autre", () => {
    const blocks = parseMarkdown("- a\n1. b");
    expect(blocks).toHaveLength(2);
  });

  it("au-delà de trois dièses, c'est du texte — comme dans l'aperçu du Socle", () => {
    expect(parseMarkdown("#### Détail")[0].kind).toBe("paragraph");
  });

  it("un texte vide ne produit rien", () => {
    expect(parseMarkdown("\n  \n")).toEqual([]);
  });
});

describe("parseInline — le formatage", () => {
  it("gras, italique, code", () => {
    expect(parseInline("est **partiellement** conforme")).toEqual([
      { kind: "text", text: "est " },
      { kind: "strong", children: [{ kind: "text", text: "partiellement" }] },
      { kind: "text", text: " conforme" },
    ]);
    expect(parseInline("*a* et _b_ et `c`")).toEqual([
      { kind: "em", children: [{ kind: "text", text: "a" }] },
      { kind: "text", text: " et " },
      { kind: "em", children: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " et " },
      { kind: "code", text: "c" },
    ]);
  });

  it("un soulignement au milieu d'un mot n'est pas de l'italique", () => {
    expect(parseInline("fichier nom_de_fichier.pdf")).toEqual([
      { kind: "text", text: "fichier nom_de_fichier.pdf" },
    ]);
  });

  it("un lien garde son libellé formaté", () => {
    expect(parseInline("par le [formulaire **en ligne**](https://formulaire.defenseurdesdroits.fr/)")).toEqual([
      { kind: "text", text: "par le " },
      {
        kind: "link",
        href: "https://formulaire.defenseurdesdroits.fr/",
        children: [
          { kind: "text", text: "formulaire " },
          { kind: "strong", children: [{ kind: "text", text: "en ligne" }] },
        ],
      },
    ]);
  });

  it("⚠️ un lien `javascript:` n'est pas un lien : son libellé reste, en texte", () => {
    expect(parseInline("[cliquez](javascript:void)")).toEqual([
      { kind: "text", text: "cliquez" },
    ]);
  });

  it("⚠️ du HTML reste du TEXTE — aucun nœud ne le rend en balise", () => {
    const nodes = parseInline("<img src=x onerror=alert(1)>");
    expect(nodes).toEqual([{ kind: "text", text: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("safeHref", () => {
  it("n'accepte que https, http, mailto et tel", () => {
    expect(safeHref("https://exemple.fr")).toBe("https://exemple.fr");
    expect(safeHref("mailto:accessibilite@laurentville.fr")).toBe("mailto:accessibilite@laurentville.fr");
    expect(safeHref("tel:+33100000000")).toBe("tel:+33100000000");
    for (const url of ["javascript:alert(1)", "data:text/html,x", "/accessibilite", "//exemple.fr"]) {
      expect(safeHref(url)).toBeNull();
    }
  });
});
