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
import { consentErrorKey, validateConsents, type ConsentKind } from "@fn/_shared/domain/consents.ts";
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
  newSubmissionId,
  receiptNote,
  reopenField as reopenFieldPure,
  reopenIdentity,
  reopenOrganization,
  saveCollect,
  setAudience as setAudiencePure,
  setConsent as setConsentPure,
  setRequesterValue as setRequesterValuePure,
  skipField,
  skipOptional,
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

/** Ce qu'un recueil qui vient de s'ouvrir rend à son appelant — voir `start`. */
export interface OpenedCollect {
  name: string;
  /** L'état à joindre au tour qui suit, sans attendre le prochain rendu. */
  payload: CollectionPayload;
}

export interface UseAssistantCollect {
  session: CollectSession | null;
  /** `null` hors recueil. */
  step: CollectStep | null;
  /** Notes locales du fil — jamais des messages, voir `collect.ts`. */
  notes: CollectNote[];
  loading: boolean;
  loadError: CollectLoadError | null;
  dismissLoadError: () => void;
  /**
   * Relance le dernier chargement qui a échoué — `null` quand il n'y a rien à
   * relancer. Le message d'échec disait « Réessayez » depuis le premier jour
   * sans rien offrir à presser : le seul recours était de retrouver le bouton
   * d'origine, qui n'est plus forcément à l'écran.
   */
  retryStart: (() => void) | null;
  /**
   * Ouvre un recueil pour cette démarche. `messagesLength` place la note dans
   * le fil.
   *
   * ⚠️ Rend la démarche OUVERTE, ou `null` si rien ne s'est ouvert (échec de
   * chargement, pas de formulaire, dépôt fermé, doublon de clic). C'est ce qui
   * permet à l'appelant d'enchaîner sur un tour de conversation : sans cela,
   * ouvrir un recueil laissait un SILENCE — la note « Vous remplissez… »
   * s'affichait, et l'assistant ne disait rien tant que l'usager n'avait pas
   * écrit le premier. On lui demandait de parler à quelqu'un qui se taisait.
   */
  start: (demarcheId: string, messagesLength: number) => Promise<OpenedCollect | null>;
  /**
   * Rend la session APRÈS la réponse (ou `null` hors recueil) — de quoi
   * relancer la conversation tout de suite avec le bon état, sans attendre le
   * prochain rendu (même motif que `start`).
   */
  answerField: (fieldId: string, value: unknown) => CollectSession | null;
  skipField: (fieldId: string) => CollectSession | null;
  /** « Passer les questions facultatives » — sans effet tant qu'il manque de l'obligatoire. Rend la session après. */
  skipOptional: () => CollectSession | null;
  chooseOrganization: (organizationId: string) => void;
  confirmOrganization: () => void;
  reopenOrganization: () => void;
  setAudience: (audience: Audience | null) => void;
  setRequesterValue: (key: string, value: string) => void;
  setConsent: (kind: ConsentKind, granted: boolean) => void;
  /** Erreurs de l'identité ET des consentements (clés `consent.<kind>`). */
  requesterErrors: FieldErrors;
  /** Valide identité et consentements, et avance si tout est correct ; rend `false` sinon (`requesterErrors` porte le détail). */
  confirmIdentity: () => boolean;
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
  // Gardes synchrones contre le double-clic — voir `submit()` et `start()`.
  const submittingRef = useRef(false);
  const startingRef = useRef(false);
  /** Le dernier `start()` tenté — de quoi le rejouer depuis le message d'échec. */
  const lastStartRef = useRef<{ demarcheId: string; messagesLength: number } | null>(null);
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

  async function start(demarcheId: string, messagesLength: number): Promise<OpenedCollect | null> {
    if (!depositEnabled) return null;
    // ⚠️ Garde SYNCHRONE : `loading` est un état, et n'arrive qu'au rendu
    // suivant. Deux clics rapprochés sur « Oui, remplissons-la ici » lançaient
    // deux chargements, dont un pour rien. Même motif que `submit()`.
    if (startingRef.current) return null;
    startingRef.current = true;
    lastStartRef.current = { demarcheId, messagesLength };
    setLoadError(null);
    setLoading(true);
    const generation = ++loadGenerationRef.current;
    let result = await fetchDemarche(demarcheId, lang);
    // ⚠️ UNE reprise, et seulement sur une coupure : un accroc transitoire ne
    // doit pas coûter à l'usager un encart rouge et un geste de plus. Les
    // autres échecs ne guériront pas d'un second appel — une démarche
    // dépubliée, une adresse d'API absente ou un corps illisible sont des faits
    // stables, et réessayer ne ferait que doubler l'attente avant la même
    // mauvaise nouvelle.
    if (!result.ok && result.reason === "network" && loadGenerationRef.current === generation) {
      result = await fetchDemarche(demarcheId, lang);
    }
    startingRef.current = false;
    if (loadGenerationRef.current !== generation) return null; // Périmé.
    setLoading(false);
    if (!result.ok) {
      setLoadError("failed");
      return null;
    }
    const detail = result.snapshot.demarche;
    if (detail.form === null) {
      setLoadError("no_form");
      return null;
    }
    const collectDemarche: CollectDemarche = {
      id: detail.id,
      name: detail.name,
      form: detail.form,
      requester: detail.requester,
      organizations: detail.organizations,
      tenantName: result.snapshot.tenant.name,
    };
    submissionIdRef.current = newSubmissionId();
    setRequesterErrors({});
    setPurgedCount(null);
    setSubmitFailure(null);
    const opened = startSession(collectDemarche);
    setSession(opened);
    setNotes((previous) => [...previous, startedNote(detail.name, messagesLength)]);
    // ⚠️ L'état est rendu DIRECTEMENT, pas lu depuis `session` : celui-ci ne
    // vaudra la nouvelle valeur qu'au rendu suivant, et l'appelant envoie son
    // tour tout de suite. Même motif que le `prospective` de `sendMessage`.
    return { name: detail.name, payload: collectionPayload(opened) };
  }

  function dismissLoadError(): void {
    setLoadError(null);
  }

  // ⚠️ Seulement pour « failed ». Une démarche SANS formulaire (« no_form ») ne
  // se recharge pas : la relancer rendrait exactement le même refus, et le
  // bouton promettrait une issue qui n'existe pas.
  const lastStart = lastStartRef.current;
  const retryStart =
    loadError === "failed" && lastStart !== null
      ? () => void start(lastStart.demarcheId, lastStart.messagesLength)
      : null;

  function answerFieldAction(fieldId: string, value: unknown): CollectSession | null {
    if (session === null) return null;
    const next = answerField(session, fieldId, value);
    setSession(next);
    // Un champ répondu de nouveau referme l'avertissement d'une purge
    // précédente — il ne désigne plus la situation courante.
    setPurgedCount(null);
    return next;
  }

  function skipFieldAction(fieldId: string): CollectSession | null {
    if (session === null) return null;
    const next = skipField(session, fieldId);
    setSession(next);
    setPurgedCount(null);
    return next;
  }

  function skipOptionalAction(): CollectSession | null {
    if (session === null) return null;
    const next = skipOptional(session);
    setSession(next);
    setPurgedCount(null);
    return next;
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

  function setConsentAction(kind: ConsentKind, granted: boolean): void {
    if (session === null) return;
    setSession(setConsentPure(session, kind, granted));
    setRequesterErrors((previous) => {
      const key = consentErrorKey(kind);
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function confirmIdentityAction(): boolean {
    if (session === null) return false;
    const fields = session.audience === null ? [] : requesterFieldsFor(session.demarche.requester, session.audience);
    // Identité et consentements dans le même bloc, donc le même verdict.
    const errors: FieldErrors = {
      ...validateRequester(fields, session.requesterValues),
      ...validateConsents(session.consents),
    };
    setRequesterErrors(errors);
    if (Object.keys(errors).length > 0) return false;
    setSession(confirmIdentity(session));
    return true;
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
    // ⚠️ Et il faut DÉGELER l'écran. Le chargement périmé sortira de `start()`
    // avant d'atteindre `setLoading(false)` : sans ces deux lignes, `loading`
    // restait vrai pour toujours — « Chargement du formulaire… » ne partait
    // plus, et `collectBusy` désactivait définitivement tous les boutons de
    // recueil, sans la moindre erreur affichée pour l'expliquer.
    startingRef.current = false;
    setLoading(false);
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
    retryStart,
    start,
    answerField: answerFieldAction,
    skipField: skipFieldAction,
    skipOptional: skipOptionalAction,
    chooseOrganization: chooseOrganizationAction,
    confirmOrganization: confirmOrganizationAction,
    reopenOrganization: reopenOrganizationAction,
    setAudience: setAudienceAction,
    setRequesterValue: setRequesterValueAction,
    setConsent: setConsentAction,
    requesterErrors,
    confirmIdentity: confirmIdentityAction,
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
