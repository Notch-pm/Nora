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
import { issueChallenge, solveChallenge } from "./challenge.ts";
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
  assistant: { enabled: true, depositEnabled },
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

describe("le recueil dans la conversation", () => {
  it("« devant le 12 rue de la Paix, des gravats » → les DEUX réponses sont retenues, le choix compris", async () => {
    const { deps, complete } = setup({
      field_updates: [
        { id: "f-lieu", value: "devant le 12 rue de la Paix" },
        { id: "f-nature", value: "Gravats" },
      ],
    });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("C'est devant le 12 rue de la Paix, des gravats.", opening), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // Le libellé dit par l'usager ressort en VALEUR du schéma publié.
    expect(outcome.reply.collection).toEqual({
      demarcheId: PROPRETE,
      values: { "f-lieu": "devant le 12 rue de la Paix", "f-nature": "gravats" },
      skipped: [],
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
});
