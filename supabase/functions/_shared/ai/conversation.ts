/**
 * Ce qui encadre le modèle, des deux côtés — règles pures, testées sans réseau.
 *
 *  • AVANT : quelles démarches lui décrire (`pickCandidates`), quelle part du
 *    fil lui envoyer (`windowHistory`), et ce que le serveur décide SANS lui
 *    (`detectEmergency`).
 *  • APRÈS : lire sa réponse et ne rien en croire (`parseAssistantAnswer`).
 *
 * Doctrine reprise de Clara : le guichet garantit que la réponse PARSE ; c'est
 * l'appelant qui garantit qu'elle VEUT DIRE quelque chose. Un identifiant de
 * démarche rendu par le modèle n'est retenu que s'il est au catalogue publié de
 * CETTE collectivité — un identifiant inventé, ou celui d'une autre, tombe.
 */
import type { TurnMessage } from "../domain/assistantTurn.ts";
import type { Demarche } from "../domain/demarche.ts";

// --- Avant le modèle ---------------------------------------------------------

/** Minuscules, sans accents, sans ponctuation : de quoi comparer des mots d'usager. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mots trop communs pour dire quoi que ce soit d'une démarche. */
const STOP_WORDS = new Set(
  ("a au aux avec ce ces comment dans de des du elle en est et faire faut il je la le les ma mes mon " +
    "ne on ou par pas pour pourquoi puis que quel quelle qui sa se ses son sur un une vos votre vous y " +
    "bonjour merci svp demande demarche souhaite voudrais veux besoin").split(" "),
);

function tokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Les démarches à DÉCRIRE au modèle, par recouvrement de mots avec ce que dit
 * l'usager. Un préfixe commun de 5 lettres compte (« signaler » / « signalement »).
 *
 * ⚠️ Ce tri ne décide pas de ce que l'assistant peut proposer : le catalogue
 * ENTIER lui est donné en une ligne par démarche. Un usager ne parle pas comme
 * un intitulé (« dépôt sauvage » ≠ « Signaler un problème de propreté ») — le
 * tri lexical borne le coût du prompt, il ne doit pas borner la compréhension.
 * Un petit catalogue est donc décrit en entier.
 */
export function pickCandidates(catalogue: Demarche[], said: string, max = 8): Demarche[] {
  if (catalogue.length <= max) return catalogue;
  const words = tokens(said);
  const scored = catalogue.map((demarche, index) => {
    const name = tokens(demarche.name);
    const description = tokens(demarche.description ?? "");
    let score = 0;
    for (const word of words) {
      const stem = word.slice(0, 5);
      const near = (other: string) => other === word || (stem.length === 5 && other.startsWith(stem));
      if (name.some(near)) score += 3;
      else if (description.some(near)) score += 1;
    }
    return { demarche, score, index };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, max)
    .map((entry) => entry.demarche);
}

/**
 * La part du fil envoyée au modèle : les `max` derniers messages, en
 * commençant par un message de l'USAGER (une fenêtre qui s'ouvrirait sur une
 * réponse orpheline ferait parler l'assistant d'une question qu'il ne voit pas).
 * Le guichet plafonne à 24 messages ; on reste large en dessous.
 */
export function windowHistory(messages: TurnMessage[], max = 12): TurnMessage[] {
  const recent = messages.slice(-max);
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser <= 0 ? recent : recent.slice(firstUser);
}

const EMERGENCY_MARKERS = [
  "incendie", "au feu", "brule", "fuite de gaz", "odeur de gaz", "noyade", "inconscient",
  "ne respire", "hemorragie", "crise cardiaque", "avc", "suicide", "suicider", "me tuer",
  "en danger", "danger immediat", "agression", "agresse", "frappe", "violence conjugale",
  "menace de mort", "enfant en danger", "effondrement", "electrocut",
].map(normalizeText);

/**
 * L'usager décrit-il un danger immédiat ? Décidé sur SES mots, par le serveur :
 * l'affichage des numéros d'urgence ne dépend pas de l'humeur d'un modèle. Le
 * faux positif est bénin (une carte de numéros en trop), le faux négatif non —
 * d'où une liste large plutôt que fine.
 */
export function detectEmergency(said: string): boolean {
  const text = " " + normalizeText(said) + " ";
  return EMERGENCY_MARKERS.some((marker) => text.includes(" " + marker));
}

// --- Après le modèle ---------------------------------------------------------

export const ANSWER_INTENTS = ["answer", "suggest", "clarify", "unknown", "off_topic"] as const;
export type AnswerIntent = (typeof ANSWER_INTENTS)[number];

export interface AssistantAnswer {
  reply: string;
  intent: AnswerIntent;
  procedureIds: string[];
}

const MAX_REPLY_CHARS = 2000;
const MAX_SUGGESTIONS = 3;

/**
 * Retire tout lien d'une réponse. La consigne l'interdit déjà ; ceci le
 * GARANTIT. Un assistant qui parle sous la marque d'une collectivité et qui
 * peut afficher un lien est un outil d'hameçonnage : les seules destinations
 * qu'il propose sont des démarches du catalogue, rendues en cartes par l'écran
 * à partir d'identifiants revalidés — jamais une adresse écrite par le modèle.
 */
export function stripLinks(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\s*(?:https?:|mailto:|www\.)[^>]*>/gi, "")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** L'objet JSON d'une réponse, tolérant aux clôtures ```json et au texte autour. */
function extractJson(raw: string): unknown {
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [unfenced, unfenced.slice(unfenced.indexOf("{"), unfenced.lastIndexOf("}") + 1)]) {
    if (!candidate.startsWith("{")) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // essai suivant
    }
  }
  return null;
}

/**
 * Lit la réponse du modèle. `null` = illisible (l'appelant répond
 * « indisponible », il n'affiche jamais un texte brut non vérifié).
 */
export function parseAssistantAnswer(raw: string, catalogueIds: ReadonlySet<string>): AssistantAnswer | null {
  const parsed = extractJson(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  if (typeof source.reply !== "string") return null;
  const reply = stripLinks(source.reply).slice(0, MAX_REPLY_CHARS).trim();
  if (reply === "") return null;

  const procedureIds: string[] = [];
  for (const id of Array.isArray(source.procedure_ids) ? source.procedure_ids : []) {
    if (typeof id !== "string" || !catalogueIds.has(id) || procedureIds.includes(id)) continue;
    procedureIds.push(id);
    if (procedureIds.length === MAX_SUGGESTIONS) break;
  }

  const declared = ANSWER_INTENTS.find((intent) => intent === source.intent) ?? "answer";
  // L'intention suit ce qui a SURVÉCU à la revalidation : « suggest » sans
  // démarche retenue n'en est pas une, et une démarche retenue en est une.
  const intent: AnswerIntent =
    procedureIds.length > 0 ? (declared === "clarify" ? "clarify" : "suggest")
      : declared === "suggest" ? "answer" : declared;
  return { reply, intent, procedureIds };
}
