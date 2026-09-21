/**
 * Un tour de conversation, de bout en bout — la « boucle d'agent » du portail.
 *
 * Le guichet IA refuse les outils : l'assistant n'agit donc sur RIEN. Ce
 * fichier est une boucle déterministe autour d'une sortie JSON — il décide ce
 * que le modèle lit, et ne croit rien de ce qu'il rend. Le modèle propose ; le
 * serveur dispose ; et c'est l'usager qui dépose, par le formulaire de la
 * démarche proposée.
 *
 * L'ordre des vérifications suit ce qu'elles coûtent : tout ce qui se refuse
 * sans réseau est refusé avant de lire le catalogue, et rien n'atteint le
 * guichet (donc le crédit de la collectivité) qui n'ait passé tout le reste.
 *
 * Aucun accès réseau ici : le catalogue, le guichet et l'horloge sont reçus en
 * paramètre. `portal-api` fournit les vrais, les tests fournissent des faux.
 */
import {
  MAX_TURNS,
  MAX_USER_MESSAGE_CHARS,
  type AssistantFailure,
  type AssistantTurnReply,
  type TurnMessage,
} from "../domain/assistantTurn.ts";
import type { Demarche, DemarcheDetail } from "../domain/demarche.ts";
import type { FormValues } from "../domain/conditions.ts";
import { type ChoiceField, type Field, type FormSchema, isChoiceType } from "../domain/formSchema.ts";
import { isBlank, isFieldRequired, visibleFields } from "../domain/formulaire.ts";
import type { Tenant } from "../domain/tenant.ts";
import { verifySolution } from "./challenge.ts";
import {
  applyUpdates,
  type CollectionState,
  isConversationField,
  pendingFields,
  sanitizeState,
} from "./collection.ts";
import {
  detectEmergency,
  parseAssistantAnswer,
  pickCandidates,
  windowHistory,
} from "./conversation.ts";
import { buildAssistantPrompt, type CollectableField } from "./prompt.ts";
import { issueTicket, readTicket, signReply, verifyReply, type Ticket } from "./signing.ts";
import type { SocleAiClient } from "./socleAi.ts";

/** Au-delà, le navigateur envoie un fil que le serveur n'a aucune raison de lire. */
const MAX_MESSAGES_RECEIVED = 2 * MAX_TURNS;
const MAX_ASSISTANT_MESSAGE_CHARS = 4000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TurnDeps {
  /** Secret de signature du portail (tickets, réponses, défis). */
  secret: string;
  ai: SocleAiClient;
  /** Catalogue PUBLIÉ de la collectivité — `null` si le Socle ne répond pas. */
  loadCatalogue(): Promise<Demarche[] | null>;
  /** Détail PUBLIC d'une démarche — `null` si elle n'est pas (ou plus) au catalogue. */
  loadDemarche(id: string): Promise<DemarcheDetail | null>;
  nowSeconds(): number;
  newConversationId(): string;
}

export type TurnOutcome =
  | { ok: true; reply: AssistantTurnReply }
  | { ok: false; reason: AssistantFailure; retryAfterSeconds?: number; message?: string };

const fail = (reason: AssistantFailure): TurnOutcome => ({ ok: false, reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Le fil tel que le navigateur l'envoie — forme seulement ; les signatures viennent après. */
function readMessages(raw: unknown): TurnMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES_RECEIVED) return null;
  const messages: TurnMessage[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.content !== "string") return null;
    const content = entry.content.trim();
    if (content === "") return null;
    if (entry.role === "user") {
      if (content.length > MAX_USER_MESSAGE_CHARS) return null;
      messages.push({ role: "user", content });
    } else if (entry.role === "assistant") {
      // ⚠️ `role: "system"` n'existe pas ici — et tout autre rôle non plus.
      if (content.length > MAX_ASSISTANT_MESSAGE_CHARS || typeof entry.signature !== "string") return null;
      messages.push({ role: "assistant", content, signature: entry.signature });
    } else {
      return null;
    }
  }
  return messages[messages.length - 1].role === "user" ? messages : null;
}

/**
 * La démarche que l'usager remplit dans la conversation — ou `null`.
 *
 * ⚠️ PREMIÈRE GARDE DU RECUEIL : l'interrupteur de la collectivité
 * (`depositEnabled`, réglé au Socle par son super administrateur). Fermé, un
 * `collection` envoyé par le navigateur est ignoré sans bruit : l'assistant
 * renseigne et oriente, il ne recueille rien.
 */
/**
 * La réponse déjà donnée, telle que le modèle peut la relire.
 *
 * ⚠️ Une PIÈCE JOINTE ne rend rien : ni son nom, ni son identifiant de dépôt.
 * Un fichier ne se décrit pas à un modèle de langage — c'est la seule ligne
 * qui l'empêche, maintenant que les autres réponses lui sont montrées.
 */
function writtenValue(field: Field, values: FormValues): string | null {
  if (field.type === "attachment") return null;
  const value = values[field.id];
  if (isBlank(value)) return null;
  if (typeof value === "boolean") return value ? "oui" : "non";
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string").join(", ");
  return typeof value === "string" ? value : String(value);
}

/**
 * Le formulaire tel que le modèle le lit : tout ce qui est visible, dans
 * l'ordre, avec ce qui a déjà été répondu — de quoi accuser réception et ne
 * pas redemander deux fois la même chose.
 */
function collectableFields(schema: FormSchema, state: CollectionState): CollectableField[] {
  const pending = new Set(pendingFields(schema, state).map((field) => field.id));
  return visibleFields(schema, state.values).map((field) => ({
    id: field.id,
    label: field.label,
    help: field.help ?? null,
    required: isFieldRequired(field, state.values),
    written: isConversationField(field),
    options: isChoiceType(field.type) ? (field as ChoiceField).options : null,
    value: writtenValue(field, state.values),
    pending: pending.has(field.id),
    skipped: state.skipped.includes(field.id),
  }));
}

function collectionDemarcheId(tenant: Tenant, raw: unknown): string | null {
  if (!tenant.assistant.depositEnabled || !isRecord(raw)) return null;
  return typeof raw.demarcheId === "string" && UUID_RE.test(raw.demarcheId) ? raw.demarcheId : null;
}

export async function runAssistantTurn(
  tenant: Tenant,
  lang: string,
  body: unknown,
  deps: TurnDeps,
): Promise<TurnOutcome> {
  // L'interrupteur de la collectivité, réglé au Socle. Premier refus, parce
  // que c'est le seul qui ne dépende de rien d'autre.
  if (!tenant.assistant.enabled) return fail("assistant_closed");
  if (!isRecord(body)) return fail("bad_request");

  const messages = readMessages(body.messages);
  if (messages === null) return fail("bad_request");
  const focusId =
    typeof body.focusDemarcheId === "string" && UUID_RE.test(body.focusDemarcheId)
      ? body.focusDemarcheId
      : null;

  // --- Qui parle : un ticket du serveur, ou un défi résolu pour en obtenir un.
  const now = deps.nowSeconds();
  let ticket: Ticket;
  if (body.ticket !== undefined) {
    const reading = await readTicket(deps.secret, body.ticket, tenant.id, now);
    if (!reading.ok) {
      // Falsifié ou périmé : le défi rouvre une conversation. Épuisé : non —
      // repasser le défi rendrait la borne de tours décorative.
      return fail(reading.reason === "exhausted" ? "conversation_ended" : "challenge_required");
    }
    ticket = reading.ticket;
  } else {
    if (!(await verifySolution(deps.secret, body.challenge, now))) return fail("challenge_required");
    // Une conversation qui S'OUVRE n'a pas de passé : un fil déjà rempli,
    // présenté avec un défi tout neuf, est un fil fabriqué.
    if (messages.length !== 1) return fail("bad_request");
    ticket = { conversationId: deps.newConversationId(), tenantId: tenant.id, issuedAt: now, turn: 0 };
  }

  // --- Le fil : chaque réponse « assistant » doit être une des NÔTRES, dans
  // CETTE conversation. C'est ce qui empêche de faire croire au modèle qu'il a
  // déjà accepté de sortir de son rôle.
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (!(await verifyReply(deps.secret, ticket.conversationId, message.content, message.signature))) {
      return fail("bad_request");
    }
  }

  // --- Ce que le modèle va lire : du public, et rien d'autre.
  const catalogue = await deps.loadCatalogue();
  if (catalogue === null) return fail("assistant_unavailable");
  // Une démarche « consultée » qui n'est pas au catalogue publié n'existe pas
  // pour l'assistant — on l'ignore sans bruit, comme le portail le ferait.
  //
  // EN RECUEIL, la démarche consultée est celle que l'usager remplit : c'est
  // elle qui fait foi, pas `focusDemarcheId`.
  const collectId = collectionDemarcheId(tenant, body.collection);
  const wantedId = collectId ?? focusId;
  const focus =
    wantedId !== null && catalogue.some((d) => d.id === wantedId) ? await deps.loadDemarche(wantedId) : null;

  // Le recueil n'existe que si la démarche a un formulaire, et qu'elle est
  // toujours au catalogue publié. Sinon on l'ignore : l'assistant renseigne.
  let collection: CollectionState | null =
    collectId !== null && focus !== null && focus.form !== null
      ? sanitizeState(focus.form, focus.id, body.collection)
      : null;

  const said = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join(" ");
  const lastSaid = messages[messages.length - 1].content;
  const system = buildAssistantPrompt({
    tenantName: tenant.name,
    lang,
    catalogue,
    candidates: pickCandidates(catalogue, said),
    focus,
    collecting:
      collection === null || focus?.form == null
        ? null
        : collectableFields(focus.form, collection),
  });

  const completion = await deps.ai.complete({
    organizationId: tenant.id,
    system,
    messages: windowHistory(messages).map(({ role, content }) => ({ role, content })),
    actorId: ticket.conversationId,
    procedureId: focus?.id ?? null,
  });
  switch (completion.kind) {
    case "quota_exceeded":
      return { ok: false, reason: "assistant_quota_exceeded", message: completion.message ?? undefined };
    case "rate_limited":
      return { ok: false, reason: "assistant_rate_limited", retryAfterSeconds: completion.retryAfterSeconds };
    case "not_configured":
      return fail("assistant_not_configured");
    case "unavailable":
      return fail("assistant_unavailable");
  }

  // --- Ce que le modèle a rendu : on n'en croit rien.
  const answer = parseAssistantAnswer(completion.answer, new Set(catalogue.map((d) => d.id)));
  if (answer === null) return fail("assistant_unavailable");

  // Ce que le modèle dit avoir compris n'entre que par `applyUpdates` : champ
  // en attente, auquel on répond en écrivant, valeur valide. Le reste tombe.
  if (collection !== null && focus?.form != null) {
    collection = applyUpdates(focus.form, collection, answer.fieldUpdates).state;
  }

  const turn = ticket.turn + 1;
  return {
    ok: true,
    reply: {
      ticket: await issueTicket(deps.secret, { ...ticket, turn }),
      message: {
        role: "assistant",
        content: answer.reply,
        signature: await signReply(deps.secret, ticket.conversationId, answer.reply),
      },
      suggestions: answer.procedureIds.map((id) => {
        const demarche = catalogue.find((d) => d.id === id)!;
        return { id: demarche.id, name: demarche.name, description: demarche.description };
      }),
      emergency: detectEmergency(lastSaid),
      turnsLeft: MAX_TURNS - turn,
      collection,
    },
  };
}
