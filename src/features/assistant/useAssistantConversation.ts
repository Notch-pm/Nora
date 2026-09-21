/**
 * Orchestre une conversation avec l'assistant : réseau, `sessionStorage`,
 * minuteur de l'attente longue, et retour du focus — tout ce que
 * `conversation.ts` ne fait pas puisqu'il reste pur. Non testé, comme
 * `useDemarche.ts` et `useAudience.ts` (voir leurs en-têtes) : la RÈGLE est
 * dans `conversation.ts`, testée là ; ici, seulement la plomberie.
 *
 * ⚠️ Un `generation` incrémenté à chaque geste de l'usager (envoi, nouvel
 * essai, nouvelle conversation) protège des réponses TARDIVES : si l'usager
 * vide le fil pendant qu'une requête est encore en vol, la réponse qui arrive
 * après coup est silencieusement ignorée plutôt que d'atterrir dans une
 * conversation qui n'est plus la sienne.
 */
import { useEffect, useReducer, useRef, useState, type RefObject } from "react";
import { solveChallenge } from "@fn/_shared/ai/challenge.ts";
import type { CollectionPayload, SolvedChallenge } from "@fn/_shared/domain/assistantTurn.ts";
import { fetchAssistantChallenge, sendAssistantTurn } from "@/services/portal/portalClient.ts";
import {
  buildTurnRequest,
  clearConversation,
  focusDemarcheOf,
  type ConversationState,
  initialConversation,
  loadConversation,
  reduceConversation,
  saveConversation,
  validateMessage,
  type AssistantMessageView,
  type MessageProblem,
} from "./conversation.ts";

/** `sessionStorage` peut lever (navigation privée) ou ne pas exister (rendu hors navigateur). */
function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Au-delà, l'attente affiche « toujours en cours » plutôt que de rester muette. */
const STILL_WAITING_MS = 8_000;

export interface UseAssistantConversation {
  state: ConversationState;
  /** `true` passé `STILL_WAITING_MS` d'attente ininterrompue. */
  stillWaiting: boolean;
  /** Le dernier problème de SAISIE (avant tout envoi réseau) — vide, trop long. */
  problem: MessageProblem | null;
  /** À appeler quand l'usager reprend la saisie, pour effacer `problem`. */
  clearProblem: () => void;
  /** À poser sur la zone de saisie : le focus y revient après chaque tour. */
  textareaRef: RefObject<HTMLTextAreaElement>;
  /** À poser sur le bouton « Nouvelle conversation » : y reçoit le focus quand le fil se termine. */
  newConversationButtonRef: RefObject<HTMLButtonElement>;
  /**
   * Rend `true` quand le message a été accepté et pris en charge — l'appelant
   * peut alors vider sa saisie. `collection` porte le recueil en cours (lot
   * 2), s'il y en a un — voir `useAssistantCollect.ts`. Retenu pour le rejeu
   * automatique d'un ticket périmé et pour `retry()`, qui doivent porter EXACTEMENT
   * ce qui a été envoyé la première fois.
   */
  sendMessage: (raw: string, collection?: CollectionPayload | null) => boolean;
  /** Rejoue le DERNIER message déjà dans le fil — celui qui a échoué. */
  retry: () => void;
  newConversation: () => void;
  /**
   * Le recueil que le serveur a RETENU du dernier tour reçu — `null` hors
   * recueil, ou avant toute réponse. `useAssistantCollect.ts` le repasse par
   * `sanitizeState` avant de s'en servir (même règle que partout ailleurs).
   */
  collectionReply: CollectionPayload | null;
}

export function useAssistantConversation(
  focusDemarcheId: string | null,
  lang: string,
): UseAssistantConversation {
  const [state, dispatch] = useReducer(reduceConversation, undefined, initialConversation);
  const [stillWaiting, setStillWaiting] = useState(false);
  const [problem, setProblem] = useState<MessageProblem | null>(null);
  const [collectionReply, setCollectionReply] = useState<CollectionPayload | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const newConversationButtonRef = useRef<HTMLButtonElement>(null);
  // Incrémenté à chaque geste de l'usager — voir l'en-tête du fichier.
  const generationRef = useRef(0);
  // `focusDemarcheId`/`lang` lus par un tour en vol : une `ref` évite d'avoir
  // à recréer les fonctions d'envoi à chaque frappe dans le sélecteur de
  // langue pendant qu'une réponse est en cours.
  const contextRef = useRef({ focusDemarcheId, lang });
  contextRef.current = { focusDemarcheId, lang };

  // Relit une conversation interrompue par un rechargement — une fois, au
  // montage (tableau de dépendances vide, délibérément).
  useEffect(() => {
    const storage = tabStorage();
    if (storage === null) return;
    const stored = loadConversation(storage);
    if (stored !== null) dispatch({ type: "restored", stored });
  }, []);

  // Range la conversation à chaque changement — tolérant, voir `conversation.ts`.
  useEffect(() => {
    const storage = tabStorage();
    if (storage !== null) saveConversation(storage, state);
  }, [state]);

  // « Toujours en cours » après une attente longue — un seul minuteur, qui
  // court tant que `status` reste `"sending"` (une réouverture automatique ne
  // le relance pas : le TEMPS TOTAL écoulé depuis le clic de l'usager est ce
  // qui doit décider, pas le nombre d'appels réseau internes).
  useEffect(() => {
    if (state.status !== "sending") {
      setStillWaiting(false);
      return;
    }
    const id = setTimeout(() => setStillWaiting(true), STILL_WAITING_MS);
    return () => clearTimeout(id);
  }, [state.status]);

  // Le focus revient à la saisie après un tour — ou au bouton « Nouvelle
  // conversation » quand le fil vient de se terminer (RGAA 10.7 / 11.10 : ne
  // jamais laisser le focus se perdre après une mise à jour du contenu).
  const previousStatusRef = useRef(state.status);
  useEffect(() => {
    const previous = previousStatusRef.current;
    previousStatusRef.current = state.status;
    if (previous !== "sending" || state.status === "sending") return;
    if (state.status === "ended") newConversationButtonRef.current?.focus();
    else textareaRef.current?.focus();
  }, [state.status]);

  /**
   * Mène un tour à son terme : défi si besoin, puis l'appel — et, sur
   * `challenge_required`, une réouverture automatique et transparente (voir
   * la fiche de mission). `messagesForRequest` est le fil TEL QU'IL DOIT
   * PARTIR (le message qui vient d'être ajouté y figure déjà).
   */
  // Le recueil attaché au DERNIER envoi — retenu pour que le rejeu automatique
  // d'un ticket périmé (ci-dessous) et `retry()` portent exactement ce qui a
  // été envoyé la première fois, sans que l'appelant ait à s'en souvenir.
  const lastCollectionRef = useRef<CollectionPayload | null>(null);

  async function runTurn(
    messagesForRequest: readonly AssistantMessageView[],
    ticket: string | null,
    generation: number,
    collection: CollectionPayload | null,
  ): Promise<void> {
    let challenge: SolvedChallenge | null = null;
    if (ticket === null) {
      const challengeLoad = await fetchAssistantChallenge();
      if (generationRef.current !== generation) return; // Périmé : l'usager a bougé entre-temps.
      if (!challengeLoad.ok) {
        dispatch({ type: "failed", reason: challengeLoad.reason });
        return;
      }
      // La preuve de travail se résout ICI, dans le navigateur : l'usager ne
      // doit rien voir de différent d'une attente de réponse (voir la fiche).
      challenge = await solveChallenge(challengeLoad.challenge);
      if (generationRef.current !== generation) return;
    }

    const { focusDemarcheId: fromAddress, lang: currentLang } = contextRef.current;
    const request = buildTurnRequest({
      ticket,
      challenge,
      messages: messagesForRequest,
      // La démarche proposée au tour précédent, à défaut celle de l'adresse.
      focusDemarcheId: focusDemarcheOf(messagesForRequest, fromAddress),
      lang: currentLang,
      collection,
    });
    if (request === null) {
      dispatch({ type: "failed", reason: "bad_request" });
      return;
    }

    const result = await sendAssistantTurn(request);
    if (generationRef.current !== generation) return;

    if (!result.ok) {
      // Le ticket ne vaut plus rien : on rouvre automatiquement, sans faire
      // retaper l'usager — voir `reduceConversation`, cas `"reopen"`. On ne
      // le fait qu'UNE fois (`ticket !== null` ci-dessous) : si la conversation
      // neuve échoue à son tour avec le même code, mieux vaut un message
      // d'erreur clair qu'une boucle silencieuse.
      if (result.reason === "challenge_required" && ticket !== null) {
        dispatch({ type: "reopen" });
        const last = [...messagesForRequest].reverse().find((m) => m.role === "user");
        if (last !== undefined) await runTurn([{ ...last }], null, generation, collection);
        return;
      }
      dispatch({ type: "failed", reason: result.reason, retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    dispatch({ type: "received", reply: result.reply });
    setCollectionReply(result.reply.collection);
  }

  function sendMessage(raw: string, collection: CollectionPayload | null = null): boolean {
    if (state.status === "sending" || state.status === "ended") return false;
    const validation = validateMessage(raw);
    if (!validation.ok) {
      setProblem(validation.problem);
      return false;
    }
    setProblem(null);
    lastCollectionRef.current = collection;
    const generation = ++generationRef.current;
    // Calculé PUREMENT, pour construire la requête sans attendre le prochain
    // rendu (voir l'en-tête) — et réellement appliqué juste après, par la
    // même action.
    const prospective = reduceConversation(state, { type: "sent", content: validation.content });
    dispatch({ type: "sent", content: validation.content });
    void runTurn(prospective.messages, state.ticket, generation, collection);
    return true;
  }

  function retry(): void {
    if (state.failure === null || state.status === "ended") return;
    const generation = ++generationRef.current;
    dispatch({ type: "retrying" });
    void runTurn(state.messages, state.ticket, generation, lastCollectionRef.current);
  }

  function newConversation(): void {
    generationRef.current += 1; // Toute réponse en vol devient périmée.
    dispatch({ type: "reset" });
    setProblem(null);
    setCollectionReply(null);
    lastCollectionRef.current = null;
    const storage = tabStorage();
    if (storage !== null) clearConversation(storage);
  }

  return {
    state,
    stillWaiting,
    problem,
    clearProblem: () => setProblem(null),
    textareaRef,
    newConversationButtonRef,
    sendMessage,
    retry,
    newConversation,
    collectionReply,
  };
}
