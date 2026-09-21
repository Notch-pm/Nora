/**
 * Un TOUR de conversation avec l'assistant — le contrat entre l'écran et
 * `portal-api` (`POST /v1/assistant`). Écrit une fois ici, lu des deux côtés.
 *
 * ⚠️ **Le serveur n'a pas de mémoire** (Nora n'a pas de base) : c'est le
 * navigateur qui tient le fil et le renvoie à chaque tour. Trois choses rendent
 * cela sûr, et aucune n'est la confiance :
 *
 *  1. le **ticket** — signé par le serveur, il porte l'identifiant de la
 *     conversation, la collectivité, l'heure et le nombre de tours. Il borne ce
 *     qu'une conversation peut coûter, et survit à un rechargement ;
 *  2. la **signature de chaque réponse** — un tour « assistant » que le serveur
 *     n'a pas signé est refusé. Sans elle, fabriquer de fausses réponses serait
 *     la façon la plus simple de faire dire n'importe quoi au modèle sous la
 *     marque d'une collectivité ;
 *  3. la **preuve de travail** — demandée pour OUVRIR une conversation, pas à
 *     chaque tour. Ni tiers, ni cookie : un calcul que le navigateur fait seul.
 *
 * Rien de ce que dit l'usager n'est conservé : ni ici, ni au Socle (guichet
 * passe-plat). Le fil n'existe que dans son onglet.
 */

/** Un message du fil. `signature` n'existe que sur les réponses de l'assistant. */
export interface TurnMessage {
  role: "user" | "assistant";
  content: string;
  signature?: string;
}

/** Le défi rendu par `POST /v1/assistant/defi`, à résoudre avant le premier tour. */
export interface AssistantChallenge {
  salt: string;
  /** Nombre de bits nuls exigés en tête de l'empreinte. */
  bits: number;
  /** Échéance, en secondes Unix. */
  expires: number;
  signature: string;
}

export interface SolvedChallenge extends AssistantChallenge {
  nonce: string;
}

export interface AssistantTurnRequest {
  /** Absent au premier tour : il faut alors `challenge`. */
  ticket?: string;
  challenge?: SolvedChallenge;
  /** Le fil, du plus ancien au plus récent ; le dernier message est de l'usager. */
  messages: TurnMessage[];
  /** La démarche dont on parle, si l'usager en a ouvert une. */
  focusDemarcheId?: string | null;
  /**
   * Le recueil en cours, s'il y en a un : la démarche que l'usager remplit dans
   * la conversation, et ses réponses. Tenu par le navigateur, NON signé — le
   * dépôt refiltre tout (voir `ai/collection.ts`).
   */
  collection?: CollectionPayload | null;
  lang?: string;
}

/** Une démarche que l'assistant propose — de quoi rendre une carte, rien de plus. */
export interface AssistantSuggestion {
  id: string;
  name: string;
  description: string | null;
}

export interface AssistantTurnReply {
  /** Le ticket du tour SUIVANT : celui qui a servi ne ressert pas tel quel. */
  ticket: string;
  message: Required<TurnMessage> & { role: "assistant" };
  suggestions: AssistantSuggestion[];
  /**
   * L'usager décrit un danger immédiat : l'écran affiche les numéros d'urgence.
   * Décidé par le SERVEUR sur les mots de l'usager, pas par le modèle — un
   * renvoi vers le 112 ne dépend pas de l'humeur d'un LLM.
   */
  emergency: boolean;
  turnsLeft: number;
  /**
   * Le recueil après ce tour : les réponses que le serveur a RETENUES de ce que
   * le modèle dit avoir compris. `null` hors recueil — ou si la collectivité
   * n'a pas ouvert le dépôt par la conversation. L'écran en déduit lui-même le
   * prochain champ (`viewOf`, même code des deux côtés).
   */
  collection: CollectionPayload | null;
}

/**
 * L'état d'un recueil, tel qu'il voyage — voir `CollectionState` dans
 * `ai/collection.ts`.
 *
 * ⚠️ `origins` et `touched` sont FACULTATIFS : un onglet ouvert avant le
 * 2026-09-21 n'en porte pas, et il ne doit pas perdre son recueil pour autant.
 * `sanitizeState` lit leur absence comme « rien de connu » — ce qui est
 * exactement la vérité : les badges retombent, les valeurs restent.
 */
export interface CollectionPayload {
  demarcheId: string;
  values: Record<string, unknown>;
  skipped: string[];
  /** L'origine des valeurs posées par l'assistant, par `id` de champ. */
  origins?: Record<string, { origin: string; source?: string; reason?: string }>;
  /** Les champs que l'usager a renseignés lui-même — l'assistant n'y revient pas. */
  touched?: string[];
}

/**
 * Les seules façons dont un tour peut ne pas aboutir. Union fermée, à part de
 * `PortalFailure` : aucune n'empêche le portail de servir — dans tous les cas,
 * l'écran renvoie vers le formulaire classique, qui reste le chemin garanti.
 */
export type AssistantFailure =
  /** La collectivité n'a pas ouvert l'assistant (ou plus). */
  | "assistant_closed"
  /** Secrets absents côté portail, ou guichet sans fournisseur. */
  | "assistant_not_configured"
  /** Guichet ou fournisseur injoignable, réponse illisible. */
  | "assistant_unavailable"
  /** Le crédit IA de la collectivité est épuisé pour la période. */
  | "assistant_quota_exceeded"
  /** Cadence dépassée : réessayer dans quelques secondes. */
  | "assistant_rate_limited"
  /** Pas de ticket valide : il faut (re)passer le défi. */
  | "challenge_required"
  /** La conversation a atteint sa borne de tours ou de durée. */
  | "conversation_ended"
  /** Corps illisible, message trop long, fil falsifié. */
  | "bad_request";

export function httpStatusForAssistantFailure(failure: AssistantFailure): number {
  switch (failure) {
    case "bad_request":
      return 400;
    case "challenge_required":
      return 401;
    case "assistant_closed":
      return 404;
    case "conversation_ended":
      return 409;
    case "assistant_quota_exceeded":
    case "assistant_rate_limited":
      return 429;
    case "assistant_unavailable":
      return 502;
    case "assistant_not_configured":
      return 503;
  }
}

/** Bornes d'un tour — partagées pour que l'écran refuse avant d'envoyer. */
export const MAX_USER_MESSAGE_CHARS = 1000;
export const MAX_TURNS = 20;
