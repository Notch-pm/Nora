/**
 * Une réponse de l'assistant, rendue PRONONÇABLE — ce que le guichet de
 * synthèse reçoit en mode dialogue.
 *
 * L'assistant écrit pour l'écran (Markdown léger : gras, listes courtes) ; une
 * voix qui lirait « astérisque astérisque » ou « tiret » ne serait plus une
 * voix d'accueil. On garde les mots, on retire la mise en forme, et chaque
 * ligne, chaque élément de liste, devient une phrase — c'est la ponctuation qui
 * fait les pauses à l'oral.
 *
 * ⚠️ Le TEXTE prononcé est celui qui s'affiche, et rien d'autre : ce module
 * retire, il n'ajoute ni ne reformule. C'est ce qui permet de ne faire lire que
 * des réponses SIGNÉES par le serveur — la signature porte sur l'écrit, et la
 * voix en est une transformation déterministe.
 *
 * Module PUR, testé.
 */
import { inlineText, parseMarkdown, type Block } from "../domain/markdown.ts";
import { stripLinks } from "./conversation.ts";

/** La borne du guichet de synthèse (`MAX_SPEECH_CHARS` au Socle). */
export const MAX_SPOKEN_CHARS = 2000;

/** Une ligne qui finit déjà sur une ponctuation forte ne reçoit pas de point. */
const ENDS_SENTENCE = /[.!?…:;？！。][\s"»”)\]]*$/;

/** Une phrase : nettoyée, ponctuée — `""` s'il n'y reste aucun mot (une puce vide, un « - »). */
function sentence(text: string): string {
  const clean = scrub(text);
  if (!/[\p{L}\p{N}]/u.test(clean)) return "";
  return ENDS_SENTENCE.test(clean) ? clean : clean + ".";
}

function blockSentences(block: Block): string[] {
  switch (block.kind) {
    case "heading":
      return [sentence(inlineText(block.children))];
    case "paragraph":
    case "quote":
      return block.lines.map((line) => sentence(inlineText(line)));
    case "list":
      return block.items.map((item) => sentence(inlineText(item)));
  }
}

/**
 * Ce qui reste une fois les balises tombées : émojis (une voix ne les dit pas),
 * restes de Markdown que le parseur aurait laissés passer (un `**` orphelin).
 */
function scrub(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[*_`#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Coupe à la borne, sur la dernière fin de phrase qui y tient. */
function bounded(text: string): string {
  if (text.length <= MAX_SPOKEN_CHARS) return text;
  const head = text.slice(0, MAX_SPOKEN_CHARS);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  return cut > 0 ? head.slice(0, cut + 1) : head.trim();
}

/** Le texte à prononcer — `""` s'il ne reste rien à dire. */
export function speakable(content: string): string {
  const sentences = parseMarkdown(stripLinks(content)).flatMap(blockSentences).filter(Boolean);
  return bounded(sentences.join(" "));
}
