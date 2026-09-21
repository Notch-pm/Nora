/**
 * Orchestre le RECUEIL d'un formulaire dans la conversation : chargement de la
 * démarche, `sessionStorage`, dépôt final. Non testé, comme
 * `useAssistantConversation.ts` (voir son en-tête) : la RÈGLE est dans
 * `collect.ts` / `recap.ts` / `prefill.ts`, testée là ; ici, seulement la
 * plomberie.
 *
 * ⚠️ Composé avec `useAssistantConversation` par `AssistantPage`, pas fondu
 * dedans : ce hook reçoit `collectionReply` (ce que le SERVEUR a retenu du
 * dernier tour) en paramètre, et rend `turnCollectionPayload` (ce qu'il faut
 * ENVOYER au prochain tour) — la page fait circuler l'un vers l'autre. Aucun
 * appel réseau vers `/v1/assistant` n'a lieu ici : répondre à une carte «
 * card » ne coûte jamais un tour.
 */
import { useEffect, useRef, useState } from "react";
import { solveChallenge } from "@fn/_shared/ai/challenge.ts";
import type { CollectionPayload } from "@fn/_shared/domain/assistantTurn.ts";
import type { FieldErrors } from "@fn/_shared/domain/formulaire.ts";
import { validateRequester } from "@fn/_shared/domain/formulaire.ts";
import { requesterFieldsFor, type Audience } from "@fn/_shared/domain/requesterConfig.ts";
import {
  fetchDemarche,
  fetchDepositChallenge,
  sendDemande,
  type PortalLoadFailure,
} from "@/services/portal/portalClient.ts";
import { challengeToSolve } from "@/services/portal/depositChallenge.ts";
import {
  answerField,
  applyServerCollection,
  chooseOrganization,
  clearCollect,
  collectionPayload,
  type CollectDemarche,
  type CollectNote,
  type CollectSession,
  type CollectStep,
  type CollectStorage,
  confirmIdentity,
  confirmOrganization,
  loadCollect,
  needsOrganizationChoice,
  newSubmissionId,
  receiptNote,
  reopenField as reopenFieldPure,
  reopenIdentity,
  reopenOrganization,
  saveCollect,
  setAudience as setAudiencePure,
  setRequesterValue as setRequesterValuePure,
  skipField,
  startedNote,
  startSession,
  stepOf,
  toDemandeSubmission,
} from "./collect.ts";

/** `sessionStorage` peut lever (navigation privée) ou ne pas exister (rendu hors navigateur). */
function tabStorage(): CollectStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export type CollectLoadError = "no_form" | "failed";

export interface UseAssistantCollect {
  session: CollectSession | null;
  /** `null` hors recueil. */
  step: CollectStep | null;
  /** Notes locales du fil — jamais des messages, voir `collect.ts`. */
  notes: CollectNote[];
  loading: boolean;
  loadError: CollectLoadError | null;
  dismissLoadError: () => void;
  /** Ouvre un recueil pour cette démarche. `messagesLength` place la note dans le fil. */
  start: (demarcheId: string, messagesLength: number) => void;
  answerField: (fieldId: string, value: unknown) => void;
  skipField: (fieldId: string) => void;
  chooseOrganization: (organizationId: string) => void;
  confirmOrganization: () => void;
  reopenOrganization: () => void;
  setAudience: (audience: Audience | null) => void;
  setRequesterValue: (key: string, value: string) => void;
  requesterErrors: FieldErrors;
  /** Valide et avance si l'identité est correcte ; rend `false` sinon (`requesterErrors` porte le détail). */
  confirmIdentity: () => boolean;
  /**
   * Confirme l'organisme ET l'identité d'un seul geste — le « Relire et
   * envoyer » du co-pilote, où les deux sont saisis dans le formulaire. Rend ce
   * qui bloque, pour que l'écran sache où amener le regard.
   */
  confirmAll: () => "ok" | "organization" | "identity";
  reopenIdentity: () => void;
  reopenField: (fieldId: string) => void;
  /** Nombre de réponses retirées en cascade par le dernier « Modifier » — `null` sinon. */
  purgedCount: number | null;
  dismissPurgeNotice: () => void;
  /** Envoie la demande. `messagesLength` place l'accusé dans le fil. */
  submit: (messagesLength: number) => Promise<void>;
  submitting: boolean;
  submitFailure: PortalLoadFailure | null;
  /** À joindre au prochain tour de conversation — `null` hors recueil. */
  turnCollectionPayload: CollectionPayload | null;
  /** Efface tout, y compris `sessionStorage` — la même « Nouvelle conversation » que le fil. */
  reset: () => void;
}

export function useAssistantCollect(params: {
  lang: string;
  depositEnabled: boolean;
  /** Ce que le SERVEUR a retenu du dernier tour — voir `useAssistantConversation`. */
  collectionReply: CollectionPayload | null;
}): UseAssistantCollect {
  const { lang, depositEnabled, collectionReply } = params;
  const [session, setSession] = useState<CollectSession | null>(null);
  const [notes, setNotes] = useState<CollectNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<CollectLoadError | null>(null);
  const [requesterErrors, setRequesterErrors] = useState<FieldErrors>({});
  const [purgedCount, setPurgedCount] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitFailure, setSubmitFailure] = useState<PortalLoadFailure | null>(null);
  const submissionIdRef = useRef<string>(newSubmissionId());
  // Garde synchrone contre le double-clic — voir `submit()`.
  const submittingRef = useRef(false);
  // Un chargement de démarche périmé (l'usager a changé d'avis, ou relancé un
  // second recueil très vite) ne doit pas écraser un état plus récent.
  const loadGenerationRef = useRef(0);

  // Relit un recueil interrompu par un rechargement — une fois, au montage.
  useEffect(() => {
    const storage = tabStorage();
    if (storage === null) return;
    const stored = loadCollect(storage);
    if (stored === null) return;
    setSession(stored.session);
    setNotes(stored.notes);
  }, []);

  // Range le recueil à chaque changement — tolérant, voir `collect.ts`.
  useEffect(() => {
    const storage = tabStorage();
    if (storage !== null) saveCollect(storage, { session, notes });
  }, [session, notes]);

  // Ce que le serveur a retenu du dernier tour remplace l'état local — voir
  // `applyServerCollection` : sans effet hors recueil, ou sur une réponse qui
  // parle d'une autre démarche.
  useEffect(() => {
    setSession((current) => applyServerCollection(current, collectionReply));
  }, [collectionReply]);

  async function start(demarcheId: string, messagesLength: number): Promise<void> {
    if (!depositEnabled) return;
    setLoadError(null);
    setLoading(true);
    const generation = ++loadGenerationRef.current;
    const result = await fetchDemarche(demarcheId, lang);
    if (loadGenerationRef.current !== generation) return; // Périmé.
    setLoading(false);
    if (!result.ok) {
      setLoadError("failed");
      return;
    }
    const detail = result.snapshot.demarche;
    if (detail.form === null) {
      setLoadError("no_form");
      return;
    }
    const collectDemarche: CollectDemarche = {
      id: detail.id,
      name: detail.name,
      form: detail.form,
      requester: detail.requester,
      organizations: detail.organizations,
    };
    submissionIdRef.current = newSubmissionId();
    setRequesterErrors({});
    setPurgedCount(null);
    setSubmitFailure(null);
    setSession(startSession(collectDemarche));
    setNotes((previous) => [...previous, startedNote(detail.name, messagesLength)]);
  }

  function dismissLoadError(): void {
    setLoadError(null);
  }

  function answerFieldAction(fieldId: string, value: unknown): void {
    if (session === null) return;
    setSession(answerField(session, fieldId, value));
    // Un champ répondu de nouveau referme l'avertissement d'une purge
    // précédente — il ne désigne plus la situation courante.
    setPurgedCount(null);
  }

  function skipFieldAction(fieldId: string): void {
    if (session === null) return;
    setSession(skipField(session, fieldId));
    setPurgedCount(null);
  }

  function chooseOrganizationAction(organizationId: string): void {
    if (session === null) return;
    setSession(chooseOrganization(session, organizationId));
  }

  function confirmOrganizationAction(): void {
    if (session === null) return;
    setSession(confirmOrganization(session));
  }

  function reopenOrganizationAction(): void {
    if (session === null) return;
    setSession(reopenOrganization(session));
  }

  function setAudienceAction(audience: Audience | null): void {
    if (session === null) return;
    setSession(setAudiencePure(session, audience));
    setRequesterErrors({});
  }

  function setRequesterValueAction(key: string, value: string): void {
    if (session === null) return;
    setSession(setRequesterValuePure(session, key, value));
    setRequesterErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function confirmIdentityAction(): boolean {
    if (session === null) return false;
    const fields = session.audience === null ? [] : requesterFieldsFor(session.demarche.requester, session.audience);
    const errors = validateRequester(fields, session.requesterValues);
    setRequesterErrors(errors);
    if (Object.keys(errors).length > 0) return false;
    setSession(confirmIdentity(session));
    return true;
  }

  /**
   * « Relire et envoyer » du co-pilote : l'organisme et l'identité sont saisis
   * DANS le formulaire, à droite, pas dans deux cartes successives — un seul
   * geste les confirme donc tous les deux.
   *
   * ⚠️ **Une seule écriture d'état, composée.** Appeler `confirmOrganization()`
   * puis `confirmIdentity()` à la suite ne marcherait pas : les deux partent de
   * la `session` du rendu courant, et la seconde écraserait le résultat de la
   * première. Ici les deux fonctions pures s'enchaînent sur la même valeur.
   */
  function confirmAllAction(): "ok" | "organization" | "identity" {
    if (session === null) return "identity";
    if (needsOrganizationChoice(session.demarche) && session.organizationId === null) {
      return "organization";
    }
    const fields =
      session.audience === null ? [] : requesterFieldsFor(session.demarche.requester, session.audience);
    const errors = validateRequester(fields, session.requesterValues);
    setRequesterErrors(errors);
    if (Object.keys(errors).length > 0) return "identity";
    setSession(confirmIdentity(confirmOrganization(session)));
    return "ok";
  }

  function reopenIdentityAction(): void {
    if (session === null) return;
    setSession(reopenIdentity(session));
  }

  function reopenFieldAction(fieldId: string): void {
    if (session === null) return;
    const { session: next, purgedCount: purged } = reopenFieldPure(session, fieldId);
    setSession(next);
    setPurgedCount(purged > 0 ? purged : null);
  }

  function dismissPurgeNotice(): void {
    setPurgedCount(null);
  }

  async function submit(messagesLength: number): Promise<void> {
    // ⚠️ Garde SYNCHRONE, sur une `ref` — pas sur l'état `submitting` : entre
    // deux clics très rapprochés, React n'a pas forcément encore reflété le
    // premier `setSubmitting(true)` dans un nouveau rendu, et une garde posée
    // sur l'état seul laisserait passer le second clic. C'est ce qui rend le
    // double-clic réellement impossible, pas seulement improbable.
    if (session === null || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitFailure(null);
    try {
      // La preuve de travail se résout ICI, comme pour un tour de conversation
      // — une panne de `/v1/defi` ne doit pas empêcher de tenter le dépôt.
      const challengeLoad = await fetchDepositChallenge();
      const toSolve = challengeToSolve(challengeLoad);
      const challenge = toSolve === null ? null : await solveChallenge(toSolve, 2000, submissionIdRef.current);
      const result = await sendDemande(toDemandeSubmission(session, submissionIdRef.current), challenge);
      if (!result.ok) {
        setSubmitFailure(result.reason);
        return;
      }
      // L'accusé devient une entrée PERMANENTE du fil ; le recueil, lui, se
      // referme et se purge — la conversation peut continuer.
      setNotes((previous) => [...previous, receiptNote(session.demarche.name, messagesLength, result.receipt)]);
      setSession(null);
      setPurgedCount(null);
      setRequesterErrors({});
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function reset(): void {
    loadGenerationRef.current += 1; // Tout chargement en vol devient périmé.
    setSession(null);
    setNotes([]);
    setLoadError(null);
    setRequesterErrors({});
    setPurgedCount(null);
    setSubmitFailure(null);
    const storage = tabStorage();
    if (storage !== null) clearCollect(storage);
  }

  return {
    session,
    step: session === null ? null : stepOf(session),
    notes,
    loading,
    loadError,
    dismissLoadError,
    start,
    answerField: answerFieldAction,
    skipField: skipFieldAction,
    chooseOrganization: chooseOrganizationAction,
    confirmOrganization: confirmOrganizationAction,
    reopenOrganization: reopenOrganizationAction,
    setAudience: setAudienceAction,
    setRequesterValue: setRequesterValueAction,
    requesterErrors,
    confirmIdentity: confirmIdentityAction,
    confirmAll: confirmAllAction,
    reopenIdentity: reopenIdentityAction,
    reopenField: reopenFieldAction,
    purgedCount,
    dismissPurgeNotice,
    submit,
    submitting,
    submitFailure,
    turnCollectionPayload: session === null ? null : collectionPayload(session),
    reset,
  };
}
