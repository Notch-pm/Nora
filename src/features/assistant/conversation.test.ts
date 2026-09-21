import { describe, expect, it } from "vitest";
import { MAX_TURNS, MAX_USER_MESSAGE_CHARS } from "@fn/_shared/domain/assistantTurn.ts";
import {
  ASSISTANT_STORAGE_KEY,
  type AssistantMessageView,
  buildTurnRequest,
  type ConversationState,
  type ConversationStorage,
  clearConversation,
  focusDemarcheOf,
  initialConversation,
  loadConversation,
  parseStoredConversation,
  reduceConversation,
  saveConversation,
  toTurnMessages,
  validateMessage,
} from "./conversation.ts";

// ── Un stockage en mémoire, pour tester sans `sessionStorage` (pas de DOM ici). ──

function memoryStorage(initial: Record<string, string> = {}): ConversationStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function throwingStorage(): ConversationStorage {
  return {
    getItem: () => { throw new Error("navigation privée"); },
    setItem: () => { throw new Error("navigation privée"); },
    removeItem: () => { throw new Error("navigation privée"); },
  };
}

const READY: ConversationState = {
  status: "ready",
  ticket: "t1",
  messages: [
    { id: "m1", role: "user", content: "Bonjour" },
    { id: "m2", role: "assistant", content: "Bonjour, que puis-je faire ?", signature: "sig" },
  ],
  turnsLeft: 19,
  failure: null,
  emergency: false,
  reopened: false,
};

describe("validateMessage", () => {
  it("refuse un message vide, espaces compris", () => {
    expect(validateMessage("")).toEqual({ ok: false, problem: "empty" });
    expect(validateMessage("   ")).toEqual({ ok: false, problem: "empty" });
  });

  it("refuse un message trop long", () => {
    const long = "a".repeat(MAX_USER_MESSAGE_CHARS + 1);
    expect(validateMessage(long)).toEqual({ ok: false, problem: "tooLong" });
  });

  it("accepte tout juste la borne, et retire les espaces qui l'entourent", () => {
    const exact = "a".repeat(MAX_USER_MESSAGE_CHARS);
    expect(validateMessage(exact)).toEqual({ ok: true, content: exact });
    expect(validateMessage("  Bonjour  ")).toEqual({ ok: true, content: "Bonjour" });
  });
});

describe("toTurnMessages", () => {
  it("retire ce qui n'appartient qu'à l'écran, et garde la signature", () => {
    const messages: AssistantMessageView[] = [
      { id: "m1", role: "user", content: "Bonjour" },
      {
        id: "m2",
        role: "assistant",
        content: "Bonjour !",
        signature: "sig",
        suggestions: [{ id: "d1", name: "Recensement", description: null }],
      },
    ];
    expect(toTurnMessages(messages)).toEqual([
      { role: "user", content: "Bonjour" },
      { role: "assistant", content: "Bonjour !", signature: "sig" },
    ]);
  });

  it("une réponse sans signature part avec une signature vide, jamais `undefined`", () => {
    const messages: AssistantMessageView[] = [{ id: "m1", role: "assistant", content: "x" }];
    expect(toTurnMessages(messages)).toEqual([{ role: "assistant", content: "x", signature: "" }]);
  });
});

describe("focusDemarcheOf — la démarche dont on parle", () => {
  const user = (id: string): AssistantMessageView => ({ id, role: "user", content: "?" });
  const proposes = (id: string, ...demarches: string[]): AssistantMessageView => ({
    id,
    role: "assistant",
    content: "Voici.",
    signature: "s",
    suggestions: demarches.map((d) => ({ id: d, name: d, description: null })),
  });

  it("sans proposition, c'est la démarche de l'adresse — ou aucune", () => {
    expect(focusDemarcheOf([user("1")], "venue")).toBe("venue");
    expect(focusDemarcheOf([user("1")], null)).toBeNull();
  });

  it("⚠️ après une proposition, on parle de la démarche PROPOSÉE", () => {
    // Essai réel du 2026-09-20 : sans cela, « que dois-je fournir ? » recevait
    // « je ne dispose pas de cette information » juste après la bonne carte.
    expect(focusDemarcheOf([user("1"), proposes("2", "proprete"), user("3")], null)).toBe("proprete");
  });

  it("la dernière proposition l'emporte, y compris sur l'adresse", () => {
    const thread = [user("1"), proposes("2", "a"), user("3"), proposes("4", "b"), user("5")];
    expect(focusDemarcheOf(thread, "venue")).toBe("b");
  });

  it("⚠️ entre plusieurs candidates, aucune n'est décrite : l'assistant attend un choix", () => {
    expect(focusDemarcheOf([user("1"), proposes("2", "a", "b"), user("3")], "venue")).toBeNull();
  });

  it("une réponse sans proposition ne fait pas oublier la précédente", () => {
    const thread = [user("1"), proposes("2", "a"), user("3"), proposes("4"), user("5")];
    expect(focusDemarcheOf(thread, null)).toBe("a");
  });
});

describe("buildTurnRequest", () => {
  const CHALLENGE = { salt: "s", bits: 15, expires: 100, signature: "sig", nonce: "0" };

  it("premier tour : un seul message usager, avec le défi résolu", () => {
    const messages: AssistantMessageView[] = [{ id: "m1", role: "user", content: "Bonjour" }];
    expect(
      buildTurnRequest({ ticket: null, challenge: CHALLENGE, messages, focusDemarcheId: null, lang: "fr" }),
    ).toEqual({
      challenge: CHALLENGE,
      messages: [{ role: "user", content: "Bonjour" }],
      focusDemarcheId: null,
      lang: "fr",
    });
  });

  it("premier tour sans défi résolu : refusé", () => {
    const messages: AssistantMessageView[] = [{ id: "m1", role: "user", content: "Bonjour" }];
    expect(
      buildTurnRequest({ ticket: null, challenge: null, messages, focusDemarcheId: null, lang: "fr" }),
    ).toBeNull();
  });

  it("tour suivant : le ticket, et TOUT le fil, signatures comprises", () => {
    const messages: AssistantMessageView[] = [
      { id: "m1", role: "user", content: "Bonjour" },
      { id: "m2", role: "assistant", content: "Bonjour !", signature: "sig1" },
      { id: "m3", role: "user", content: "Et pour un chien ?" },
    ];
    expect(
      buildTurnRequest({ ticket: "t1", challenge: null, messages, focusDemarcheId: "d1", lang: "en" }),
    ).toEqual({
      ticket: "t1",
      messages: [
        { role: "user", content: "Bonjour" },
        { role: "assistant", content: "Bonjour !", signature: "sig1" },
        { role: "user", content: "Et pour un chien ?" },
      ],
      focusDemarcheId: "d1",
      lang: "en",
    });
  });

  it("refuse un fil qui ne se termine pas par un message usager", () => {
    const messages: AssistantMessageView[] = [{ id: "m1", role: "assistant", content: "x", signature: "s" }];
    expect(
      buildTurnRequest({ ticket: "t1", challenge: null, messages, focusDemarcheId: null, lang: "fr" }),
    ).toBeNull();
    expect(
      buildTurnRequest({ ticket: null, challenge: { ...CHALLENGE }, messages, focusDemarcheId: null, lang: "fr" }),
    ).toBeNull();
  });

  it("porte le recueil en cours (lot 2), premier tour comme tour suivant", () => {
    const collection = { demarcheId: "d1", values: { "f-lieu": "Ici" }, skipped: [] };
    const first: AssistantMessageView[] = [{ id: "m1", role: "user", content: "Bonjour" }];
    expect(
      buildTurnRequest({ ticket: null, challenge: CHALLENGE, messages: first, focusDemarcheId: null, lang: "fr", collection }),
    ).toMatchObject({ collection });

    const next: AssistantMessageView[] = [
      { id: "m1", role: "user", content: "Bonjour" },
      { id: "m2", role: "assistant", content: "Bonjour !", signature: "sig1" },
      { id: "m3", role: "user", content: "Et pour un chien ?" },
    ];
    expect(
      buildTurnRequest({ ticket: "t1", challenge: null, messages: next, focusDemarcheId: null, lang: "fr", collection }),
    ).toMatchObject({ collection });
  });

  it("sans recueil, la requête ne porte aucune clé `collection`", () => {
    const messages: AssistantMessageView[] = [{ id: "m1", role: "user", content: "Bonjour" }];
    const request = buildTurnRequest({ ticket: null, challenge: CHALLENGE, messages, focusDemarcheId: null, lang: "fr" });
    expect(request).not.toHaveProperty("collection");
  });
});

describe("reduceConversation", () => {
  it("« sent » ajoute le message usager et passe en attente", () => {
    const next = reduceConversation(initialConversation(), { type: "sent", content: "Bonjour" });
    expect(next.status).toBe("sending");
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ role: "user", content: "Bonjour" });
    expect(next.emergency).toBe(false);
  });

  it("« sent » détecte un danger immédiat CÔTÉ NAVIGATEUR, sans attendre le serveur", () => {
    const next = reduceConversation(initialConversation(), {
      type: "sent",
      content: "Il y a un incendie chez moi",
    });
    expect(next.emergency).toBe(true);
  });

  it("« received » ajoute la réponse, avance le ticket et le budget de tours", () => {
    const sent = reduceConversation(initialConversation(), { type: "sent", content: "Bonjour" });
    const next = reduceConversation(sent, {
      type: "received",
      reply: {
        ticket: "t1",
        message: { role: "assistant", content: "Bonjour !", signature: "sig" },
        suggestions: [],
        emergency: false,
        turnsLeft: 19,
        collection: null,
        asking: [],
        collectOffer: null,
      },
    });
    expect(next.status).toBe("ready");
    expect(next.ticket).toBe("t1");
    expect(next.turnsLeft).toBe(19);
    expect(next.messages).toHaveLength(2);
    expect(next.messages[1]).toMatchObject({ role: "assistant", content: "Bonjour !", signature: "sig" });
  });

  it("« received » passe la conversation à « ended » quand il n'y a plus de tour", () => {
    const next = reduceConversation(READY, {
      type: "received",
      reply: {
        ticket: "t2",
        message: { role: "assistant", content: "Terminé", signature: "sig" },
        suggestions: [],
        emergency: false,
        turnsLeft: 0,
        collection: null,
        asking: [],
        collectOffer: null,
      },
    });
    expect(next.status).toBe("ended");
  });

  it("« received » ne redescend jamais un danger déjà repéré", () => {
    const dangerous: ConversationState = { ...READY, emergency: true };
    const next = reduceConversation(dangerous, {
      type: "received",
      reply: {
        ticket: "t2",
        message: { role: "assistant", content: "Tout va bien", signature: "sig" },
        suggestions: [],
        emergency: false,
        turnsLeft: 18,
        collection: null,
        asking: [],
        collectOffer: null,
      },
    });
    expect(next.emergency).toBe(true);
  });

  it("« failed » garde le message qui a échoué — rien n'est perdu", () => {
    const sent = reduceConversation(initialConversation(), { type: "sent", content: "Bonjour" });
    const next = reduceConversation(sent, { type: "failed", reason: "assistant_rate_limited", retryAfterSeconds: 12 });
    expect(next.status).toBe("ready");
    expect(next.failure).toEqual({ reason: "assistant_rate_limited", retryAfterSeconds: 12 });
    expect(next.messages).toHaveLength(1);
  });

  it("« failed » avec `conversation_ended` termine la conversation", () => {
    const next = reduceConversation(READY, { type: "failed", reason: "conversation_ended" });
    expect(next.status).toBe("ended");
  });

  it("« retrying » repasse en attente sans toucher au fil", () => {
    const failed = reduceConversation(READY, { type: "failed", reason: "assistant_unavailable" });
    const next = reduceConversation(failed, { type: "retrying" });
    expect(next.status).toBe("sending");
    expect(next.failure).toBeNull();
    expect(next.messages).toEqual(failed.messages);
  });

  it("« reopen » ne garde que le dernier message usager, repart à zéro", () => {
    const withTwoTurns: ConversationState = {
      ...READY,
      messages: [
        ...READY.messages,
        { id: "m3", role: "user", content: "Et pour une association ?" },
      ],
    };
    const next = reduceConversation(withTwoTurns, { type: "reopen" });
    expect(next.status).toBe("sending");
    expect(next.ticket).toBeNull();
    expect(next.turnsLeft).toBe(MAX_TURNS);
    expect(next.reopened).toBe(true);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({ role: "user", content: "Et pour une association ?" });
    // Un nouvel identifiant : ce n'est plus le même message React, même contenu.
    expect(next.messages[0].id).not.toBe("m3");
  });

  it("« reopen » sans aucun message usager vide le fil sans planter", () => {
    const next = reduceConversation(initialConversation(), { type: "reopen" });
    expect(next.messages).toEqual([]);
  });

  it("« reset » efface tout, y compris un danger repéré", () => {
    const dangerous: ConversationState = { ...READY, emergency: true, reopened: true };
    expect(reduceConversation(dangerous, { type: "reset" })).toEqual(initialConversation());
  });

  it("« restored » relit un fil persistant, « ended » si le budget est épuisé", () => {
    const stored = { ticket: "t9", messages: READY.messages, turnsLeft: 0, emergency: true };
    const next = reduceConversation(initialConversation(), { type: "restored", stored });
    expect(next.status).toBe("ended");
    expect(next.ticket).toBe("t9");
    expect(next.emergency).toBe(true);
  });
});

describe("parseStoredConversation", () => {
  it("lit une entrée valide", () => {
    const stored = { ticket: "t1", messages: [{ id: "m1", role: "user", content: "Bonjour" }], turnsLeft: 18, emergency: false };
    expect(parseStoredConversation(JSON.stringify(stored))).toEqual(stored);
  });

  it("rend `null` pour du JSON illisible, ou une forme inattendue", () => {
    expect(parseStoredConversation(null)).toBeNull();
    expect(parseStoredConversation("{ pas du JSON")).toBeNull();
    expect(parseStoredConversation("[]")).toBeNull();
    expect(parseStoredConversation(JSON.stringify({ ticket: "t1" }))).toBeNull();
    expect(parseStoredConversation(JSON.stringify({ ticket: "", messages: [], turnsLeft: 1 }))).toBeNull();
    expect(
      parseStoredConversation(JSON.stringify({ ticket: "t1", messages: [{ role: "user" }], turnsLeft: 1 })),
    ).toBeNull();
  });
});

describe("loadConversation / saveConversation / clearConversation", () => {
  it("range et relit une conversation en cours", () => {
    const storage = memoryStorage();
    saveConversation(storage, READY);
    expect(loadConversation(storage)).toEqual({
      ticket: "t1",
      messages: READY.messages,
      turnsLeft: 19,
      emergency: false,
    });
  });

  it("n'écrit rien tant qu'aucun tour n'a abouti (`ticket` nul)", () => {
    const storage = memoryStorage({ [ASSISTANT_STORAGE_KEY]: "vieille-entree" });
    saveConversation(storage, initialConversation());
    expect(storage.getItem(ASSISTANT_STORAGE_KEY)).toBeNull();
  });

  it("purge une entrée illisible plutôt que de la relire à chaque fois", () => {
    const storage = memoryStorage({ [ASSISTANT_STORAGE_KEY]: "{ pas du JSON" });
    expect(loadConversation(storage)).toBeNull();
    expect(storage.getItem(ASSISTANT_STORAGE_KEY)).toBeNull();
  });

  it("un stockage qui lève (navigation privée) ne fait planter ni la lecture ni l'écriture", () => {
    const storage = throwingStorage();
    expect(loadConversation(storage)).toBeNull();
    expect(() => saveConversation(storage, READY)).not.toThrow();
    expect(() => clearConversation(storage)).not.toThrow();
  });

  it("« Nouvelle conversation » efface l'entrée", () => {
    const storage = memoryStorage();
    saveConversation(storage, READY);
    clearConversation(storage);
    expect(loadConversation(storage)).toBeNull();
  });
});
