/**
 * L'état du fil avec l'assistant — réducteur PUR, testé sans réseau ni DOM.
 *
 * ⚠️ CE MODULE NE PARLE NI AU RÉSEAU NI AU STOCKAGE. `useAssistantConversation.ts`
 * (non testé — comme `useDemarche.ts` ou `useAudience.ts`, voir leur en-tête)
 * orchestre les appels et la persistance ; il ne fait qu'appliquer les
 * transitions décrites ici. `AssistantPage.tsx` ne fait qu'afficher.
 *
 * ⚠️ LE SERVEUR N'A PAS DE MÉMOIRE (voir `assistantTurn.ts`, côté fonctions) :
 * c'est CET état, et lui seul, qui porte le fil d'un tour à l'autre. Le
 * perdre — onglet fermé, `sessionStorage` illisible — rouvre simplement une
 * conversation neuve ; rien ne casse, rien n'est rattrapable, et c'est voulu :
 * aucune trace ne doit survivre plus qu'un onglet (le fil n'existe que là).
 */
import { detectEmergency } from "@fn/_shared/ai/conversation.ts";
import {
  MAX_TURNS,
  MAX_USER_MESSAGE_CHARS,
  type AssistantSuggestion,
  type AssistantTurnReply,
  type AssistantTurnRequest,
  type CollectionPayload,
  type SolvedChallenge,
  type TurnMessage,
} from "@fn/_shared/domain/assistantTurn.ts";
import type { AssistantClientFailure } from "@/services/portal/portalClient.ts";

/** Un identifiant local, pour les listes React — jamais envoyé au serveur. */
function newMessageId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Repli pour un navigateur sans `randomUUID` — même motif que `FormulairePage`.
  return "msg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/** Un message du fil, prêt à afficher — le sur-ensemble de `TurnMessage`. */
export interface AssistantMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Présente seulement sur une réponse de l'assistant : à renvoyer TELLE QUELLE au tour suivant. */
  signature?: string;
  /** Démarches proposées avec CETTE réponse — absent sur un message usager, ou quand il n'y en a pas. */
  suggestions?: AssistantSuggestion[];
}

export type ConversationStatus = "idle" | "sending" | "ready" | "ended";

export interface ConversationFailure {
  reason: AssistantClientFailure;
  retryAfterSeconds?: number;
}

export interface ConversationState {
  status: ConversationStatus;
  /** `null` avant le premier tour de cette conversation, ou juste après une réouverture forcée. */
  ticket: string | null;
  messages: AssistantMessageView[];
  /** Le budget de tours restant — plein tant qu'aucun tour n'a abouti. */
  turnsLeft: number;
  failure: ConversationFailure | null;
  /**
   * Un danger immédiat a été repéré — par le navigateur à l'envoi
   * (`detectEmergency`), ou par le serveur dans une réponse (`reply.emergency`).
   *
   * ⚠️ NE REDESCEND JAMAIS À `false` : un usager qui a décrit un danger plus
   * tôt dans le fil doit continuer à voir les numéros d'urgence, même si son
   * message suivant n'en parle plus.
   */
  emergency: boolean;
  /**
   * La conversation vient d'être rouverte de force (ticket périmé ou expiré) :
   * l'écran le dit à l'usager, et cette mention reste affichée pour le reste
   * de la session — pas de minuteur, pas de disparition surprise.
   */
  reopened: boolean;
}

export function initialConversation(): ConversationState {
  return {
    status: "idle",
    ticket: null,
    messages: [],
    turnsLeft: MAX_TURNS,
    failure: null,
    emergency: false,
    reopened: false,
  };
}

/** Ce qu'un stockage tolérant garde d'une conversation — voir `loadConversation`. */
export interface StoredConversation {
  ticket: string;
  messages: AssistantMessageView[];
  turnsLeft: number;
  emergency: boolean;
}

export type ConversationAction =
  /** Un fil relu depuis `sessionStorage` au montage de l'écran. */
  | { type: "restored"; stored: StoredConversation }
  /** L'usager vient d'envoyer `content` — ajouté optimiste, avant la réponse du serveur. */
  | { type: "sent"; content: string }
  /** Le serveur a répondu. */
  | { type: "received"; reply: AssistantTurnReply }
  /** Le tour a échoué — le message envoyé RESTE dans le fil (voir `failed`, ci-dessous). */
  | { type: "failed"; reason: AssistantClientFailure; retryAfterSeconds?: number }
  /** Un nouvel essai du DERNIER échec : l'écran redevient « en attente », sans rien changer d'autre. */
  | { type: "retrying" }
  /** Ticket périmé : conversation neuve, en ne gardant que le dernier message usager. */
  | { type: "reopen" }
  /** « Nouvelle conversation » : tout est remis à zéro. */
  | { type: "reset" };

export function reduceConversation(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  switch (action.type) {
    case "restored":
      return {
        status: action.stored.turnsLeft <= 0 ? "ended" : "ready",
        ticket: action.stored.ticket,
        messages: action.stored.messages,
        turnsLeft: action.stored.turnsLeft,
        failure: null,
        emergency: action.stored.emergency,
        reopened: false,
      };

    case "sent": {
      const message: AssistantMessageView = { id: newMessageId(), role: "user", content: action.content };
      return {
        ...state,
        status: "sending",
        messages: [...state.messages, message],
        failure: null,
        // Décidé ICI, avant même d'attendre le serveur : voir l'invariant sur
        // `emergency` plus haut, et la doctrine de `detectEmergency` (le faux
        // positif est bénin, le faux négatif ne l'est pas).
        emergency: state.emergency || detectEmergency(action.content),
      };
    }

    case "received": {
      const message: AssistantMessageView = {
        id: newMessageId(),
        role: "assistant",
        content: action.reply.message.content,
        signature: action.reply.message.signature,
        suggestions: action.reply.suggestions,
      };
      return {
        ...state,
        status: action.reply.turnsLeft <= 0 ? "ended" : "ready",
        ticket: action.reply.ticket,
        messages: [...state.messages, message],
        turnsLeft: action.reply.turnsLeft,
        failure: null,
        emergency: state.emergency || action.reply.emergency,
      };
    }

    case "failed":
      // ⚠️ Le message qui a échoué RESTE dans `messages` (il y a été ajouté
      // par `sent`, avant l'appel réseau) : c'est ce qui rend un « réessayer »
      // possible sans faire retaper l'usager, et ce qu'exige explicitement
      // `assistant_rate_limited`.
      return {
        ...state,
        status: action.reason === "conversation_ended" ? "ended" : "ready",
        failure: { reason: action.reason, retryAfterSeconds: action.retryAfterSeconds },
      };

    case "retrying":
      return { ...state, status: "sending", failure: null };

    case "reopen": {
      // Le ticket ne vaut plus rien : on ouvre une conversation NEUVE, en ne
      // gardant que le dernier message usager — c'est lui qu'on va rejouer
      // comme premier tour (voir `buildTurnRequest`). Rien d'autre du fil
      // précédent ne survit : le serveur, de toute façon, ne le reconnaîtrait
      // plus (aucune de ses réponses n'est signée pour CETTE conversation).
      const last = [...state.messages].reverse().find((m) => m.role === "user");
      return {
        status: "sending",
        ticket: null,
        messages: last === undefined ? [] : [{ ...last, id: newMessageId() }],
        turnsLeft: MAX_TURNS,
        failure: null,
        emergency: state.emergency,
        reopened: true,
      };
    }

    case "reset":
      return initialConversation();
  }
}

// ── Validation du message ────────────────────────────────────────────────────

export type MessageProblem = "empty" | "tooLong";

/** Le message tel que l'usager va l'envoyer — vide et trop long refusés AVANT le réseau. */
export function validateMessage(
  raw: string,
): { ok: true; content: string } | { ok: false; problem: MessageProblem } {
  const content = raw.trim();
  if (content === "") return { ok: false, problem: "empty" };
  if (content.length > MAX_USER_MESSAGE_CHARS) return { ok: false, problem: "tooLong" };
  return { ok: true, content };
}

// ── Construction de la requête ───────────────────────────────────────────────

/**
 * La démarche DONT ON PARLE — celle dont le serveur décrira le détail au
 * modèle (pièces à prévoir, délai annoncé, informations du formulaire).
 *
 * ⚠️ Trouvé à l'essai réel du 2026-09-20 : l'assistant proposait la bonne
 * démarche, puis répondait « je ne dispose pas de cette information » à « que
 * dois-je fournir ? » — parce que seule l'adresse (`?demarche=`) disait quelle
 * démarche était consultée. Après une proposition, la conversation porte
 * naturellement sur la démarche proposée.
 *
 * La DERNIÈRE réponse qui propose l'emporte sur l'adresse (l'usager venu d'une
 * démarche peut être réorienté vers une autre). ⚠️ Seulement si elle en propose
 * UNE : entre deux ou trois candidates, l'assistant attend un choix, et décrire
 * la première ferait pencher sa réponse. Le serveur revérifie de toute façon que
 * l'identifiant est au catalogue publié.
 */
export function focusDemarcheOf(
  messages: readonly AssistantMessageView[],
  fromAddress: string | null,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const suggestions = messages[i].suggestions;
    if (suggestions === undefined || suggestions.length === 0) continue;
    return suggestions.length === 1 ? suggestions[0].id : null;
  }
  return fromAddress;
}

/** Le fil, débarrassé de ce qui n'appartient qu'à l'écran (`id`, `suggestions`). */
export function toTurnMessages(messages: readonly AssistantMessageView[]): TurnMessage[] {
  return messages.map((m) =>
    m.role === "assistant"
      ? { role: "assistant" as const, content: m.content, signature: m.signature ?? "" }
      : { role: "user" as const, content: m.content },
  );
}

/**
 * Le corps d'un tour — premier ou suivant, selon `ticket`.
 *
 * ⚠️ Le PREMIER tour d'une conversation (`ticket === null`) ne porte qu'UN
 * message usager : le serveur refuse un fil hérité présenté avec un défi tout
 * neuf (`runAssistantTurn`, « un fil déjà rempli … est un fil fabriqué »).
 * `messages` doit donc se terminer par CE message-là, et lui seul part.
 *
 * Rend `null` quand la requête ne peut pas se construire : pas de défi résolu
 * pour un premier tour, ou fil qui ne se termine pas par un message usager
 * (l'appelant a un bogue — mieux vaut refuser que d'envoyer n'importe quoi).
 *
 * `collection` porte le recueil en cours (lot 2), s'il y en a un — voir
 * `collect.ts`. `undefined` : pas de recueil, la clé n'apparaît même pas dans
 * la requête ; `null` : un recueil qui vient de se refermer (l'écran le
 * repasse explicitement à `null` le temps d'un tour, plutôt que de continuer à
 * l'envoyer par erreur).
 */
export function buildTurnRequest(params: {
  ticket: string | null;
  challenge: SolvedChallenge | null;
  messages: readonly AssistantMessageView[];
  focusDemarcheId: string | null;
  lang: string;
  collection?: CollectionPayload | null;
}): AssistantTurnRequest | null {
  const { ticket, challenge, messages, focusDemarcheId, lang, collection } = params;
  const collectionField = collection === undefined ? {} : { collection };
  if (ticket === null) {
    if (challenge === null) return null;
    const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
    if (last === undefined || last.role !== "user") return null;
    return {
      challenge,
      messages: [{ role: "user", content: last.content }],
      focusDemarcheId,
      lang,
      ...collectionField,
    };
  }
  const turnMessages = toTurnMessages(messages);
  const last = turnMessages.length > 0 ? turnMessages[turnMessages.length - 1] : undefined;
  if (last === undefined || last.role !== "user") return null;
  return { ticket, messages: turnMessages, focusDemarcheId, lang, ...collectionField };
}

// ── Persistance sessionStorage ───────────────────────────────────────────────
//
// ⚠️ `sessionStorage`, jamais `localStorage` : c'est ce qui fait « le fil
// n'existe que dans son onglet » (voir l'en-tête d'`assistantTurn.ts`) — un
// onglet fermé oublie tout, comme le serveur.

export const ASSISTANT_STORAGE_KEY = "nora.assistant";

/** Ce qu'un `sessionStorage` doit savoir faire — assez pour être testé sans DOM. */
export interface ConversationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isValidMessage(value: unknown): value is AssistantMessageView {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id === "") return false;
  if (m.role !== "user" && m.role !== "assistant") return false;
  if (typeof m.content !== "string") return false;
  if (m.signature !== undefined && typeof m.signature !== "string") return false;
  return true;
}

/** Lecture tolérante d'une entrée `sessionStorage` — `null` pour tout ce qui ne convainc pas. */
export function parseStoredConversation(raw: string | null): StoredConversation | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.ticket !== "string" || p.ticket === "") return null;
  if (!Array.isArray(p.messages) || !p.messages.every(isValidMessage)) return null;
  if (typeof p.turnsLeft !== "number" || !Number.isFinite(p.turnsLeft)) return null;
  return {
    ticket: p.ticket,
    messages: p.messages as AssistantMessageView[],
    turnsLeft: p.turnsLeft,
    emergency: p.emergency === true,
  };
}

/**
 * Relit la conversation d'un onglet rechargé.
 *
 * ⚠️ TOLÉRANT DE BOUT EN BOUT : un stockage qui lève (navigation privée, quota
 * plein), une entrée illisible — tout retombe sur `null`, jamais une exception
 * qui casserait l'écran. Une entrée illisible est PURGÉE : la laisser traîner
 * la ferait retenter, identiquement, à chaque montage.
 */
export function loadConversation(storage: ConversationStorage): StoredConversation | null {
  let raw: string | null;
  try {
    raw = storage.getItem(ASSISTANT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = parseStoredConversation(raw);
  if (parsed === null) {
    try {
      storage.removeItem(ASSISTANT_STORAGE_KEY);
    } catch {
      // Tant pis : la prochaine lecture retentera la purge, sans autre effet.
    }
  }
  return parsed;
}

/**
 * Range la conversation en cours, ou efface l'entrée tant qu'aucun tour n'a
 * encore abouti (rien à retrouver après un rechargement).
 */
export function saveConversation(storage: ConversationStorage, state: ConversationState): void {
  try {
    if (state.ticket === null) {
      storage.removeItem(ASSISTANT_STORAGE_KEY);
      return;
    }
    const stored: StoredConversation = {
      ticket: state.ticket,
      messages: state.messages,
      turnsLeft: state.turnsLeft,
      emergency: state.emergency,
    };
    storage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Pas de mémoire : la conversation continue quand même dans cet onglet,
    // elle ne survivra simplement pas à un rechargement.
  }
}

/** Efface l'entrée — le geste de « Nouvelle conversation ». */
export function clearConversation(storage: ConversationStorage): void {
  try {
    storage.removeItem(ASSISTANT_STORAGE_KEY);
  } catch {
    // Idem : sans conséquence grave, la conversation est de toute façon vidée
    // en mémoire.
  }
}
