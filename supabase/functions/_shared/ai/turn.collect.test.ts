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
  it("« c'est devant le 12 rue de la Paix, des gravats » → le texte est repris, le choix est résolu", async () => {
    const { deps, complete } = setup({
      field_updates: [
        { id: "f-lieu", value: "devant le 12 rue de la Paix", origin: "extracted", source: "devant le 12 rue de la Paix" },
        // ⚠️ Le modèle répond par le LIBELLÉ de l'option, jamais par son code.
        { id: "f-nature", value: "Gravats", origin: "inferred", reason: "vous parlez de gravats" },
      ],
    });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("C'est devant le 12 rue de la Paix, des gravats.", opening), deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.reply.collection).toEqual({
      demarcheId: PROPRETE,
      // C'est la VALEUR de l'option qui est écrite, jamais le libellé reçu.
      values: { "f-lieu": "devant le 12 rue de la Paix", "f-nature": "gravats" },
      skipped: [],
      origins: {
        "f-lieu": { origin: "extracted", source: "devant le 12 rue de la Paix" },
        // ⚠️ L'usager a PRONONCÉ « gravats » : le serveur reclasse en « repris »,
        // contre l'avis du modèle. C'est lui qui tranche l'origine, sur les mots réels.
        "f-nature": { origin: "extracted", source: "Gravats" },
      },
      touched: [],
    });

    // Ce que le modèle a lu : les règles du recueil, et des LIBELLÉS — qui se
    // dit, qui se déduit, qui se choisit à la carte.
    const system = complete.mock.calls[0][0].system;
    expect(system).toContain("MODE RECUEIL");
    expect(system).toContain("field_updates");
    expect(system).toContain("id: f-lieu | Lieu du dépôt (Adresse ou repère) | obligatoire | [écrit]");
    expect(system).toContain("id: f-nature | Nature | obligatoire | [liste]");
    expect(system).toContain("options : Gravats ; Autre");
    expect(system).toContain("id: f-precisions | Précisions | facultatif | [écrit]");
    // C'est la démarche remplie qui est décrite, et journalisée au Socle.
    expect(complete.mock.calls[0][0].procedureId).toBe(PROPRETE);
  });

  it("⚠️ une option que le modèle invente n'entre pas — le champ reste à demander", async () => {
    const { deps } = setup({
      field_updates: [{ id: "f-nature", value: "Tag sur un mur", origin: "inferred", reason: "au jugé" }],
    });
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Il y a un tag.", opening), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({});
  });

  it("⚠️ un champ que l'usager a renseigné lui-même n'est pas réécrit, même vidé", async () => {
    const { deps } = setup({
      field_updates: [{ id: "f-lieu", value: "Ailleurs", origin: "extracted", source: "Ailleurs" }],
    });
    const mine = { demarcheId: PROPRETE, values: {}, skipped: [], touched: ["f-lieu"] };
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Ailleurs", mine), deps);
    expect(outcome.ok && outcome.reply.collection?.values).toEqual({});
    expect(outcome.ok && outcome.reply.collection?.touched).toEqual(["f-lieu"]);
  });

  it("⚠️ les réponses déjà données ne sont PAS montrées au modèle — seulement ce qu'il reste à demander", async () => {
    const { deps, complete } = setup({});
    const state = { demarcheId: PROPRETE, values: { "f-lieu": "SECRET-DE-L-USAGER, 12 rue de la Paix" }, skipped: [] };
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Et ensuite ?", state), deps);
    const system = complete.mock.calls[0][0].system;
    expect(system).not.toContain("SECRET-DE-L-USAGER");
    expect(system).not.toContain("id: f-lieu |");
    // L'état, lui, revient intact.
    expect(outcome.ok && outcome.reply.collection?.values).toEqual(state.values);
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
      origins: {
        "f-lieu": { origin: "extracted", source: "Ici" },
        // Sans valeur retenue, une origine n'a plus rien à qualifier.
        "f-nature": { origin: "inferred", reason: "au jugé" },
        "f-invente": { origin: "extracted" },
      },
      touched: ["f-precisions", "f-invente"],
    };
    const outcome = await runAssistantTurn(tenant(true), "fr", await body("Bonjour", forged), deps);
    expect(outcome.ok && outcome.reply.collection).toEqual({
      demarcheId: PROPRETE,
      values: { "f-lieu": "Ici" },
      skipped: ["f-precisions"], // `f-lieu` est obligatoire : il ne se passe pas.
      origins: { "f-lieu": { origin: "extracted", source: "Ici" } },
      touched: ["f-precisions"], // `f-invente` n'est pas un champ de ce formulaire.
    });
  });

  it("quand il ne reste rien à recueillir, le modèle le sait", async () => {
    const { deps, complete } = setup({});
    const done = { demarcheId: PROPRETE, values: { "f-lieu": "Ici", "f-nature": "gravats" }, skipped: ["f-precisions"] };
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
