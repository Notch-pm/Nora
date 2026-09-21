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
  /**
   * Les champs sur lesquels porte la question que l'assistant vient de poser —
   * revalidés par le serveur contre ce qui reste réellement à renseigner.
   *
   * C'est ce qui permet à l'écran d'afficher le bon contrôle quand la réponse
   * ne peut pas se dire (un calendrier, un dépôt de fichier) : depuis que le
   * modèle mène la conversation, le premier champ en attente n'est plus
   * forcément celui dont il parle.
   */
  asking: string[];
  /**
   * La démarche que l'assistant propose de remplir dans la conversation —
   * `null` le plus souvent. L'écran en fait un bouton sous sa bulle.
   *
   * ⚠️ Le modèle PROPOSE, il n'ouvre rien : un recueil qui démarrerait seul
   * embarquerait dans un formulaire celui qui voulait juste poser une question.
   */
  collectOffer: { id: string; name: string } | null;
}

/**
 * L'état d'un recueil, tel qu'il voyage — voir `CollectionState` dans
 * `ai/collection.ts`.
 *
 * ⚠️ `origins` et `touched` font l'aller-retour parce que **le serveur n'a pas
 * de mémoire** : sans eux, chaque tour oublierait d'où viennent les valeurs
 * (tous les badges tomberaient) et quels champs l'usager s'est appropriés (le
 * modèle se remettrait à les réécrire). `sanitizeState` les renettoie à chaque
 * arrivée, comme le reste.
 *
 * ⚠️ Toujours AUCUN champ d'identité ici : voir `collectionPayload`.
 */
export interface CollectionPayload {
  demarcheId: string;
  values: Record<string, unknown>;
  skipped: string[];
  origins?: Record<string, { origin: string; source?: string; reason?: string }>;
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

/**
 * Tours d'une conversation d'ORIENTATION : l'usager demande, l'assistant
 * renseigne. Vingt échanges suffisent largement, et bornent la dépense.
 */
export const MAX_TURNS = 20;

/**
 * Tours d'une conversation où un RECUEIL a été ouvert.
 *
 * ⚠️ Remplir un formulaire en parlant coûte des tours : c'est le modèle qui
 * pose les questions, et chacune en consomme un. Vingt ne suffisent pas — la
 * conversation se terminerait au milieu du remplissage, ce qui est le pire
 * moment. La borne ne monte QUE lorsque le serveur a lui-même constaté un
 * recueil valide (voir le drapeau `collecting` du ticket) : l'orientation
 * seule reste bornée à `MAX_TURNS`, et le navigateur ne peut pas réclamer la
 * borne haute — elle vit dans le corps signé du ticket.
 */
export const MAX_TURNS_COLLECT = 40;

/** La borne qui s'applique, selon qu'un recueil est ouvert ou non. */
export function maxTurnsFor(collecting: boolean): number {
  return collecting ? MAX_TURNS_COLLECT : MAX_TURNS;
}
