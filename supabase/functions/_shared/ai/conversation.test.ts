import { describe, expect, it } from "vitest";
import type { Demarche } from "../domain/demarche.ts";
import {
  detectEmergency,
  parseAssistantAnswer,
  pickCandidates,
  stripLinks,
  windowHistory,
} from "./conversation.ts";
import { classify } from "./socleAi.ts";

const demarche = (id: string, name: string, description: string | null = null): Demarche => ({
  id,
  name,
  description,
  estimatedMinutes: null,
  organizations: [],
  audiences: [],
});

describe("pickCandidates — quelles démarches décrire au modèle", () => {
  const catalogue = [
    demarche("a", "Inscription à la cantine"),
    demarche("b", "Signaler un problème de propreté", "Dépôt sauvage, tag, corbeille pleine."),
    demarche("c", "Demande d'acte de naissance"),
    demarche("d", "Signalement de voirie", "Nid-de-poule, éclairage en panne."),
    demarche("e", "Réserver une salle"),
  ];

  it("décrit un petit catalogue en entier — le tri borne le coût, pas la compréhension", () => {
    expect(pickCandidates(catalogue, "n'importe quoi", 8)).toEqual(catalogue);
  });

  it("classe par mots communs, accents et pluriels compris", () => {
    const picked = pickCandidates(catalogue, "Comment signaler un dépôt sauvage ?", 2);
    expect(picked.map((d) => d.id)).toEqual(["b", "d"]);
  });

  it("garde l'ordre de la collectivité quand rien ne départage", () => {
    expect(pickCandidates(catalogue, "bonjour", 2).map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("windowHistory", () => {
  it("s'ouvre sur un message de l'usager, jamais sur une réponse orpheline", () => {
    const thread = Array.from({ length: 9 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "m" + i,
    }));
    const window = windowHistory(thread, 4);
    expect(window.map((m) => m.content)).toEqual(["m6", "m7", "m8"]);
    expect(window[0].role).toBe("user");
  });
});

describe("detectEmergency — décidé sur les mots de l'usager, pas par le modèle", () => {
  it("reconnaît un danger immédiat, accents ou non", () => {
    for (const said of ["Il y a un incendie chez mon voisin", "ça sent une ODEUR DE GAZ", "je veux me suicider"]) {
      expect(detectEmergency(said)).toBe(true);
    }
  });
  it("ne s'alarme pas d'une demande ordinaire", () => {
    for (const said of ["Comment signaler un dépôt sauvage ?", "Inscrire mon fils à la cantine"]) {
      expect(detectEmergency(said)).toBe(false);
    }
  });
});

describe("parseAssistantAnswer — le guichet garantit que ça parse, pas que ça veut dire quelque chose", () => {
  const ids = new Set(["a", "b"]);

  it("lit une réponse conforme, clôturée ou entourée de texte", () => {
    const expected = { reply: "Voici la démarche.", intent: "suggest", procedureIds: ["b"], fieldUpdates: [] };
    const json = '{"reply":"Voici la démarche.","intent":"suggest","procedure_ids":["b"]}';
    for (const raw of [json, "```json\n" + json + "\n```", "Bien sûr : " + json + " Voilà."]) {
      expect(parseAssistantAnswer(raw, ids)).toEqual(expected);
    }
  });

  it("⚠️ ne retient que des démarches du catalogue publié de CETTE collectivité", () => {
    const raw = JSON.stringify({ reply: "Voici.", intent: "suggest", procedure_ids: ["zzz", "b", "b", 42, "a"] });
    expect(parseAssistantAnswer(raw, ids)?.procedureIds).toEqual(["b", "a"]);
    // Tout est tombé : ce n'est plus une proposition.
    const invented = JSON.stringify({ reply: "Voici.", intent: "suggest", procedure_ids: ["zzz"] });
    expect(parseAssistantAnswer(invented, ids)).toEqual({ reply: "Voici.", intent: "answer", procedureIds: [], fieldUpdates: [] });
  });

  it("borne à trois propositions et ramène une intention inconnue à « answer »", () => {
    const many = new Set(["a", "b", "c", "d"]);
    const raw = JSON.stringify({ reply: "x", intent: "danse", procedure_ids: ["a", "b", "c", "d"] });
    expect(parseAssistantAnswer(raw, many)).toEqual({ reply: "x", intent: "suggest", procedureIds: ["a", "b", "c"], fieldUpdates: [] });
  });

  it("rend null sur l'illisible — jamais un texte brut non vérifié à l'écran", () => {
    for (const raw of ["", "Bonjour !", "[1,2]", '{"intent":"answer"}', '{"reply":"   "}', '{"reply":42}', "{oups"]) {
      expect(parseAssistantAnswer(raw, ids)).toBeNull();
    }
  });

  it("⚠️ retire tout lien : l'assistant ne doit pas pouvoir hameçonner sous la marque d'une collectivité", () => {
    expect(stripLinks("Allez sur [ce site](https://evil.example/x) ou https://evil.example, ou www.evil.example."))
      .toBe("Allez sur ce site ou ou");
    expect(stripLinks("Écrivez à <mailto:a@b.fr> merci")).toBe("Écrivez à merci");
    const raw = JSON.stringify({ reply: "Voir [ici](https://evil.example).", intent: "answer", procedure_ids: [] });
    expect(parseAssistantAnswer(raw, ids)?.reply).toBe("Voir ici.");
  });
});

describe("classify — les réponses du guichet IA", () => {
  it("rend la réponse d'un 200, et « indisponible » si elle est vide", () => {
    expect(classify(200, null, { answer: "{}" })).toEqual({ kind: "ok", answer: "{}" });
    expect(classify(200, null, { answer: "  " })).toEqual({ kind: "unavailable" });
    expect(classify(200, null, null)).toEqual({ kind: "unavailable" });
  });

  it("⚠️ distingue le plafond de la cadence — même statut 429, gestes opposés", () => {
    expect(classify(429, null, { error: { code: "ai_quota_exceeded", message: "Plafond atteint jusqu'au 1er." } }))
      .toEqual({ kind: "quota_exceeded", message: "Plafond atteint jusqu'au 1er." });
    expect(classify(429, "17", { error: { code: "ai_rate_limited" } }))
      .toEqual({ kind: "rate_limited", retryAfterSeconds: 17 });
    // Code inconnu : on n'annonce pas un crédit épuisé sans le savoir.
    expect(classify(429, null, null)).toEqual({ kind: "rate_limited", retryAfterSeconds: 30 });
    expect(classify(429, "9999", {}).kind === "rate_limited" && classify(429, "9999", {})).toMatchObject({
      retryAfterSeconds: 120,
    });
  });

  it("range sous « non configuré » ce qu'un usager ne peut pas corriger", () => {
    for (const status of [400, 401, 403, 404, 503]) {
      expect(classify(status, null, {})).toEqual({ kind: "not_configured" });
    }
    for (const status of [500, 502, 504]) {
      expect(classify(status, null, {})).toEqual({ kind: "unavailable" });
    }
  });
});
