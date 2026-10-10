/**
 * La fin d'un recueil, quand le modèle s'égare — le cas constaté en test sur
 * « Signaler un problème dans l'espace public » : l'usager ne donne que « 44000 »,
 * la ville reste vide, et l'assistant annonce que le signalement est complet.
 *
 * Deux réponses, épinglées ici : la ville se DÉDUIT du code postal (par le
 * référentiel, jamais par le modèle), et un modèle qui ne demande plus rien
 * alors qu'il reste de l'obligatoire est relancé UNE fois.
 */
import { describe, expect, it, vi } from "vitest";
import type { Demarche, DemarcheDetail } from "../domain/demarche.ts";
import { parseRequesterConfig } from "../domain/requesterConfig.ts";
import type { Tenant } from "../domain/tenant.ts";
import { defaultTheme } from "../domain/theme.ts";
import { emptyUserCommunication } from "../domain/userCommunication.ts";
import { issueChallenge, solveChallenge } from "./challenge.ts";
import { lookupCommunes, lookupPostalCodes } from "./communesClient.ts";
import {
  type CommuneEntry,
  matchCommune,
  postalCityPairs,
  postalCodeIn,
  readCityName,
  readCommuneEntries,
  readCommunes,
} from "./postalCity.ts";
import type { CompletionInput, CompletionResult } from "./socleAi.ts";
import { runAssistantTurn, type TurnDeps } from "./turn.ts";

const SECRET = "secret-de-test";
const NOW = 1_800_000_000;
const VILLE = "11111111-1111-4111-8111-111111111111";
const SIGNALEMENT = "0412e421-f5b1-48ff-aedb-24793bb32520";

const tenant: Tenant = {
  id: VILLE,
  name: "Ville de test",
  slug: "test",
  hostname: "test2.edilumen.fr",
  languages: ["fr"],
  theme: defaultTheme(),
  assistant: { enabled: true, depositEnabled: true, voiceEnabled: false },
};

const demarche: Demarche = {
  id: SIGNALEMENT, name: "Signaler un problème dans l'espace public", description: null,
  estimatedMinutes: 3, organizations: [], audiences: ["citoyen"], category: null,
};

// Le bloc d'adresse tel que le Socle le publie — les clés sont celles de test2.
const detail: DemarcheDetail = {
  ...demarche,
  category: null,
  userDescription: null,
  form: {
    version: 1,
    content: [
      {
        id: "s-lieu", kind: "section", title: "Lieu d'intervention",
        fields: [
          { id: "f-voie", key: "intervention_voie", type: "text", label: "Voie", required: true },
          { id: "f-cp", key: "intervention_code_postal", type: "text", label: "Code postal", required: true },
          { id: "f-ville", key: "intervention_ville", type: "text", label: "Ville", required: true },
        ],
      },
      { id: "f-description", key: "description", type: "textarea", label: "Description", required: true },
    ],
  },
  requester: parseRequesterConfig(null),
  userCommunication: emptyUserCommunication(),
};

type Answer = Record<string, unknown>;

/** Un guichet qui rend ses réponses DANS L'ORDRE — la dernière se répète. */
function setup(
  answers: Answer[],
  communes: Record<string, string[] | null> = {},
  postalCodes: Record<string, CommuneEntry[] | null> = {},
) {
  let call = 0;
  const complete = vi.fn(async (_input: CompletionInput): Promise<CompletionResult> => ({
    kind: "ok",
    answer: JSON.stringify({
      reply: "C'est noté.", intent: "answer", procedure_ids: [],
      ...answers[Math.min(call++, answers.length - 1)],
    }),
  }));
  const lookup = vi.fn(async (code: string) => communes[code] ?? null);
  const lookupByName = vi.fn(async (city: string) => postalCodes[city] ?? null);
  const deps: TurnDeps = {
    secret: SECRET,
    ai: { complete },
    loadCatalogue: async () => [demarche],
    loadDemarche: async () => detail,
    nowSeconds: () => NOW,
    newConversationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    lookupCommunes: lookup,
    lookupPostalCodes: lookupByName,
  };
  return { deps, complete, lookup, lookupByName };
}

const body = async (said: string, values: Record<string, unknown>) => ({
  challenge: await solveChallenge(await issueChallenge(SECRET, NOW, 6)),
  messages: [{ role: "user", content: said }],
  collection: { demarcheId: SIGNALEMENT, values, skipped: [] },
});

const cp = { id: "f-cp", value: "44000", origin: "extracted", source: "44000" };

describe("la ville se déduit du code postal", () => {
  it("« 44000 » seul → la ville est renseignée par le SERVEUR, badge « déduit », et le modèle était prévenu", async () => {
    const { deps, complete, lookup } = setup(
      [{ reply: "C'est noté, Nantes. Que constatez-vous ?", field_updates: [cp], asking: ["f-description"] }],
      { "44000": ["Nantes"] },
    );
    const outcome = await runAssistantTurn(tenant, "fr", await body("44000", { "f-voie": "10 rue de la République" }), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reply.collection?.values).toMatchObject({ "f-cp": "44000", "f-ville": "Nantes" });
    expect(outcome.reply.collection?.origins?.["f-ville"]).toEqual({
      origin: "inferred",
      reason: "D'après le code postal 44000.",
    });
    // ⚠️ Seul le code postal est sorti — jamais le message, jamais l'adresse.
    expect(lookup.mock.calls).toEqual([["44000"]]);
    // Le modèle l'a su AVANT de répondre : il ne demande pas la ville.
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("COMMUNES DU CODE POSTAL 44000 (information id: f-ville)");
    expect(system).toContain("Nantes");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("⚠️ plusieurs communes → rien n'est deviné : le modèle reçoit les noms, et demande laquelle", async () => {
    const { deps, complete } = setup(
      [{ field_updates: [cp], asking: ["f-ville"] }],
      { "44000": ["Nantes", "Autreville"] },
    );
    const outcome = await runAssistantTurn(tenant, "fr", await body("44000", {}), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({ "f-cp": "44000" });
    expect(outcome.ok && outcome.reply.asking).toEqual(["f-ville"]);
    expect(complete.mock.calls[0][0].system).toContain("Nantes\nAutreville");
  });

  it("⚠️ le modèle n'a PAS retenu le code postal lu dans le message → la ville ne se remplit pas", async () => {
    // « 10000 mégots » n'est pas un code postal : le modèle ne le retient pas.
    const { deps } = setup([{ asking: ["f-cp"] }], { "10000": ["Troyes"] });
    const outcome = await runAssistantTurn(tenant, "fr", await body("Il y a 10000 mégots", {}), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({});
  });

  it("le code postal était déjà là (saisi dans son contrôle) → la ville suit au tour suivant, avant le modèle", async () => {
    const { deps, complete } = setup([{ asking: ["f-voie"] }], { "93110": ["Rosny-sous-Bois"] });
    const outcome = await runAssistantTurn(tenant, "fr", await body("Et ensuite ?", { "f-cp": "93110" }), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toMatchObject({ "f-ville": "Rosny-sous-Bois" });
    expect(complete.mock.calls[0][0].system).toContain("déjà renseigné : « Rosny-sous-Bois »");
  });

  it("⚠️ une ville que l'usager a VIDÉE lui-même n'est pas re-remplie", async () => {
    const { deps, lookup } = setup([{ asking: ["f-ville"] }], { "44000": ["Nantes"] });
    const request = await body("Non, pas Nantes", { "f-cp": "44000" });
    const outcome = await runAssistantTurn(
      tenant, "fr", { ...request, collection: { ...request.collection, touched: ["f-ville"] } }, deps,
    );
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({ "f-cp": "44000" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("référentiel muet → rien ne casse : la ville se demande, comme avant", async () => {
    const { deps } = setup([{ field_updates: [cp], asking: ["f-ville"] }], {});
    const outcome = await runAssistantTurn(tenant, "fr", await body("44000", {}), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({ "f-cp": "44000" });
  });
});

describe("le code postal se déduit de la ville", () => {
  // Ce que le référentiel rend à « Rosny sous bois » : la bonne, puis une voisine de nom.
  const rosny: CommuneEntry[] = [
    { nom: "Rosny-sous-Bois", codesPostaux: ["93110"] },
    { nom: "Rosny-sur-Seine", codesPostaux: ["78710"] },
  ];
  const voie = { id: "f-voie", value: "1 rue de la République", origin: "extracted", source: "1 rue de la République" };
  const ville = { id: "f-ville", value: "Rosny sous bois", origin: "extracted", source: "Rosny sous bois" };

  it("« au 1 rue de la République à Rosny sous bois » → le code postal est renseigné par le SERVEUR, dans le même tour", async () => {
    const { deps, complete, lookupByName } = setup(
      [{ reply: "C'est noté. Que constatez-vous ?", field_updates: [voie, ville], asking: ["f-description"] }],
      {},
      { "Rosny sous bois": rosny },
    );
    const outcome = await runAssistantTurn(tenant, "fr", await body("au 1 rue de la République à Rosny sous bois", {}), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reply.collection?.values).toMatchObject({ "f-ville": "Rosny sous bois", "f-cp": "93110" });
    expect(outcome.reply.collection?.origins?.["f-cp"]).toEqual({
      origin: "inferred",
      reason: "D'après la commune Rosny-sous-Bois.",
    });
    // ⚠️ Seul le nom de la commune est sorti — jamais la rue, jamais le message.
    expect(lookupByName.mock.calls).toEqual([["Rosny sous bois"]]);
    // Le modèle demandait la description, qui reste à obtenir : un seul appel.
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("la ville était déjà là → le code postal suit AVANT le modèle, qui le lit « déjà renseigné »", async () => {
    const { deps, complete } = setup([{ asking: ["f-description"] }], {}, { "Rosny-sous-Bois": rosny });
    const outcome = await runAssistantTurn(tenant, "fr", await body("Et ensuite ?", { "f-ville": "Rosny-sous-Bois" }), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toMatchObject({ "f-cp": "93110" });
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("déjà renseigné : « 93110 »");
    // Un seul code : pas de bloc à trancher (la consigne, elle, nomme toujours le bloc).
    expect(system).not.toContain("CODES POSTAUX DE LA COMMUNE Rosny-sous-Bois (information id:");
  });

  it("⚠️ plusieurs codes postaux → rien n'est deviné : le modèle reçoit les codes, et demande lequel", async () => {
    const nantes: CommuneEntry[] = [{ nom: "Nantes", codesPostaux: ["44000", "44100", "44200", "44300"] }];
    const { deps, complete } = setup([{ asking: ["f-cp"] }], {}, { Nantes: nantes });
    const outcome = await runAssistantTurn(tenant, "fr", await body("Et ensuite ?", { "f-ville": "Nantes" }), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({ "f-ville": "Nantes" });
    expect(outcome.ok && outcome.reply.asking).toEqual(["f-cp"]);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("CODES POSTAUX DE LA COMMUNE Nantes (information id: f-cp)");
    expect(system).toContain("44000\n44100\n44200\n44300");
  });

  it("⚠️ « Rosny » seul, ou deux homonymes → rien : le nom doit être exact, et unique", async () => {
    const { deps } = setup([{ asking: ["f-cp"] }], {}, {
      Rosny: rosny,
      "Saint-Denis": [
        { nom: "Saint-Denis", codesPostaux: ["93200"] },
        { nom: "Saint-Denis", codesPostaux: ["97400"] },
      ],
    });
    const short = await runAssistantTurn(tenant, "fr", await body("Et ensuite ?", { "f-ville": "Rosny" }), deps);
    expect(short.ok && short.reply.collection?.values).toEqual({ "f-ville": "Rosny" });
    const twins = await runAssistantTurn(tenant, "fr", await body("Et ensuite ?", { "f-ville": "Saint-Denis" }), deps);
    expect(twins.ok && twins.reply.collection?.values).toEqual({ "f-ville": "Saint-Denis" });
  });

  it("⚠️ une « ville » qui contient un chiffre ne sort JAMAIS : c'est peut-être une adresse", async () => {
    const { deps, lookupByName } = setup([{ asking: ["f-cp"] }]);
    await runAssistantTurn(tenant, "fr", await body("Et ensuite ?", { "f-ville": "12 rue X, Rosny" }), deps);
    expect(lookupByName).not.toHaveBeenCalled();
  });

  it("un code postal que l'usager a VIDÉ lui-même n'est pas re-rempli", async () => {
    const { deps, lookupByName } = setup([{ asking: ["f-cp"] }], {}, { "Rosny-sous-Bois": rosny });
    const request = await body("Non", { "f-ville": "Rosny-sous-Bois" });
    const outcome = await runAssistantTurn(
      tenant, "fr", { ...request, collection: { ...request.collection, touched: ["f-cp"] } }, deps,
    );
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({ "f-ville": "Rosny-sous-Bois" });
    expect(lookupByName).not.toHaveBeenCalled();
  });

  it("la consigne interdit au modèle de demander, ou d'inventer, un code postal quand la ville est dite", async () => {
    const { deps, complete } = setup([{ asking: ["f-voie"] }]);
    await runAssistantTurn(tenant, "fr", await body("Bonjour", {}), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("NE DEMANDE PAS le code postal");
    expect(system).toContain("N'écris JAMAIS de toi-même un code postal");
  });
});

describe("le filet : un modèle qui ne demande plus rien alors qu'il reste de l'obligatoire", () => {
  const filled = { "f-voie": "10 rue de la République", "f-cp": "44000", "f-description": "10 m3 de déchets" };

  it("« Votre signalement est complet » avec la ville manquante → relancé UNE fois, et c'est la seconde réponse qui part", async () => {
    const { deps, complete } = setup([
      { reply: "Merci. Votre signalement est complet.", asking: [] },
      { reply: "Merci. Il me manque la ville : dans quelle commune ?", asking: ["f-ville"] },
    ]);
    const outcome = await runAssistantTurn(tenant, "fr", await body("Non", filled), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reply.message.content).toBe("Merci. Il me manque la ville : dans quelle commune ?");
    expect(outcome.reply.asking).toEqual(["f-ville"]);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].system).toContain("⚠️ CORRECTION");
    // L'usager n'a parlé qu'une fois : un seul tour est compté.
    expect(outcome.reply.turnsLeft).toBe((await firstTurnsLeft()));
  });

  it("⚠️ le prompt NOMME l'état : ce qui bloque est marqué, et la ligne dit que ce n'est pas complet", async () => {
    const { deps, complete } = setup([{ asking: ["f-ville"] }]);
    await runAssistantTurn(tenant, "fr", await body("Non", filled), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("id: f-ville | Ville | obligatoire | [écrit] | ⚠️ À OBTENIR");
    expect(system).toContain("INFORMATIONS À RECUEILLIR : il en reste 1 OBLIGATOIRE(S)");
    expect(system).not.toContain("plus aucune");
  });

  it("ce que la PREMIÈRE réponse a fait retenir reste retenu, même relancée", async () => {
    const { deps } = setup([
      { reply: "C'est complet.", field_updates: [{ id: "f-description", value: "des gravats", origin: "extracted", source: "des gravats" }], asking: [] },
      { reply: "Dans quelle commune ?", asking: ["f-ville"] },
    ]);
    const outcome = await runAssistantTurn(tenant, "fr", await body("des gravats", { "f-voie": "10 rue X", "f-cp": "44000" }), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toMatchObject({ "f-description": "des gravats" });
    expect(outcome.ok && outcome.reply.message.content).toBe("Dans quelle commune ?");
  });

  it("⚠️ second essai aussi égaré, ou guichet en panne → la première réponse part, sans erreur", async () => {
    const { deps, complete } = setup([{ reply: "C'est complet.", asking: [] }]);
    const outcome = await runAssistantTurn(tenant, "fr", await body("Non", filled), deps);
    expect(outcome.ok && outcome.reply.message.content).toBe("C'est complet.");
    expect(complete).toHaveBeenCalledTimes(2);

    const broken = setup([{ reply: "C'est complet.", asking: [] }]);
    let calls = 0;
    broken.deps.ai.complete = async (input) =>
      ++calls === 1 ? broken.complete(input) : { kind: "unavailable" };
    const second = await runAssistantTurn(tenant, "fr", await body("Non", filled), broken.deps);
    expect(second.ok && second.reply.message.content).toBe("C'est complet.");
  });

  it("une question est posée → aucun second appel, même s'il reste de l'obligatoire", async () => {
    const { deps, complete } = setup([{ asking: ["f-ville"] }]);
    await runAssistantTurn(tenant, "fr", await body("Non", filled), deps);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  // L'AUTRE égarement : une question posée au moment où le recueil se ferme.
  const last = { id: "f-ville", value: "Nantes", origin: "extracted", source: "Nantes" };

  it("⚠️ « Depuis quand ? » au tour qui COMPLÈTE la demande → relancé, et la réponse qui part ne demande plus rien", async () => {
    const { deps, complete } = setup([
      { reply: "C'est noté : Nantes. Depuis quand les avez-vous remarqués ?", field_updates: [last], asking: [] },
      { reply: "C'est noté. Le récapitulatif s'affiche sous mon message.", asking: [] },
    ]);
    const outcome = await runAssistantTurn(tenant, "fr", await body("Nantes", filled), deps);
    expect(outcome.ok && outcome.reply.message.content).toBe("C'est noté. Le récapitulatif s'affiche sous mon message.");
    expect(outcome.ok && outcome.reply.collection?.values).toMatchObject({ "f-ville": "Nantes" });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].system).toContain("SANS AUCUNE QUESTION");
  });

  it("le recueil se ferme sans question → aucun second appel", async () => {
    const { deps, complete } = setup([{ reply: "Le récapitulatif s'affiche sous mon message.", field_updates: [last], asking: [] }]);
    await runAssistantTurn(tenant, "fr", await body("Nantes", filled), deps);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("la demande était DÉJÀ complète : l'usager discute sous son récapitulatif, une question n'y gêne personne", async () => {
    const { deps, complete } = setup([{ reply: "Le délai n'est pas indiqué. Autre chose ?", asking: [] }]);
    await runAssistantTurn(tenant, "fr", await body("C'est long ?", { ...filled, "f-ville": "Nantes" }), deps);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  /** Ce qu'il reste de tours après UN tour de recueil sans relance — la référence. */
  async function firstTurnsLeft(): Promise<number> {
    const { deps } = setup([{ asking: ["f-ville"] }]);
    const outcome = await runAssistantTurn(tenant, "fr", await body("Non", filled), deps);
    return outcome.ok ? outcome.reply.turnsLeft : -1;
  }
});

describe("reconnaître le code postal et sa ville", () => {
  it("les champs s'apparient par le PRÉFIXE de leur clé — deux adresses ne se croisent pas", () => {
    const pairs = postalCityPairs({
      version: 1,
      content: [
        { id: "a", key: "intervention_code_postal", type: "text", label: "CP" },
        { id: "b", key: "domicile_ville", type: "text", label: "Ville" },
        { id: "c", key: "intervention_ville", type: "text", label: "Ville" },
        { id: "d", key: "recap", type: "text", label: "Récap" },
      ],
    });
    expect(pairs.map(({ postal, city }) => [postal.id, city.id])).toEqual([["a", "c"]]);
  });

  it("un seul nombre à cinq chiffres, sinon rien", () => {
    expect(postalCodeIn("c'est au 44000")).toBe("44000");
    expect(postalCodeIn("44000 ou 44100")).toBeNull();
    expect(postalCodeIn("le 0612345678")).toBeNull();
    expect(postalCodeIn("rue de la Paix")).toBeNull();
  });

  it("la réponse du référentiel est ramenée à des noms, ou à rien", () => {
    expect(readCommunes([{ nom: "Nantes", code: "44109" }, { nom: " Nantes " }, { code: "x" }])).toEqual(["Nantes"]);
    expect(readCommunes({ erreur: true })).toBeNull();
  });

  it("⚠️ le client n'envoie QUE cinq chiffres, et une panne rend null", async () => {
    const fetched: string[] = [];
    const ok = (async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify([{ nom: "Nantes" }]), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await lookupCommunes("44000", ok)).toEqual(["Nantes"]);
    expect(await lookupCommunes("44000&x=1", ok)).toBeNull();
    expect(fetched).toEqual(["https://geo.api.gouv.fr/communes?codePostal=44000&fields=nom&format=json"]);
    const down = (async () => { throw new Error("réseau"); }) as unknown as typeof fetch;
    expect(await lookupCommunes("44000", down)).toBeNull();
  });

  it("le nom d'une commune se reconnaît malgré la graphie — jamais par un bout de nom", () => {
    const entries = readCommuneEntries([
      { nom: "Rosny-sous-Bois", codesPostaux: ["93110"] },
      { nom: "Saint-Martin-de-Crau", codesPostaux: ["13310", "1331", "13310"] },
      { nom: "Sans code", codesPostaux: [] },
      { nom: "x" },
    ]);
    expect(entries).toEqual([
      { nom: "Rosny-sous-Bois", codesPostaux: ["93110"] },
      { nom: "Saint-Martin-de-Crau", codesPostaux: ["13310"] },
    ]);
    expect(matchCommune(entries!, "ROSNY SOUS BOIS")?.nom).toBe("Rosny-sous-Bois");
    expect(matchCommune(entries!, "St Martin de Crau")?.nom).toBe("Saint-Martin-de-Crau");
    expect(matchCommune(entries!, "Rosny")).toBeNull();
    expect(readCommuneEntries({ erreur: true })).toBeNull();
  });

  it("⚠️ le nom envoyé au référentiel ne contient jamais de chiffre", () => {
    expect(readCityName("  Rosny   sous bois ")).toBe("Rosny sous bois");
    expect(readCityName("L'Haÿ-les-Roses")).toBe("L'Haÿ-les-Roses");
    expect(readCityName("12 rue de la Paix, Rosny")).toBeNull();
    expect(readCityName("")).toBeNull();
    expect(readCityName(42)).toBeNull();
  });

  it("⚠️ le client par nom n'envoie que le nom, encodé, et une panne rend null", async () => {
    const fetched: string[] = [];
    const ok = (async (url: string) => {
      fetched.push(url);
      return new Response(JSON.stringify([{ nom: "Rosny-sous-Bois", codesPostaux: ["93110"] }]), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await lookupPostalCodes("Rosny sous bois", ok)).toEqual([{ nom: "Rosny-sous-Bois", codesPostaux: ["93110"] }]);
    expect(await lookupPostalCodes("12 rue X", ok)).toBeNull();
    expect(fetched).toEqual([
      "https://geo.api.gouv.fr/communes?nom=Rosny%20sous%20bois&fields=nom,codesPostaux&format=json&boost=population&limit=10",
    ]);
    const down = (async () => { throw new Error("réseau"); }) as unknown as typeof fetch;
    expect(await lookupPostalCodes("Nantes", down)).toBeNull();
  });
});
