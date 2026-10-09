/**
 * Le RECUEIL d'un formulaire dans la conversation, de bout en bout — avec un
 * guichet simulé. Les règles du recueil lui-même sont dans `collection.test.ts` ;
 * ici, ce que le TOUR en fait : qui a le droit de recueillir, ce que lit le
 * modèle, et ce qu'on retient de ce qu'il rend.
 */
import { describe, expect, it, vi } from "vitest";
import type { Demarche, DemarcheDetail } from "../domain/demarche.ts";
import { parseRequesterConfig } from "../domain/requesterConfig.ts";
import type { Tenant } from "../domain/tenant.ts";
import { defaultTheme } from "../domain/theme.ts";
import { emptyUserCommunication } from "../domain/userCommunication.ts";
import { MAX_TURNS, MAX_TURNS_COLLECT } from "../domain/assistantTurn.ts";
import { issueChallenge, solveChallenge } from "./challenge.ts";
import { issueTicket, readTicket, signReply } from "./signing.ts";
import type { CompletionInput, CompletionResult } from "./socleAi.ts";
import { runAssistantTurn, type TurnDeps } from "./turn.ts";

const SECRET = "secret-de-test";
const NOW = 1_800_000_000;
const NANTES = "11111111-1111-4111-8111-111111111111";
const PROPRETE = "33333333-3333-4333-8333-333333333333";
const SANS_FORMULAIRE = "55555555-5555-4555-8555-555555555555";

const tenant = (depositEnabled: boolean): Tenant => ({
  id: NANTES,
  name: "Ville de Nantes",
  slug: "nantes",
  hostname: "nantes.edilumen.fr",
  languages: ["fr"],
  theme: defaultTheme(),
  assistant: { enabled: true, depositEnabled, voiceEnabled: false },
});

const base = (id: string, name: string): Demarche => ({
  id, name, description: null, estimatedMinutes: 3, organizations: [], audiences: ["citoyen"],
});
const catalogue = [base(PROPRETE, "Signaler un problème de propreté"), base(SANS_FORMULAIRE, "Prendre rendez-vous")];

const detail = (id: string): DemarcheDetail => ({
  ...catalogue.find((d) => d.id === id)!,
  category: null,
  userDescription: null,
  form:
    id === SANS_FORMULAIRE
      ? null
      : {
          version: 1,
          content: [
            { id: "f-lieu", key: "lieu", type: "text", label: "Lieu du dépôt", required: true, help: "Adresse ou repère" },
            {
              id: "f-nature", key: "nature", type: "radio", label: "Nature", required: true,
              options: [{ value: "gravats", label: "Gravats" }, { value: "autre", label: "Autre" }],
            },
            { id: "f-precisions", key: "precisions", type: "textarea", label: "Précisions" },
            { id: "f-photo", key: "photo", type: "attachment", label: "Photo", maxFiles: 2, acceptedFormats: [] },
          ],
        },
  requester: parseRequesterConfig(null),
  userCommunication: emptyUserCommunication(),
});

function setup(modelAnswer: Record<string, unknown>) {
  const complete = vi.fn(async (_input: CompletionInput): Promise<CompletionResult> => ({
    kind: "ok",
    answer: JSON.stringify({ reply: "C'est noté.", intent: "answer", procedure_ids: [], ...modelAnswer }),
  }));
  const deps: TurnDeps = {
    secret: SECRET,
    ai: { complete },
    loadCatalogue: async () => catalogue,
    loadDemarche: vi.fn(async (id: string) => detail(id)),
    nowSeconds: () => NOW,
    newConversationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
  return { deps, complete };
}

const solved = async () => solveChallenge(await issueChallenge(SECRET, NOW, 6));
const body = async (said: string, collection: unknown) => ({
  challenge: await solved(),
  messages: [{ role: "user", content: said }],
  collection,
});
const opening = { demarcheId: PROPRETE, values: {}, skipped: [] };

describe("ce que l'usager a dit AVANT d'ouvrir le recueil compte", () => {
  // Le fil réel du 2026-09-22 : l'usager décrit son problème, l'assistant
  // oriente, le bouton ouvre le recueil — et le dernier message ne dit plus
  // rien du lieu. L'assistant demandait alors la rue, puis le type de problème.
  it("« des dépôts d'ordure rue de la République » deux messages plus tôt → retenu, et « repris » : la citation se vérifie sur TOUT le fil", async () => {
    const { deps, complete } = setup({
      reply: "J'ai noté la rue de la République et un dépôt d'ordures. Qu'avez-vous constaté exactement ?",
      field_updates: [
        { id: "f-lieu", value: "rue de la République", origin: "extracted", source: "rue de la République" },
        { id: "f-nature", value: "Autre", origin: "inferred", reason: "des ordures ne sont pas des gravats" },
      ],
      asking: ["f-precisions"],
    });
    const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const oriented = "Vous pouvez signaler ce dépôt avec la démarche dédiée.";
    const outcome = await runAssistantTurn(
      tenant(true),
      "fr",
      {
        ticket: await issueTicket(SECRET, { conversationId, tenantId: NANTES, issuedAt: NOW, turn: 1, collecting: false }),
        messages: [
          { role: "user", content: "il y a des dépôts d'ordure rue de la République" },
          { role: "assistant", content: oriented, signature: await signReply(SECRET, conversationId, oriented) },
          { role: "user", content: "Je voudrais remplir « Signaler un problème de propreté » avec vous." },
        ],
        collection: opening,
      },
      deps,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reply.collection?.values).toEqual({ "f-lieu": "rue de la République", "f-nature": "autre" });
    // ⚠️ La citation est dans le PREMIER message, pas dans le dernier : « repris » quand même.
    expect(outcome.reply.collection?.origins?.["f-lieu"]).toEqual({ origin: "extracted", source: "rue de la République" });
    // Et la consigne le dit en toutes lettres.
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("PLUS HAUT dans la conversation");
    expect(system).toContain("AVANT d'ouvrir le recueil");
    // Le modèle a bien reçu les trois messages, pas seulement le dernier.
    expect(complete.mock.calls[0][0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
});

describe("le recueil dans la conversation", () => {
  it("« devant le 12 rue de la Paix, des gravats » → les DEUX réponses sont retenues, le choix compris", async () => {
    const { deps, complete } = setup({
      field_updates: [
        { id: "f-lieu", value: "devant le 12 rue de la Paix", origin: "extracted", source: "devant le 12 rue de la Paix" },
        // Le modèle n'ose que « déduit » sur le choix — le serveur le corrigera
        // vers « repris », parce que l'usager a bel et bien dit « gravats ».
        { id: "f-nature", value: "Gravats", origin: "inferred", reason: "vous parlez de gravats" },
      ],
    });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("C'est devant le 12 rue de la Paix, des gravats.", opening), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Le libellé dit par l'usager ressort en VALEUR du schéma publié.
    expect(outcome.reply.collection).toMatchObject({
      demarcheId: PROPRETE,
      values: { "f-lieu": "devant le 12 rue de la Paix", "f-nature": "gravats" },
      skipped: [],
    });
    // ⚠️ L'usager a PRONONCÉ « gravats » : le serveur reclasse en « repris »,
    // contre l'avis du modèle. C'est lui qui tranche, sur les mots réels.
    expect(outcome.reply.collection?.origins).toEqual({
      "f-lieu": { origin: "extracted", source: "devant le 12 rue de la Paix" },
      "f-nature": { origin: "extracted", source: "Gravats" },
    });

    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("MODE RECUEIL");
    expect(system).toContain("field_updates");
    expect(system).toContain("id: f-lieu | Lieu du dépôt (Adresse ou repère) | obligatoire | [écrit]");
    expect(system).toContain("id: f-precisions | Précisions | facultatif | [écrit]");
    // C'est la démarche remplie qui est décrite, et journalisée au Socle.
    expect(complete.mock.calls[0][0].procedureId).toBe(PROPRETE);
  });

  it("⚠️ une option INVENTÉE ne rentre pas, et la question reste posée", async () => {
    const { deps } = setup({ field_updates: [{ id: "f-nature", value: "du plutonium" }] });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("C'est du plutonium.", opening), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({});
  });

  it("les réponses au formulaire sont MONTRÉES au modèle : il accuse réception sans reposer la question", async () => {
    const { deps, complete } = setup({});
    const state = { demarcheId: PROPRETE, values: { "f-lieu": "12 rue de la Paix" }, skipped: [] };
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Et ensuite ?", state), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain(
      "id: f-lieu | Lieu du dépôt (Adresse ou repère) | obligatoire | [écrit] | déjà renseigné : « 12 rue de la Paix »",
    );
    // L'état, lui, revient intact.
    expect(outcome.ok && outcome.reply.collection?.values).toEqual(state.values);
  });

  it("⚠️ l'identité du demandeur n'a AUCUN chemin jusqu'au modèle, même glissée dans l'état", async () => {
    const { deps, complete } = setup({});
    const forged = {
      demarcheId: PROPRETE,
      values: { "f-lieu": "12 rue de la Paix" },
      skipped: [],
      requester: { nom: "SECRET-DE-L-USAGER", courriel: "secret@exemple.fr" },
    };
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Et ensuite ?", forged), deps);
    expect(complete.mock.calls[0][0].system).not.toContain("SECRET-DE-L-USAGER");
    // `sanitizeState` ne connaît que les champs du formulaire : le reste tombe.
    expect(outcome.ok && outcome.reply.collection).toEqual({
      demarcheId: PROPRETE,
      values: { "f-lieu": "12 rue de la Paix" },
      skipped: [],
      origins: {},
      touched: [],
    });
  });

  it("⚠️ une pièce jointe ne transite JAMAIS par le modèle — ni son nom, ni son identifiant de dépôt", async () => {
    const { deps, complete } = setup({});
    const state = {
      demarcheId: PROPRETE,
      values: { "f-photo": [{ uploadId: "upload-SECRET", name: "photo-SECRET.jpg", size: 10 }] },
      skipped: [],
    };
    await runAssistantTurn(tenant(true), "fr", await body("J'ai mis la photo.", state), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).not.toContain("SECRET");
    // Elle est signalée déposée, et rien n'en est dit.
    expect(system).toContain("id: f-photo | Photo | facultatif | [carte] | déjà renseigné");
  });

  it("⚠️ dépôt par la conversation FERMÉ par la collectivité : l'assistant renseigne, il ne recueille rien", async () => {
    const { deps, complete } = setup({ field_updates: [{ id: "f-lieu", value: "12 rue de la Paix" }] });
    const outcome = await runAssistantTurn(tenant(false), "fr", await body("12 rue de la Paix", opening), deps);
    expect(outcome.ok && outcome.reply.collection).toBeNull();
    expect(complete.mock.calls[0][0].system).not.toContain("MODE RECUEIL");
  });

  it("n'ouvre pas de recueil sur une démarche sans formulaire, inconnue, ou mal désignée", async () => {
    for (const collection of [
      { demarcheId: SANS_FORMULAIRE, values: {}, skipped: [] },
      { demarcheId: "99999999-9999-4999-8999-999999999999", values: {}, skipped: [] },
      { demarcheId: "pas-un-uuid", values: {}, skipped: [] },
      "n'importe quoi",
    ]) {
      const { deps, complete } = setup({ field_updates: [{ id: "f-lieu", value: "x" }] });
      const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", collection), deps);
      expect(outcome.ok && outcome.reply.collection).toBeNull();
      expect(complete.mock.calls[0][0].system).not.toContain("MODE RECUEIL");
    }
  });

  it("⚠️ l'état vient du navigateur : il est nettoyé avant de servir", async () => {
    const { deps } = setup({});
    const forged = {
      demarcheId: PROPRETE,
      values: { "f-nature": "valeur-hors-options", "f-invente": "x", "f-lieu": "Ici" },
      skipped: ["f-lieu", "f-precisions"],
    };
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", forged), deps);
    expect(outcome.ok && outcome.reply.collection).toEqual({
      demarcheId: PROPRETE,
      values: { "f-lieu": "Ici" },
      skipped: ["f-precisions"], // `f-lieu` est obligatoire : il ne se passe pas.
      origins: {},
      touched: [],
    });
  });

  it("quand il ne reste rien à recueillir, le modèle le sait", async () => {
    const { deps, complete } = setup({});
    const done = {
      demarcheId: PROPRETE,
      values: { "f-lieu": "Ici", "f-nature": "gravats" },
      skipped: ["f-precisions", "f-photo"],
    };
    await runAssistantTurn(tenant(true), "fr", await body("C'est tout ?", done), deps);
    expect(complete.mock.calls[0][0].system).toContain("INFORMATIONS À RECUEILLIR : plus aucune");
  });

  it("hors recueil, rien ne change : pas de règles de recueil, pas de `field_updates` demandé", async () => {
    const { deps, complete } = setup({});
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", undefined), deps);
    expect(outcome.ok && outcome.reply.collection).toBeNull();
    const system = complete.mock.calls[0][0].system;
    expect(system).not.toContain("MODE RECUEIL");
    expect(system).not.toContain("field_updates");
  });

  it("ce que le modèle dit DEMANDER est refiltré sur ce qui reste vraiment à renseigner", async () => {
    const { deps } = setup({
      // Il demande la photo (légitime), un champ qu'il vient de remplir, et un
      // champ inventé.
      field_updates: [{ id: "f-lieu", value: "12 rue de la Paix" }],
      asking: ["f-photo", "f-lieu", "f-invente"],
    });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("12 rue de la Paix", opening), deps);
    // ⚠️ Filtré APRÈS `applyUpdates` : ce qu'il vient de remplir n'est plus une
    // question, et ce qui n'existe pas n'en a jamais été une.
    expect(outcome.ok && outcome.reply.asking).toEqual(["f-photo"]);
  });

  it("hors recueil, il ne demande rien", async () => {
    const { deps } = setup({ asking: ["f-lieu"] });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", undefined), deps);
    expect(outcome.ok && outcome.reply.asking).toEqual([]);
  });

  it("⚠️ un recueil ouvert relève la borne de tours, et le ticket s'en souvient", async () => {
    // Remplir en parlant coûte des tours : vingt ne suffisent pas, et la
    // conversation ne doit pas se fermer au milieu du remplissage.
    const { deps } = setup({});
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", opening), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reply.turnsLeft).toBe(MAX_TURNS_COLLECT - 1);

    // Le drapeau vit dans le ticket SIGNÉ : c'est lui qui portera la borne
    // haute au tour suivant, sans que le navigateur ait à la réclamer.
    const read = await readTicket(SECRET, outcome.reply.ticket, NANTES, NOW);
    expect(read.ok && read.ticket.collecting).toBe(true);
  });

  it("l'assistant PROPOSE de remplir — une démarche publiée, qui a un formulaire", async () => {
    const { deps } = setup({ offer_procedure_id: PROPRETE });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("J'ai un dépôt sauvage", undefined), deps);
    expect(outcome.ok && outcome.reply.collectOffer).toEqual({
      id: PROPRETE,
      name: "Signaler un problème de propreté",
    });
  });

  it("⚠️ une offre qui mènerait à une impasse est tue", async () => {
    // Une démarche sans formulaire : le bouton n'ouvrirait rien.
    const sansForm = setup({ offer_procedure_id: SANS_FORMULAIRE });
    const a = await runAssistantTurn(tenant(true), "fr", await body("Un rendez-vous", undefined), sansForm.deps);
    expect(a.ok && a.reply.collectOffer).toBeNull();

    // Une démarche hors du catalogue publié : `parseAssistantAnswer` l'a déjà
    // écartée, et rien ne remonte.
    const inventee = setup({ offer_procedure_id: "99999999-9999-4999-8999-999999999999" });
    const b = await runAssistantTurn(tenant(true), "fr", await body("Autre chose", undefined), inventee.deps);
    expect(b.ok && b.reply.collectOffer).toBeNull();

    // Le dépôt par la conversation fermé par la collectivité.
    const ferme = setup({ offer_procedure_id: PROPRETE });
    const c = await runAssistantTurn(tenant(false), "fr", await body("Un dépôt sauvage", undefined), ferme.deps);
    expect(c.ok && c.reply.collectOffer).toBeNull();
  });

  it("⚠️ pendant un recueil, il ne propose plus rien : il est déjà en train de le faire", async () => {
    const { deps, complete } = setup({ offer_procedure_id: PROPRETE });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", opening), deps);
    expect(outcome.ok && outcome.reply.collectOffer).toBeNull();
    expect(complete.mock.calls[0][0].system).not.toContain("PROPOSER DE REMPLIR");
  });

  it("hors recueil, la borne reste celle de l'orientation", async () => {
    const { deps } = setup({});
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", undefined), deps);
    expect(outcome.ok && outcome.reply.turnsLeft).toBe(MAX_TURNS - 1);
    const read = outcome.ok ? await readTicket(SECRET, outcome.reply.ticket, NANTES, NOW) : null;
    expect(read?.ok && read.ticket.collecting).toBe(false);
  });
});

/**
 * Ce qu'on ENVOIE au modèle pendant un recueil — et surtout ce qu'on n'envoie
 * plus. L'usager attend la réponse entière sans affichage progressif (le
 * guichet refuse le flux) : chaque bloc inutile se paie en secondes d'attente.
 */
describe("le prompt d'un recueil, allégé", () => {
  /** La même démarche, mais documentée : c'est ce qui DOIT survivre à l'allègement. */
  const documented = (id: string): DemarcheDetail => ({
    ...detail(id),
    userDescription: "Ce signalement sert à faire enlever un dépôt sauvage sur l'espace public.",
    userCommunication: {
      ...emptyUserCommunication(),
      faq: [{ question: "Pourquoi une photo ?", answer: "Elle aide l'agent à prévoir le bon véhicule." }],
    },
  });

  function setupDocumented(modelAnswer: Record<string, unknown> = {}) {
    const { deps, complete } = setup(modelAnswer);
    return { deps: { ...deps, loadDemarche: async (id: string) => documented(id) }, complete };
  }

  it("⚠️ ni catalogue ni démarches proches : celle qu'on remplit est déjà choisie", async () => {
    const { deps, complete } = setupDocumented();
    await runAssistantTurn(tenant(true), "fr", await body("Et ensuite ?", opening), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).not.toContain("CATALOGUE");
    expect(system).not.toContain("DÉMARCHES LES PLUS PROCHES");
    // Y compris l'autre démarche du catalogue, qui n'a plus rien à faire là.
    expect(system).not.toContain("Prendre rendez-vous");
  });

  it("⚠️ la liste des champs n'est plus rendue DEUX fois", async () => {
    // `focusBlock` la rendait sans identifiants, `collectBlock` avec : deux
    // listes des mêmes champs, dont une inutile, à chaque tour.
    const { deps, complete } = setupDocumented();
    await runAssistantTurn(tenant(true), "fr", await body("Et ensuite ?", opening), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system.split("Lieu du dépôt").length - 1).toBe(1);
    expect(system).not.toContain("informations demandées par le formulaire");
    // Celle qui reste est la bonne : avec les identifiants et les valeurs.
    expect(system).toContain("id: f-lieu | Lieu du dépôt");
  });

  it("⚠️ le descriptif et la FAQ RESTENT — « pourquoi vous me demandez ça ? » doit trouver réponse", async () => {
    // C'est la contrepartie assumée de l'allègement : on coupe ce qui oriente,
    // jamais ce qui renseigne sur la démarche en cours de remplissage.
    const { deps, complete } = setupDocumented();
    await runAssistantTurn(tenant(true), "fr", await body("Pourquoi une photo ?", opening), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("faire enlever un dépôt sauvage");
    expect(system).toContain("Elle aide l'agent à prévoir le bon véhicule.");
  });

  it("HORS recueil, rien de tout cela ne change", async () => {
    // L'orientation a besoin du catalogue entier : l'allègement ne doit pas
    // fuir hors du recueil, où il coûterait la mission principale.
    const { deps, complete } = setupDocumented();
    // Avec la démarche ouverte à l'écran, pour que `focusBlock` soit bien rendu.
    const asked = { ...(await body("J'ai un dépôt sauvage", undefined)), focusDemarcheId: PROPRETE };
    await runAssistantTurn(tenant(true), "fr", asked, deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("CATALOGUE");
    expect(system).toContain("DÉMARCHES LES PLUS PROCHES");
    expect(system).toContain("Prendre rendez-vous");
    expect(system).toContain("informations demandées par le formulaire");
  });
});

/**
 * Le ton du recueil s'est réchauffé le 2026-09-21. Réécrire des règles est le
 * moment exact où une garde se perd par distraction : ces assertions sont là
 * pour que la prochaine retouche du ton ne puisse pas en emporter une.
 */
describe("les interdits du recueil survivent au ton", () => {
  it("garde ses quatre gardes, quoi qu'on fasse de la formulation", async () => {
    const { deps, complete } = setup({});
    await runAssistantTurn(tenant(true), "fr", await body("Bonjour", opening), deps);
    const system = complete.mock.calls[0][0].system;
    // 1. L'identité du demandeur ne se demande pas dans la conversation.
    expect(system).toContain("Ne demande ni nom, ni adresse personnelle, ni téléphone, ni courriel du demandeur");
    // 2. Une date ou une pièce jointe ne se remplit jamais par le modèle.
    expect(system).toContain("Ne remplis JAMAIS une information marquée [carte]");
    // 3. Un champ déjà renseigné ne se réécrit pas de sa propre initiative.
    expect(system).toContain("Ne redemande pas une information « déjà renseigné »");
    // 4. Un facultatif refusé se passe — sans quoi la question revient sans fin.
    expect(system).toContain('{ "id": …, "skip": true }');
  });

  it("⚠️ exige TOUJOURS une question à la fin — la consigne perdue une fois", async () => {
    // Perdue par distraction en réchauffant le ton : « Accuse réception en UNE
    // phrase… PUIS POSE LA QUESTION SUIVANTE » est devenu une consigne de ton
    // qui ne demandait plus rien. Le modèle répondait « Merci, je note votre
    // adresse. » et s'arrêtait là, laissant l'usager devant un silence.
    const { deps, complete } = setup({});
    await runAssistantTurn(tenant(true), "fr", await body("1 rue de la République", opening), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("TERMINE TOUJOURS PAR UNE QUESTION");
    expect(system).toContain("PUIS POSE LA QUESTION SUIVANTE");
  });

  it("⚠️ ne renvoie JAMAIS l'usager à l'écran — deux règles ne doivent pas se contredire", async () => {
    // Une règle disait « l'écran s'en charge », une autre « ne décris jamais
    // l'écran ». Le modèle a suivi la PREMIÈRE : « Si, mais l'écran vous
    // affiche la suite : complétez le code postal… ». Empiler un interdit ne
    // suffit pas — il faut retirer ce qu'il contredit.
    const { deps, complete } = setup({});
    await runAssistantTurn(tenant(true), "fr", await body("Bonjour", opening), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("NE DÉCRIS JAMAIS L'ÉCRAN");
    expect(system).not.toContain("l'écran s'en charge");
  });
});

/**
 * Le ton de l'ORIENTATION vit dans `BASE_RULES`, le jumeau de l'agent de la
 * console Mistral. Ces assertions sont là pour qu'une retouche ici ne parte
 * jamais sans qu'on se souvienne de la recopier — et pour que la chaleur
 * n'emporte pas les gardes qui la bornent.
 */
describe("l'orientation parle à quelqu'un", () => {
  const systemOf = async (collection: unknown) => {
    const { deps, complete } = setup({});
    await runAssistantTurn(tenant(true), "fr", await body("C'est pourri devant chez moi !", collection), deps);
    return complete.mock.calls[0][0].system;
  };

  it("demande de compatir avant d'orienter — hors recueil comme dedans", async () => {
    expect(await systemOf(undefined)).toContain("TU PARLES À QUELQU'UN");
    expect(await systemOf(opening)).toContain("TU PARLES À QUELQU'UN");
  });

  it("⚠️ ne donne AUCUNE formule de compassion à recopier", async () => {
    // L'exemple « c'est désagréable au quotidien, je comprends » était repris
    // mot pour mot à presque chaque signalement (constaté le 2026-10-01).
    const system = await systemOf(undefined);
    expect(system).not.toContain("désagréable au quotidien");
    expect(system).toContain("jamais une formule toute faite");
  });

  it("⚠️ interdit d'INVENTER un délai pour rassurer", async () => {
    // Le risque direct d'un ton chaleureux : « nos agents passent sous
    // quelques jours » fait plus de mal qu'un silence, parce que l'usager
    // attend dessus. Une démarche seulement SUGGÉRÉE n'a d'ailleurs aucun
    // délai dans le prompt — il vit sur le détail, pas sur le catalogue.
    const system = await systemOf(undefined);
    expect(system).toContain("N'en INVENTE jamais un pour rassurer");
    expect(system).toContain("sans le reformuler en promesse");
  });

  it("⚠️ ne se contredit plus sur le dépôt : proposer de remplir l'emporte", async () => {
    // `BASE_RULES` disait « renvoie-le vers la démarche : c'est là qu'il la
    // remplit », l'exact inverse d'`OFFER_RULES`. Le modèle arbitrait seul
    // entre deux consignes, et l'offre passait à la trappe.
    const { deps, complete } = setup({});
    const asked = { ...(await body("J'ai un dépôt sauvage", undefined)), focusDemarcheId: PROPRETE };
    await runAssistantTurn(tenant(true), "fr", asked, deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("SAUF si des règles ci-dessous t'autorisent à recueillir un formulaire");
    expect(system).toContain("Cette règle l'emporte sur la consigne générale");
  });

  it("demande UNE chose à la fois, et interdit de réciter un libellé", async () => {
    const system = await systemOf(opening);
    expect(system).toContain("Demande UNE chose à la fois");
    expect(system).toContain("Ne récite JAMAIS un libellé de la liste tel quel");
  });
});

/**
 * La FIN d'un recueil — là où une conversation réussie se perdait.
 *
 * Constaté en test réel : tout était renseigné, le modèle annonçait « votre
 * signalement est complet, vous pouvez l'envoyer », l'écran affichait « Encore
 * 3 informations à préciser », et il n'y avait aucun bouton d'envoi. Les trois
 * étaient facultatives, et personne — ni l'usager, ni le modèle — n'avait de
 * raison de les évoquer.
 */
describe("la fin d'un recueil ne se bloque plus sur des facultatifs", () => {
  /** Lieu et nature renseignés : tout l'obligatoire est là, restent photo et précisions. */
  const obligatoiresFaits = {
    demarcheId: PROPRETE,
    values: { "f-lieu": "1 rue de Gaulle, Rosny-sous-Bois", "f-nature": "gravats" },
    skipped: [],
  };

  it("⚠️ dit au modèle qu'il ne reste QUE des facultatives — et qu'il doit les PROPOSER", async () => {
    const { deps, complete } = setup({});
    await runAssistantTurn(tenant(true), "fr", await body("Et donc ?", obligatoiresFaits), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("INFORMATIONS À RECUEILLIR : plus aucune OBLIGATOIRE, mais il reste 2 FACULTATIVE(S)");
    expect(system).toContain("| facultatif | [écrit] | À PROPOSER");
    expect(system).toContain("termine ta réponse en proposant la première");
    // Et l'interdiction qui va avec : c'est la ligne qui tranche, pas lui.
    expect(system).toContain("NE DÉCLARE JAMAIS QUE C'EST COMPLET de ta propre autorité");
  });

  it("⚠️ facultatives en attente et réponse SANS question → relancé une fois pour les proposer", async () => {
    // Le défaut du 2026-10-01 : l'adresse validée, « Vos informations »
    // s'affichait et plus rien n'était demandé. Un modèle qui se tait devant
    // des facultatives laisserait l'écran attendre une réponse jamais demandée.
    const { deps, complete } = setup({ reply: "C'est noté." });
    await runAssistantTurn(tenant(true), "fr", await body("Et donc ?", obligatoiresFaits), deps);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1][0].system).toContain("propose la première « À PROPOSER »");
  });

  it("facultatives en attente et réponse qui se finit par une question → un seul appel", async () => {
    const { deps, complete } = setup({ reply: "Voulez-vous ajouter une précision ? C'est facultatif ?" });
    await runAssistantTurn(tenant(true), "fr", await body("Et donc ?", obligatoiresFaits), deps);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("⚠️ formulaire complet : il CONFIRME et annonce « Vos informations », pas le récapitulatif", async () => {
    // Demande du PO (2026-10-01) : le cadre d'identité surgissait sans un mot,
    // et l'annonce parlait d'un récapitulatif qui n'était pas encore là.
    const { deps, complete } = setup({ reply: "Tout est noté." });
    const fini = { ...obligatoiresFaits, skipped: ["f-precisions", "f-photo"] };
    await runAssistantTurn(tenant(true), "fr", await body("Je n'ai rien à ajouter.", fini), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("INFORMATIONS À RECUEILLIR : plus aucune. Le formulaire de la démarche est complet");
    expect(system).toContain("confirme clairement, en une phrase, que tout ce qu'il faut pour la démarche est noté");
    expect(system).toContain("dans le cadre « Vos informations » affiché sous ton message");
    expect(system).not.toContain("le récapitulatif s'affiche sous ton message");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("ne dit rien de tel tant qu'un obligatoire manque", async () => {
    const { deps, complete } = setup({});
    await runAssistantTurn(tenant(true), "fr", await body("Bonjour", opening), deps);
    // ⚠️ Pas `not.toContain("INFORMATIONS À RECUEILLIR")` : la règle elle-même
    // nomme cette ligne pour y renvoyer le modèle. C'est le CONSTAT qui doit
    // être absent, pas son nom.
    const system = complete.mock.calls[0][0].system;
    expect(system).not.toContain("INFORMATIONS À RECUEILLIR : plus aucune");
  });

  it("⚠️ lui interdit de décrire un bouton qu'il ne voit pas", async () => {
    // Constaté aussi : « ou passer directement à l'étape suivante », alors
    // qu'aucun bouton de ce nom n'existe. L'usager cherche ce qu'on lui promet.
    const { deps, complete } = setup({});
    await runAssistantTurn(tenant(true), "fr", await body("Et donc ?", obligatoiresFaits), deps);
    expect(complete.mock.calls[0][0].system).toContain("NE DÉCRIS JAMAIS L'ÉCRAN");
  });

  it("⚠️ ne propose plus la démarche qu'on est EN TRAIN de remplir", async () => {
    // Sa carte se répétait sous chaque réponse, bouton « Remplir cette démarche
    // ici » compris — alors qu'on y était déjà. Le modèle n'a plus le catalogue
    // sous les yeux, mais il lit l'identifiant de la démarche consultée.
    const { deps } = setup({ procedure_ids: [PROPRETE] });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Et donc ?", obligatoiresFaits), deps);
    expect(outcome.ok && outcome.reply.suggestions).toEqual([]);

    // Hors recueil, la suggestion reste évidemment le cœur du métier.
    const horsRecueil = setup({ procedure_ids: [PROPRETE] });
    const b = await runAssistantTurn(tenant(true), "fr", await body("J'ai un dépôt sauvage", undefined), horsRecueil.deps);
    expect(b.ok && b.reply.suggestions).toHaveLength(1);
  });
});
