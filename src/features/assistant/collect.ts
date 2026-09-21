/**
 * Le RECUEIL d'un formulaire dans la conversation — la machine d'ÉTAPES, côté
 * écran. Pur, testé : c'est cette suite d'états qui décide quelle carte
 * montrer, jamais le composant.
 *
 * ⚠️ Deux modules à ne pas confondre : `@fn/_shared/ai/collection.ts` décide
 * quel CHAMP est en attente et sur quel mode (`viewOf`) — même code des deux
 * côtés, serveur compris. Celui-ci décide de l'ÉTAPE qui suit les champs
 * (organisme → identité → récapitulatif), propre à l'écran : le serveur n'en
 * sait rien, il n'a pas de mémoire.
 *
 * ⚠️ L'IDENTITÉ (audience, `requesterValues`) et l'ORGANISME choisi NE
 * PARTENT JAMAIS au modèle — ils ne figurent ni dans `CollectionPayload`, ni
 * dans aucun message du fil. Seul `collectionPayload()` construit ce qui part
 * en tour de conversation, et il ne lit que `session.collection`.
 */
import { answerField as answerCollectionField, sanitizeState, skipField as skipCollectionField, viewOf } from "@fn/_shared/ai/collection.ts";
import type { CollectionState } from "@fn/_shared/ai/collection.ts";
import type { CollectionPayload } from "@fn/_shared/domain/assistantTurn.ts";
import type { AttachmentRef, DemandeReceipt, DemandeSubmission } from "@fn/_shared/domain/demande.ts";
import type { DemarcheOrganization } from "@fn/_shared/domain/demarche.ts";
import { parseFormSchema, type FormSchema } from "@fn/_shared/domain/formSchema.ts";
import { toAttachments, toFormData, toRequester } from "@fn/_shared/domain/formulaire.ts";
import {
  AUDIENCES,
  CONTACT_TYPES,
  enabledAudiences,
  parseRequesterConfig,
  requesterFieldsFor,
  type Audience,
  type RequesterConfig,
} from "@fn/_shared/domain/requesterConfig.ts";

/** Ce qu'il faut de la démarche pour la remplir en conversation — un `DemarcheDetail` réduit. */
export interface CollectDemarche {
  id: string;
  name: string;
  form: FormSchema;
  requester: RequesterConfig;
  organizations: DemarcheOrganization[];
}

export interface CollectSession {
  demarche: CollectDemarche;
  collection: CollectionState;
  /** L'organisme choisi — `null` tant que l'usager n'a rien choisi. */
  organizationId: string | null;
  /** `true` dès l'ouverture s'il n'y a rien à choisir (0 ou 1 organisme). */
  organizationConfirmed: boolean;
  audience: Audience | null;
  requesterValues: Record<string, string>;
  /** `true` dès l'ouverture si la collectivité n'a ouvert aucun public. */
  identityConfirmed: boolean;
}

export type CollectStep = "fields" | "organization" | "identity" | "recap";

const AUDIENCE_VALUES = new Set<string>(AUDIENCES.map((a) => a.key));

function isAudience(value: unknown): value is Audience {
  return typeof value === "string" && AUDIENCE_VALUES.has(value);
}

export function needsOrganizationChoice(demarche: CollectDemarche): boolean {
  return demarche.organizations.length > 1;
}

export function needsIdentity(demarche: CollectDemarche): boolean {
  return enabledAudiences(demarche.requester).length > 0;
}

/**
 * Ouvre un recueil — aucune réponse, aucun appel au modèle.
 *
 * ⚠️ Le premier public ouvert est présélectionné — même règle que
 * `FormulairePage` (`audience ?? audiences[0]`) : la carte « Vos informations »
 * montre alors directement les bons champs, avec un choix qui reste modifiable
 * s'il y en a plusieurs.
 */
export function startSession(demarche: CollectDemarche): CollectSession {
  return {
    demarche,
    collection: { demarcheId: demarche.id, values: {}, skipped: [], origins: {}, touched: [] },
    organizationId: demarche.organizations.length === 1 ? demarche.organizations[0].id : null,
    organizationConfirmed: !needsOrganizationChoice(demarche),
    audience: enabledAudiences(demarche.requester)[0] ?? null,
    requesterValues: {},
    identityConfirmed: !needsIdentity(demarche),
  };
}

/**
 * L'étape à montrer — jamais mémorisée, toujours recalculée depuis l'état.
 *
 * ⚠️ Sûr par construction : `view.complete` exige `validateForm(...) === {}`
 * en plus de « plus aucun champ en attente ». Un champ « carte » (choix, date,
 * pièce) ne peut porter une valeur mal formée — ses contrôles ne produisent
 * que des valeurs valides. Un champ « conversation » (texte, nombre…) n'est
 * accepté, ici comme au serveur (`applyUpdates`), qu'après avoir passé
 * `validateForm` — jamais avant. Il ne peut donc pas exister d'état où
 * `pending` est `null` et `complete` faux : la carte suivante a toujours
 * quelque chose à montrer.
 */
export function stepOf(session: CollectSession): CollectStep {
  const view = viewOf(session.demarche.form, session.collection);
  if (!view.complete) return "fields";
  if (!session.organizationConfirmed) return "organization";
  if (!session.identityConfirmed) return "identity";
  return "recap";
}

export function answerField(session: CollectSession, fieldId: string, value: unknown): CollectSession {
  return { ...session, collection: answerCollectionField(session.demarche.form, session.collection, fieldId, value) };
}

export function skipField(session: CollectSession, fieldId: string): CollectSession {
  return { ...session, collection: skipCollectionField(session.demarche.form, session.collection, fieldId) };
}

/**
 * Ce que le serveur a retenu de ce que le modèle a compris, à la fin d'un
 * tour — remplace l'état local, nettoyé contre CE formulaire. Ignoré si la
 * réponse parle d'une autre démarche (la session a changé entre-temps) ou
 * s'il n'y a pas de recueil en cours.
 */
export function applyServerCollection(
  session: CollectSession | null,
  payload: CollectionPayload | null,
): CollectSession | null {
  if (session === null || payload === null || payload.demarcheId !== session.demarche.id) return session;
  return { ...session, collection: sanitizeState(session.demarche.form, session.demarche.id, payload) };
}

export function chooseOrganization(session: CollectSession, organizationId: string): CollectSession {
  return { ...session, organizationId, organizationConfirmed: false };
}

export function confirmOrganization(session: CollectSession): CollectSession {
  if (session.organizationId === null) return session;
  return { ...session, organizationConfirmed: true };
}

/** « Modifier » l'organisme, depuis le récapitulatif. */
export function reopenOrganization(session: CollectSession): CollectSession {
  return { ...session, organizationConfirmed: false };
}

export function setAudience(session: CollectSession, audience: Audience | null): CollectSession {
  return { ...session, audience };
}

export function setRequesterValue(session: CollectSession, key: string, value: string): CollectSession {
  return { ...session, requesterValues: { ...session.requesterValues, [key]: value } };
}

/** À appeler après validation (`validateRequester`, côté écran) : l'appelant a déjà vérifié. */
export function confirmIdentity(session: CollectSession): CollectSession {
  return { ...session, identityConfirmed: true };
}

/** « Modifier » « Vos informations », depuis le récapitulatif. */
export function reopenIdentity(session: CollectSession): CollectSession {
  return { ...session, identityConfirmed: false };
}

/**
 * Rouvre un champ déjà répondu pour le corriger (« Modifier » du
 * récapitulatif) : vide sa réponse, purge ce que ça masque en cascade, et dit
 * combien d'AUTRES réponses viennent de tomber.
 */
export function reopenField(
  session: CollectSession,
  fieldId: string,
): { session: CollectSession; purgedCount: number } {
  const before = session.collection;
  const rest = Object.fromEntries(Object.entries(before.values).filter(([id]) => id !== fieldId));
  const next = sanitizeState(session.demarche.form, session.demarche.id, {
    values: rest,
    skipped: before.skipped.filter((id) => id !== fieldId),
  });
  const purgedCount = Object.keys(before.values).filter(
    (id) => id !== fieldId && !(id in next.values),
  ).length;
  return { session: { ...session, collection: next }, purgedCount };
}

/** L'organisme retenu : le choix de l'usager, ou le seul possible. */
export function effectiveOrganizationId(session: CollectSession): string | null {
  if (session.organizationId !== null) return session.organizationId;
  return session.demarche.organizations.length === 1 ? session.demarche.organizations[0].id : null;
}

/** Ce qui part au tour suivant, tant qu'un recueil est en cours — jamais l'identité. */
export function collectionPayload(session: CollectSession): CollectionPayload {
  return {
    demarcheId: session.collection.demarcheId,
    values: session.collection.values,
    skipped: session.collection.skipped,
    // Le serveur n'a pas de mémoire : sans l'aller-retour, les badges
    // tomberaient à chaque tour et le modèle réécrirait ce que l'usager s'est
    // approprié. Toujours aucun champ d'identité, en revanche.
    origins: session.collection.origins,
    touched: session.collection.touched,
  };
}

/** La demande telle qu'elle part — même construction que `FormulairePage`. */
export function toDemandeSubmission(session: CollectSession, submissionId: string): DemandeSubmission {
  const requesterFields = session.audience === null ? [] : requesterFieldsFor(session.demarche.requester, session.audience);
  const attachments: AttachmentRef[] = toAttachments(session.demarche.form, session.collection.values);
  return {
    demarcheId: session.demarche.id,
    organizationId: effectiveOrganizationId(session),
    formData: toFormData(session.demarche.form, session.collection.values),
    requester:
      session.audience === null
        ? null
        : toRequester(CONTACT_TYPES[session.audience], requesterFields, session.requesterValues),
    submissionId,
    attachments,
  };
}

/** Un identifiant de dépôt, stable pour une session — même motif que `FormulairePage`. */
export function newSubmissionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "dep-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// ── Le fil : notes locales et accusé ────────────────────────────────────────
//
// ⚠️ CES ENTRÉES NE SONT JAMAIS DES MESSAGES : elles ne transitent JAMAIS par
// `ConversationState.messages`, donc jamais par `toTurnMessages` ni par le
// réseau. Le serveur signe chaque réponse « assistant » qu'il rend ; un tour
// fabriqué avec une note locale serait rejeté (`verifyReply`) — et surtout, ce
// n'en est pas un : c'est un repère purement local, pour l'écran seul.

interface CollectNoteCommon {
  id: string;
  /**
   * Le nombre de messages du fil au moment où la note est apparue — sert à la
   * replacer au bon endroit dans le fil affiché (voir `mergeTimeline`).
   */
  afterMessageCount: number;
  demarcheName: string;
}

/** Union discriminée par `kind` : `receipt` n'existe QUE sur un accusé — pas de `!` côté écran. */
export type CollectNote =
  | (CollectNoteCommon & { kind: "started" })
  | (CollectNoteCommon & { kind: "receipt"; receipt: DemandeReceipt });

function newNoteId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "note-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function startedNote(demarcheName: string, afterMessageCount: number): CollectNote {
  return { id: newNoteId(), afterMessageCount, kind: "started", demarcheName };
}

export function receiptNote(demarcheName: string, afterMessageCount: number, receipt: DemandeReceipt): CollectNote {
  return { id: newNoteId(), afterMessageCount, kind: "receipt", demarcheName, receipt };
}

/** Une entrée du fil affiché : un vrai message, ou une note locale insérée à sa place. */
export type TimelineEntry<M extends { id: string }> =
  | { kind: "message"; message: M }
  | { kind: "note"; note: CollectNote };

/**
 * Fusionne les messages du serveur et les notes locales dans l'ordre
 * d'apparition — pure, pour ne pas retenir cette règle dans le composant.
 */
export function mergeTimeline<M extends { id: string }>(
  messages: readonly M[],
  notes: readonly CollectNote[],
): TimelineEntry<M>[] {
  const byCount = new Map<number, CollectNote[]>();
  for (const note of notes) {
    const list = byCount.get(note.afterMessageCount) ?? [];
    list.push(note);
    byCount.set(note.afterMessageCount, list);
  }
  const entries: TimelineEntry<M>[] = [];
  for (const note of byCount.get(0) ?? []) entries.push({ kind: "note", note });
  messages.forEach((message, index) => {
    entries.push({ kind: "message", message });
    for (const note of byCount.get(index + 1) ?? []) entries.push({ kind: "note", note });
  });
  return entries;
}

// ── Persistance sessionStorage ───────────────────────────────────────────────
//
// ⚠️ Même motif que `conversation.ts` (lot 1) : `sessionStorage`, tolérant de
// bout en bout, une clé À PART de celle du fil — le recueil peut se terminer
// (et se purger) sans que la conversation, elle, se termine.

export const COLLECT_STORAGE_KEY = "nora.assistant.collect";

export interface StoredCollect {
  session: CollectSession | null;
  notes: CollectNote[];
}

export interface CollectStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseOrganization(raw: unknown): DemarcheOrganization | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  if (id === "" || name === "") return null;
  return {
    id,
    name,
    slug: typeof raw.slug === "string" ? raw.slug : null,
    logoUrl: typeof raw.logoUrl === "string" ? raw.logoUrl : null,
  };
}

function parseCollectDemarche(raw: unknown): CollectDemarche | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  if (id === "") return null;
  const form = parseFormSchema(raw.form);
  if (form === null) return null;
  const organizations = Array.isArray(raw.organizations)
    ? raw.organizations.map(parseOrganization).filter((o): o is DemarcheOrganization => o !== null)
    : [];
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    form,
    requester: parseRequesterConfig(raw.requester),
    organizations,
  };
}

function parseStoredSession(raw: unknown): CollectSession | null {
  if (!isRecord(raw)) return null;
  const demarche = parseCollectDemarche(raw.demarche);
  if (demarche === null) return null;
  const collection = sanitizeState(demarche.form, demarche.id, raw.collection);
  const organizationId = typeof raw.organizationId === "string" ? raw.organizationId : null;
  const requesterValues: Record<string, string> = {};
  if (isRecord(raw.requesterValues)) {
    for (const [key, value] of Object.entries(raw.requesterValues)) {
      if (typeof value === "string") requesterValues[key] = value;
    }
  }
  return {
    demarche,
    collection,
    organizationId,
    organizationConfirmed: raw.organizationConfirmed === true || !needsOrganizationChoice(demarche),
    audience: isAudience(raw.audience) ? raw.audience : null,
    requesterValues,
    identityConfirmed: raw.identityConfirmed === true || !needsIdentity(demarche),
  };
}

function parseStoredNote(raw: unknown): CollectNote | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const demarcheName = typeof raw.name === "string" ? raw.name : typeof raw.demarcheName === "string" ? raw.demarcheName : "";
  const afterMessageCount = typeof raw.afterMessageCount === "number" && Number.isFinite(raw.afterMessageCount)
    ? raw.afterMessageCount
    : -1;
  if (id === "" || afterMessageCount < 0 || (raw.kind !== "started" && raw.kind !== "receipt")) return null;
  if (raw.kind === "started") return { id, afterMessageCount, kind: "started", demarcheName };
  const receipt = raw.receipt;
  if (
    !isRecord(receipt) ||
    typeof receipt.reference !== "string" ||
    receipt.reference === "" ||
    typeof receipt.status !== "string"
  ) {
    return null;
  }
  return {
    id,
    afterMessageCount,
    kind: "receipt",
    demarcheName,
    receipt: { reference: receipt.reference, status: receipt.status, created: receipt.created === true },
  };
}

/** Lecture tolérante — une entrée illisible vaut « rien de rangé », jamais une exception. */
export function parseStoredCollect(raw: string | null): StoredCollect | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const session = parsed.session === null ? null : parseStoredSession(parsed.session);
  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.map(parseStoredNote).filter((n): n is CollectNote => n !== null)
    : [];
  return { session, notes };
}

/** Relit le recueil d'un onglet rechargé — tolérant de bout en bout, purge une entrée illisible. */
export function loadCollect(storage: CollectStorage): StoredCollect | null {
  let raw: string | null;
  try {
    raw = storage.getItem(COLLECT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = parseStoredCollect(raw);
  if (parsed === null) {
    try {
      storage.removeItem(COLLECT_STORAGE_KEY);
    } catch {
      // Tant pis : la prochaine lecture retentera la purge.
    }
  }
  return parsed;
}

/** Range le recueil, ou efface l'entrée tant qu'il n'y a rien à en garder. */
export function saveCollect(storage: CollectStorage, stored: StoredCollect): void {
  try {
    if (stored.session === null && stored.notes.length === 0) {
      storage.removeItem(COLLECT_STORAGE_KEY);
      return;
    }
    storage.setItem(COLLECT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Pas de mémoire : le recueil continue quand même dans cet onglet.
  }
}

/** Efface l'entrée — la même « Nouvelle conversation » que le fil. */
export function clearCollect(storage: CollectStorage): void {
  try {
    storage.removeItem(COLLECT_STORAGE_KEY);
  } catch {
    // Sans conséquence grave : le recueil est de toute façon vidé en mémoire.
  }
}
