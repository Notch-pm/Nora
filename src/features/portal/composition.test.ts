import { describe, expect, it } from "vitest";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import {
  MAX_SHORTCUTS,
  audiencesOffered,
  emptyDemarchesKey,
  endsWithFooter,
  filterDemarchesByAudience,
  filterDemarchesByOrganization,
  filterDemarchesByQuery,
  footerColumnsClass,
  gridColumnsClass,
  isDarkColor,
  orderDemarchesForSection,
  organizationsOffering,
  resolveShortcuts,
} from "./composition.ts";

const ACCM = { id: "accm", name: "ACCM", slug: null };
const ARLES = { id: "arles", name: "Mairie d'Arles", slug: null };
const CRAU = { id: "crau", name: "Mairie de Saint-Martin", slug: null };

function demarche(
  id: string,
  name: string,
  description: string | null = null,
  organizations: Demarche["organizations"] = [ACCM],
  audiences: Demarche["audiences"] = ["citoyen"],
): Demarche {
  return { id, name, description, estimatedMinutes: null, organizations, audiences };
}

describe("filterDemarchesByOrganization", () => {
  const demarches = [
    demarche("a", "Acte de naissance", null, [ACCM, ARLES]),
    demarche("b", "Voirie", null, [CRAU]),
  ];

  it("ne garde que les démarches que l'organisme propose", () => {
    expect(filterDemarchesByOrganization(demarches, "arles").map((d) => d.id)).toEqual(["a"]);
    expect(filterDemarchesByOrganization(demarches, "crau").map((d) => d.id)).toEqual(["b"]);
  });

  it("aucun organisme choisi : rien n'est filtré", () => {
    expect(filterDemarchesByOrganization(demarches, null)).toBe(demarches);
  });

  it("un organisme qui ne propose rien rend une liste vide, pas une erreur", () => {
    expect(filterDemarchesByOrganization(demarches, "inconnu")).toEqual([]);
  });
});

describe("organizationsOffering", () => {
  it("dédoublonne, place la collectivité visitée en tête, puis les autres par nom", () => {
    const demarches = [
      demarche("a", "Acte de naissance", null, [CRAU, ARLES]),
      demarche("b", "Voirie", null, [ARLES, ACCM]),
    ];
    expect(organizationsOffering(demarches, "accm").map((o) => o.id)).toEqual(["accm", "arles", "crau"]);
  });

  it("classe sans tenir compte de la casse ni des accents", () => {
    const demarches = [
      demarche("a", "A", null, [
        { id: "e", name: "Éguilles", slug: null },
        { id: "b", name: "beaucaire", slug: null },
        { id: "f", name: "Fos", slug: null },
      ]),
    ];
    expect(organizationsOffering(demarches, "accm").map((o) => o.id)).toEqual(["b", "e", "f"]);
  });

  it("un catalogue vide n'offre aucun organisme", () => {
    expect(organizationsOffering([], "accm")).toEqual([]);
  });
});

describe("emptyDemarchesKey", () => {
  it("la recherche prime, puis l'organisme, puis l'absence de publication", () => {
    // Un CODE, pas une phrase : ce module reste pur et ignore la langue du
    // visiteur — c'est l'écran qui rend le texte.
    expect(emptyDemarchesKey(true, "arles")).toBe("empty.search");
    expect(emptyDemarchesKey(false, "arles")).toBe("empty.organization");
    expect(emptyDemarchesKey(false, null)).toBe("empty.none");
  });

  it("nomme le public quand c'est le seul filtre posé", () => {
    expect(emptyDemarchesKey(false, null, "entreprise")).toBe("empty.audience");
  });

  it("n'en nomme AUCUN quand les deux sont posés", () => {
    // Désigner l'organisme alors qu'un public est aussi choisi enverrait
    // l'usager défaire le mauvais filtre.
    expect(emptyDemarchesKey(false, "arles", "entreprise")).toBe("empty.filters");
    // La recherche prime toujours : c'est le geste le plus récent.
    expect(emptyDemarchesKey(true, "arles", "entreprise")).toBe("empty.search");
  });
});

describe("filterDemarchesByAudience", () => {
  const demarches = [
    demarche("a", "Acte de naissance", null, [ACCM], ["citoyen"]),
    demarche("b", "Débit de boisson", null, [ACCM], ["entreprise", "association"]),
    demarche("c", "Jamais paramétrée", null, [ACCM], []),
  ];

  it("ne garde que les démarches ouvertes à ce public", () => {
    expect(filterDemarchesByAudience(demarches, "citoyen").map((d) => d.id)).toEqual(["a"]);
    expect(filterDemarchesByAudience(demarches, "association").map((d) => d.id)).toEqual(["b"]);
  });

  it("aucun public choisi : rien n'est filtré, la démarche sans public comprise", () => {
    expect(filterDemarchesByAudience(demarches, null)).toBe(demarches);
  });

  it("une démarche SANS public déclaré ne passe aucun choix", () => {
    // La collectivité n'a pas dit à qui elle s'adresse. La proposer partout
    // l'offrirait à des usagers auxquels elle n'est pas ouverte ; elle reste
    // visible sans filtre, et c'est là qu'on la voit.
    for (const audience of ["citoyen", "entreprise", "association"] as const) {
      expect(filterDemarchesByAudience(demarches, audience).map((d) => d.id)).not.toContain("c");
    }
  });
});

describe("audiencesOffered", () => {
  it("réunit les publics du catalogue, sans doublon et dans l'ordre du filtre", () => {
    const demarches = [
      demarche("a", "A", null, [ACCM], ["association"]),
      demarche("b", "B", null, [ACCM], ["citoyen", "association"]),
    ];
    expect(audiencesOffered(demarches)).toEqual(["citoyen", "association"]);
  });

  it("n'en rend qu'un quand tout vise le même — le filtre ne s'affichera pas", () => {
    expect(audiencesOffered([demarche("a", "A"), demarche("b", "B")])).toEqual(["citoyen"]);
  });

  it("n'invente aucun public pour un catalogue qui n'en déclare pas", () => {
    expect(audiencesOffered([demarche("a", "A", null, [ACCM], [])])).toEqual([]);
    expect(audiencesOffered([])).toEqual([]);
  });
});

describe("orderDemarchesForSection", () => {
  it("remonte les démarches épinglées en tête quand pinnedFirst est vrai", () => {
    const demarches = [
      demarche("a", "Acte de naissance"),
      demarche("b", "Carte d'identité"),
      demarche("c", "Éclairage public"),
    ];
    const ordered = orderDemarchesForSection(demarches, ["c"], true);
    expect(ordered.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("garde l'ordre publié par le Socle quand pinnedFirst est faux", () => {
    const demarches = [
      demarche("a", "Acte de naissance"),
      demarche("b", "Carte d'identité"),
      demarche("c", "Éclairage public"),
    ];
    // Une démarche épinglée mais pinnedFirst désactivé : l'ordre ne bouge pas.
    const ordered = orderDemarchesForSection(demarches, ["c"], false);
    expect(ordered.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });
});

describe("filterDemarchesByQuery", () => {
  it("ignore la casse", () => {
    const demarches = [demarche("a", "Acte de naissance")];
    expect(filterDemarchesByQuery(demarches, "ACTE").map((d) => d.id)).toEqual(["a"]);
  });

  it("ignore les accents, dans la requête comme dans la démarche", () => {
    const demarches = [demarche("a", "Éclairage public")];
    expect(filterDemarchesByQuery(demarches, "eclairage").map((d) => d.id)).toEqual(["a"]);
  });

  it("cherche aussi dans la description", () => {
    const demarches = [
      demarche("a", "Formulaire", "Demande de raccordement électrique"),
      demarche("b", "Autre démarche", null),
    ];
    expect(filterDemarchesByQuery(demarches, "raccordement").map((d) => d.id)).toEqual(["a"]);
  });

  it("une requête vide ne filtre rien", () => {
    const demarches = [demarche("a", "Acte de naissance"), demarche("b", "Carte d'identité")];
    expect(filterDemarchesByQuery(demarches, "   ")).toEqual(demarches);
  });

  it("écarte ce qui ne correspond pas", () => {
    const demarches = [demarche("a", "Acte de naissance")];
    expect(filterDemarchesByQuery(demarches, "passeport")).toEqual([]);
  });
});

describe("resolveShortcuts", () => {
  it("ignore un raccourci dont l'id est absent du catalogue", () => {
    const demarches = [demarche("a", "Acte de naissance")];
    const shortcuts = resolveShortcuts(["a", "id-disparu"], demarches);
    expect(shortcuts.map((d) => d.id)).toEqual(["a"]);
  });

  it("s'arrête à MAX_SHORTCUTS même si la liste reçue est plus longue", () => {
    const demarches = Array.from({ length: MAX_SHORTCUTS + 2 }, (_, i) =>
      demarche(`id-${i}`, `Démarche ${i}`),
    );
    const shortcuts = resolveShortcuts(
      demarches.map((d) => d.id),
      demarches,
    );
    expect(shortcuts).toHaveLength(MAX_SHORTCUTS);
  });
});

describe("gridColumnsClass", () => {
  it("produit la classe littérale attendue pour 2, 3 et 4 colonnes", () => {
    expect(gridColumnsClass(2)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-2");
    expect(gridColumnsClass(3)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-3");
    expect(gridColumnsClass(4)).toBe("grid-cols-1 sm:grid-cols-2 lg:grid-cols-4");
  });
});

describe("endsWithFooter", () => {
  it("ne regarde que la dernière section", () => {
    expect(endsWithFooter([{ kind: "texte" }, { kind: "footer" }])).toBe(true);
    expect(endsWithFooter([{ kind: "footer" }, { kind: "texte" }])).toBe(false);
    expect(endsWithFooter([])).toBe(false);
  });
});

describe("footerColumnsClass / isDarkColor", () => {
  it("donne une grille responsive pour 1, 2 et 3 colonnes", () => {
    expect(footerColumnsClass(1)).toBe("grid-cols-1");
    expect(footerColumnsClass(2)).toContain("sm:grid-cols-2");
    expect(footerColumnsClass(3)).toContain("lg:grid-cols-3");
  });

  it("choisit du texte clair sur fond sombre, sombre sur fond clair", () => {
    expect(isDarkColor("#0f1f18")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#ffcd57")).toBe(false);
    expect(isDarkColor("n'importe quoi")).toBe(true);
  });
});
