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
  MAX_TURNS_COLLECT,
  MAX_USER_MESSAGE_CHARS,
  maxTurnsFor,
  type AssistantFailure,
  type AssistantTurnReply,
  type TurnMessage,
} from "../domain/assistantTurn.ts";
import type { Demarche, DemarcheDetail } from "../domain/demarche.ts";
import type { FormValues } from "../domain/conditions.ts";
import { type ChoiceField, type Field, type FormSchema, isChoiceType } from "../domain/formSchema.ts";
import { isBlank, isFieldRequired, visibleFields } from "../domain/formulaire.ts";
import { parseLocationValue } from "../domain/location.ts";
import type { Tenant } from "../domain/tenant.ts";
import { verifySolution } from "./challenge.ts";
import {
  answerField,
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
import {
  type CityHint,
  cityReason,
  type CommuneEntry,
  matchCommune,
  type PostalHint,
  postalCityPairs,
  postalCodeIn,
  postalReason,
  readCityName,
  readPostalCode,
} from "./postalCity.ts";
import type { OrganismeInfo } from "../domain/organismeInfo.ts";
import { buildAssistantPrompt, type CollectableField } from "./prompt.ts";
import { issueTicket, readTicket, signReply, verifyReply, type Ticket } from "./signing.ts";
import type { SocleAiClient } from "./socleAi.ts";

/**
 * Au-delà, le navigateur envoie un fil que le serveur n'a aucune raison de lire.
 * Borné sur la plus haute des deux bornes : un recueil long a plus de messages.
 */
const MAX_MESSAGES_RECEIVED = 2 * MAX_TURNS_COLLECT;
const MAX_ASSISTANT_MESSAGE_CHARS = 4000;
/** Un message qui se termine par une question — guillemets et gras de fin compris. */
const ENDS_WITH_QUESTION = /[?？]\s*[*_»"”)\s]*$/;
const UUID_RE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TurnDeps {
  /** Secret de signature du portail (tickets, réponses, défis). */
  secret: string;
  ai: SocleAiClient;
  /** Catalogue PUBLIÉ de la collectivité — `null` si le Socle ne répond pas. */
  loadCatalogue(): Promise<Demarche[] | null>;
  /** Détail PUBLIC d'une démarche — `null` si elle n'est pas (ou plus) au catalogue. */
  loadDemarche(id: string): Promise<DemarcheDetail | null>;
  /**
   * Ce que les organismes ont écrit pour leurs usagers (descriptif, horaires,
   * FAQ) — `null` si le Socle ne répond pas. Facultatif, et ⚠️ jamais bloquant :
   * sans lui, l'assistant oriente comme avant et dit qu'il ne connaît pas les
   * horaires. Pas lu en recueil (le prompt ne l'enverrait pas).
   */
  loadOrganismes?(): Promise<OrganismeInfo[] | null>;
  nowSeconds(): number;
  newConversationId(): string;
  /**
   * Les communes d'un code postal, lues au référentiel officiel — `null` s'il
   * ne répond pas. Facultatif : sans lui, la ville se demande, c'est tout.
   * ⚠️ Seul le code postal sort d'ici : ni le message, ni l'adresse.
   */
  lookupCommunes?(postalCode: string): Promise<string[] | null>;
  /**
   * Le sens inverse : les codes postaux d'une commune, par son nom — `null`
   * si le référentiel ne répond pas. ⚠️ Seul un nom de commune sort d'ici,
   * sans le moindre chiffre (`readCityName`) : jamais une adresse.
   */
  lookupPostalCodes?(city: string): Promise<CommuneEntry[] | null>;
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
  if (field.type === "location") {
    const location = parseLocationValue(value);
    if (location === null) return null;
    return location.adjusted ? `${location.address} (emplacement précisé sur la carte)` : location.address;
  }
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

/**
 * La démarche que l'usager remplit dans la conversation — ou `null`.
 *
 * ⚠️ PREMIÈRE GARDE DU RECUEIL : l'interrupteur de la collectivité
 * (`depositEnabled`, réglé au Socle par son super administrateur). Fermé, un
 * `collection` envoyé par le navigateur est ignoré sans bruit : l'assistant
 * renseigne et oriente, il ne recueille rien.
 */
function collectionDemarcheId(tenant: Tenant, raw: unknown): string | null {
  if (!tenant.assistant.depositEnabled || !isRecord(raw)) return null;
  return typeof raw.demarcheId === "string" && UUID_RE.test(raw.demarcheId) ? raw.demarcheId : null;
}

/**
 * La ville que le code postal désigne — cherchée pour la première adresse dont
 * la ville manque encore.
 *
 * Le code postal vient de l'état s'il est déjà retenu ; sinon du DERNIER
 * message, à condition qu'il n'y ait qu'un nombre à cinq chiffres. C'est ce
 * second cas qui compte : le référentiel est interrogé AVANT le modèle, pour
 * que sa réponse dise « j'ai noté Nantes » au lieu de « et la ville ? » au
 * moment même où le serveur la renseigne.
 */
async function findCityHint(
  schema: FormSchema,
  state: CollectionState,
  heard: string,
  deps: TurnDeps,
): Promise<CityHint | null> {
  if (deps.lookupCommunes === undefined) return null;
  const pending = new Set(pendingFields(schema, state).map((field) => field.id));
  for (const { postal, city } of postalCityPairs(schema)) {
    if (!pending.has(city.id) || state.touched.includes(city.id)) continue;
    const postalCode = pending.has(postal.id)
      ? postalCodeIn(heard)
      : readPostalCode(state.values[postal.id]);
    if (postalCode === null) continue;
    const communes = await deps.lookupCommunes(postalCode);
    if (communes === null || communes.length === 0) return null;
    return { postalCode, cityFieldId: city.id, communes };
  }
  return null;
}

/**
 * Renseigner la ville, quand le référentiel n'en connaît qu'UNE pour le code
 * postal RETENU — pas pour celui qu'on a cru lire dans le message : si le
 * modèle n'a pas retenu ce code postal, il ne se passe rien.
 *
 * La valeur porte le badge « déduit » et sa raison : l'usager la relit au
 * récapitulatif, et la corrige d'un geste si le référentiel a tort pour lui.
 */
function fillCity(
  schema: FormSchema,
  state: CollectionState,
  hint: CityHint | null,
  lang: string,
): CollectionState {
  if (hint === null || hint.communes.length !== 1) return state;
  const pair = postalCityPairs(schema).find(({ city }) => city.id === hint.cityFieldId);
  if (pair === undefined) return state;
  const stillPending = pendingFields(schema, state).some((field) => field.id === pair.city.id);
  if (!stillPending || state.touched.includes(pair.city.id)) return state;
  if (readPostalCode(state.values[pair.postal.id]) !== hint.postalCode) return state;
  return answerField(schema, state, pair.city.id, hint.communes[0], {
    origin: "inferred",
    reason: cityReason(lang, hint.postalCode),
  });
}

/**
 * Le sens inverse : la commune dont le code postal manque encore — pour la
 * première adresse dont la ville est retenue et le code postal en attente.
 * `null` s'il n'y a rien à chercher, ou rien d'envoyable (`readCityName`).
 */
function cityToLookup(schema: FormSchema, state: CollectionState): { city: string; postalFieldId: string } | null {
  const pending = new Set(pendingFields(schema, state).map((field) => field.id));
  for (const { postal, city } of postalCityPairs(schema)) {
    if (!pending.has(postal.id) || pending.has(city.id) || state.touched.includes(postal.id)) continue;
    const name = readCityName(state.values[city.id]);
    if (name !== null) return { city: name, postalFieldId: postal.id };
  }
  return null;
}

/**
 * Les codes postaux de la commune retenue — cherchés au référentiel, par son
 * nom. Rien n'est deviné : sans commune de ce nom exact, ou avec deux
 * homonymes, `null` ; le code postal se demande.
 */
async function findPostalHint(
  schema: FormSchema,
  state: CollectionState,
  deps: TurnDeps,
): Promise<PostalHint | null> {
  if (deps.lookupPostalCodes === undefined) return null;
  const wanted = cityToLookup(schema, state);
  if (wanted === null) return null;
  const entries = await deps.lookupPostalCodes(wanted.city);
  if (entries === null) return null;
  const commune = matchCommune(entries, wanted.city);
  if (commune === null) return null;
  return { commune: commune.nom, postalFieldId: wanted.postalFieldId, codes: commune.codesPostaux };
}

/**
 * Renseigner le code postal, quand la commune n'en a qu'UN — pour la ville
 * RETENUE, revérifiée contre le nom que le référentiel a rendu. Même badge
 * « déduit », même raison lisible, même « Modifier » au récapitulatif.
 */
function fillPostal(
  schema: FormSchema,
  state: CollectionState,
  hint: PostalHint | null,
  lang: string,
): CollectionState {
  if (hint === null || hint.codes.length !== 1) return state;
  const pair = postalCityPairs(schema).find(({ postal }) => postal.id === hint.postalFieldId);
  if (pair === undefined) return state;
  const stillPending = pendingFields(schema, state).some((field) => field.id === pair.postal.id);
  if (!stillPending || state.touched.includes(pair.postal.id)) return state;
  const city = readCityName(state.values[pair.city.id]);
  if (city === null || matchCommune([{ nom: hint.commune, codesPostaux: hint.codes }], city) === null) return state;
  return answerField(schema, state, pair.postal.id, hint.codes[0], {
    origin: "inferred",
    reason: postalReason(lang, hint.commune),
  });
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
    ticket = {
      conversationId: deps.newConversationId(),
      tenantId: tenant.id,
      issuedAt: now,
      turn: 0,
      collecting: false,
    };
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

  // Les organismes : hors recueil seulement, et un Socle muet n'éteint pas
  // l'assistant — il ne connaîtra simplement pas les horaires ce tour-ci.
  const organismes =
    collection === null && deps.loadOrganismes !== undefined ? (await deps.loadOrganismes()) ?? [] : [];

  const said = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join(" ");
  const lastSaid = messages[messages.length - 1].content;
  // ⚠️ TOUT ce que l'usager a écrit dans la fenêtre envoyée au modèle — pas
  // seulement son dernier message. Constaté en test : « il y a des dépôts
  // d'ordure rue de la République », puis le recueil s'ouvre sur « Je voudrais
  // remplir … avec vous » — et l'assistant demande la rue, puis le type de
  // problème (« je l'ai déjà dit ! »). Une citation vérifiée contre le seul
  // dernier message rejetait tout ce qui avait été dit avant l'ouverture, et
  // un code postal donné deux messages plus tôt n'était jamais cherché.
  const history = windowHistory(messages);
  const heard = history.filter((m) => m.role === "user").map((m) => m.content).join(" ");

  // La ville que le code postal désigne. Si le code postal était DÉJÀ retenu
  // (tour précédent, ou saisi dans son contrôle), elle se renseigne tout de
  // suite : le modèle la lira « déjà renseigné » et ne la demandera pas.
  const cityHint =
    collection !== null && focus?.form != null
      ? await findCityHint(focus.form, collection, heard, deps)
      : null;
  if (collection !== null && focus?.form != null) {
    collection = fillCity(focus.form, collection, cityHint, lang);
  }
  // Et le sens inverse : la ville est retenue, le code postal manque. Une
  // commune à un seul code postal se renseigne avant le modèle ; à plusieurs,
  // le modèle les reçoit et demande lequel.
  const postalHint =
    collection !== null && focus?.form != null
      ? await findPostalHint(focus.form, collection, deps)
      : null;
  if (collection !== null && focus?.form != null) {
    collection = fillPostal(focus.form, collection, postalHint, lang);
  }

  // Restait-il de l'obligatoire AVANT ce tour ? C'est ce qui dit, plus bas, si
  // ce tour est celui qui ferme le recueil.
  const before = collection;
  const hadRequired =
    before !== null && focus?.form != null
      ? pendingFields(focus.form, before).some((field) => isFieldRequired(field, before.values))
      : false;

  const system = buildAssistantPrompt({
    tenantName: tenant.name,
    lang,
    catalogue,
    // Chercher les démarches proches n'a plus d'objet une fois qu'on en remplit
    // une : le prompt ne les enverrait pas (voir `buildAssistantPrompt`), et
    // `pickCandidates` balaie tout le catalogue pour rien.
    candidates: collection === null ? pickCandidates(catalogue, said) : [],
    focus,
    organismes,
    collecting:
      collection === null || focus?.form == null
        ? null
        : collectableFields(focus.form, collection),
    // Proposer de remplir n'a de sens que si la collectivité l'a ouvert et que
    // la démarche consultée a bien un formulaire.
    offering: tenant.assistant.depositEnabled && focus?.form != null,
    cityHint,
    postalHint,
  });

  const completion = await deps.ai.complete({
    organizationId: tenant.id,
    system,
    messages: history.map(({ role, content }) => ({ role, content })),
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
  //
  // ⚠️ `heard` sert à TRANCHER L'ORIGINE : « repris » n'est retenu que si la
  // citation figure vraiment dans ce que l'usager a écrit — dans ce message ou
  // plus haut. C'est le serveur qui en décide, jamais le modèle — sur les mots
  // réels, pas sur ce qu'il en dit.
  if (collection !== null && focus?.form != null) {
    const cityKnownBefore = cityToLookup(focus.form, collection) !== null;
    collection = applyUpdates(focus.form, collection, answer.fieldUpdates, heard).state;
    // Le modèle vient de retenir le code postal : la ville suit.
    collection = fillCity(focus.form, collection, cityHint, lang);
    // Ou la ville : le code postal suit, sans attendre le tour d'après — le
    // compteur de l'écran et le récapitulatif le montrent tout de suite. Un
    // seul appel de plus, et seulement quand la ville vient d'arriver.
    if (!cityKnownBefore && cityToLookup(focus.form, collection) !== null) {
      collection = fillPostal(focus.form, collection, await findPostalHint(focus.form, collection, deps), lang);
    }
  }

  // --- LE FILET. Le modèle ne demande rien, alors qu'il reste de l'obligatoire :
  // il s'est égaré (« Votre signalement est complet », constaté en test avec la
  // ville manquante). L'usager lirait une conversation finie sous un écran qui
  // attend encore — on redemande au modèle UNE fois, en lui disant pourquoi.
  //
  // ⚠️ Une seule fois, et sans rien casser : ce que la première réponse a fait
  // retenir RESTE retenu, et si le second appel échoue (quota, panne, json
  // illisible) ou s'égare autant, c'est la première réponse qui part. L'écran
  // garde son repli.
  // ⚠️ Ce second appel est facturé à la collectivité comme le premier. Il ne
  // consomme pas de tour : l'usager n'a parlé qu'une fois.
  let reply = answer.reply;
  let asked = answer.asking;
  if (collection !== null && focus?.form != null) {
    const form = focus.form;
    // ⚠️ L'AUTRE ÉGAREMENT, constaté juste après : « C'est noté : des déchets.
    // Depuis quand les avez-vous remarqués ? » — alors que cette réponse venait
    // de compléter la demande. L'écran passe aussitôt à l'identité ; la question
    // reste en l'air, sans personne pour y répondre ni champ où la ranger. Il
    // n'est relevé qu'au tour qui FERME le recueil : après, l'usager discute
    // librement sous son récapitulatif, et une question n'y gêne personne.
    const strayed = (
      state: CollectionState,
      wanted: readonly string[],
      text: string,
    ): "missing" | "complete" | null => {
      const left = pendingFields(form, state);
      if (left.some((field) => wanted.includes(field.id))) return null;
      if (left.some((field) => isFieldRequired(field, state.values))) return "missing";
      return hadRequired && ENDS_WITH_QUESTION.test(text) ? "complete" : null;
    };
    const fault = strayed(collection, asked, reply);
    if (fault !== null) {
      const second = await deps.ai.complete({
        organizationId: tenant.id,
        system: buildAssistantPrompt({
          tenantName: tenant.name,
          lang,
          catalogue,
          candidates: [],
          focus,
          collecting: collectableFields(form, collection),
          offering: false,
          correcting: fault,
        }),
        messages: windowHistory(messages).map(({ role, content }) => ({ role, content })),
        actorId: ticket.conversationId,
        procedureId: focus.id,
      });
      const retried =
        second.kind === "ok"
          ? parseAssistantAnswer(second.answer, new Set(catalogue.map((d) => d.id)))
          : null;
      if (retried !== null) {
        const next = applyUpdates(form, collection, retried.fieldUpdates, heard).state;
        if (strayed(next, retried.asking, retried.reply) === null) {
          collection = next;
          reply = retried.reply;
          asked = retried.asking;
        }
      }
    }
  }

  // Ce que le modèle dit DEMANDER — refiltré contre ce qui reste réellement à
  // renseigner, et APRÈS `applyUpdates` : ce qu'il vient de remplir n'est plus
  // une question. Un identifiant inventé, déjà répondu ou masqué tombe en
  // silence ; l'écran a son repli.
  const asking =
    collection !== null && focus?.form != null
      ? pendingFields(focus.form, collection)
          .filter((field) => asked.includes(field.id))
          .map((field) => field.id)
      : [];

  // L'offre de remplir. Elle n'existe que hors recueil (pendant, il est déjà
  // ouvert), que si la collectivité l'a ouvert, et que pour une démarche du
  // catalogue publié qui a vraiment un formulaire — sans quoi le bouton
  // mènerait à une impasse.
  const offered =
    collection === null && tenant.assistant.depositEnabled && answer.offerProcedureId !== null
      ? catalogue.find((d) => d.id === answer.offerProcedureId) ?? null
      : null;
  const offerDetail =
    offered === null
      ? null
      : offered.id === focus?.id
        ? focus
        : await deps.loadDemarche(offered.id);
  const collectOffer =
    offered !== null && offerDetail?.form != null ? { id: offered.id, name: offered.name } : null;

  const turn = ticket.turn + 1;
  // ⚠️ Le drapeau s'inscrit sur ce que le SERVEUR a constaté : `collection`
  // n'est non nul qu'après la démarche publiée, le formulaire présent et le
  // dépôt ouvert par la collectivité. Et il ne redescend jamais — un recueil
  // abandonné au tour 25 ne doit pas fermer la conversation dans la seconde.
  const collecting = ticket.collecting || collection !== null;
  return {
    ok: true,
    reply: {
      ticket: await issueTicket(deps.secret, { ...ticket, turn, collecting }),
      message: {
        role: "assistant",
        content: reply,
        signature: await signReply(deps.secret, ticket.conversationId, reply),
      },
      // ⚠️ AUCUNE suggestion pendant un recueil. La démarche est choisie, et
      // c'est elle qu'on remplit : sa carte se répétait sous CHAQUE réponse,
      // avec un bouton « Remplir cette démarche ici » qui ne menait nulle part
      // puisqu'on y était déjà. Le modèle n'a plus le catalogue sous les yeux,
      // mais il lit l'identifiant de la démarche consultée et le recopiait.
      suggestions:
        collection !== null
          ? []
          : answer.procedureIds.map((id) => {
              const demarche = catalogue.find((d) => d.id === id)!;
              return { id: demarche.id, name: demarche.name, description: demarche.description };
            }),
      emergency: detectEmergency(lastSaid),
      turnsLeft: maxTurnsFor(collecting) - turn,
      collection,
      asking,
      collectOffer,
    },
  };
}
