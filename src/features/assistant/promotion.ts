/**
 * Quand proposer l'assistant dans les suggestions du champ de recherche.
 *
 * L'assistant n'a **pas de point d'entrée dédié** : il naît de la recherche de
 * l'accueil, au même endroit de l'écran, au moment de l'hésitation. Toute la
 * question est donc « à quel moment se montre-t-il, et avec quelle insistance ».
 *
 * ⚠️ **CALCULÉE, PAS FIXE.** Trois signaux : la longueur de la saisie, la
 * présence d'un verbe conjugué, et ce que l'index a trouvé. L'usager pressé qui
 * tape « acte de naissance » ne le voit qu'en pied de liste ; celui qui raconte
 * sa situation le trouve en tête. Une position fixe servirait mal l'un des deux.
 *
 * ⚠️ **AUCUN APPEL RÉSEAU ICI.** Rien ne part vers le guichet IA tant que
 * l'usager n'a pas activé l'assistant lui-même — ce module ne fait que décider
 * d'un affichage. C'est ce qui permet de l'évaluer à chaque frappe sans dépenser
 * le crédit de la collectivité.
 */

export type AssistantPriority =
  /** Rien à proposer : la saisie est trop courte pour vouloir dire quelque chose. */
  | "none"
  /** Une ligne discrète en pied de liste, après les démarches trouvées. */
  | "low"
  /** En tête du panneau, et action par défaut de la touche Entrée. */
  | "high";

/**
 * En deçà, une saisie ne dit rien de l'intention — deux lettres ne sont ni un
 * mot-clé ni une situation. Proposer l'assistant là serait du bruit à la
 * première frappe.
 */
const MIN_CHARS = 3;

/**
 * À partir d'ici, on ne tape plus un mot-clé : on écrit une phrase. Le seuil
 * vient du dossier de passation.
 */
const SENTENCE_WORDS = 5;

/**
 * Des formes conjuguées fréquentes, en français, sans analyseur grammatical.
 *
 * ⚠️ **Volontairement grossière, et volontairement PRUDENTE.** Le compte de mots
 * fait déjà l'essentiel du travail ; cette liste ne sert qu'à rattraper la phrase
 * courte mais parlée (« mon voisin brûle des déchets »). Un faux négatif est
 * bénin — l'assistant reste en pied de liste. Un faux positif le promeut devant
 * quelqu'un qui savait ce qu'il cherchait, ce qui est plus coûteux.
 *
 * ⚠️ `a` n'y est PAS, et ne doit jamais y entrer : sans accents, la préposition
 * « à » lui est identique, et « demande à la mairie » deviendrait une phrase.
 * Le cas « il y a » est rattrapé par `HAS_THERE_IS` ci-dessous.
 */
const CONJUGATED = new Set([
  "est", "sont", "etait", "etaient", "sera", "seront", "suis", "sommes", "etes",
  "ai", "avons", "avez", "ont", "avais", "avait",
  "fais", "fait", "faites", "faut", "fallait",
  "peux", "peut", "pouvez", "pourrais", "pourrait",
  "veux", "veut", "voulez", "voudrais", "voudrait",
  "dois", "doit", "devez", "devrais",
  "vais", "va", "allez",
  "cherche", "cherchez", "souhaite", "souhaiterais", "aimerais",
  "habite", "reside", "vis", "recois", "paye", "paie",
  "brule", "deborde", "penche", "coule", "bloque", "gene",
]);

/** « il y a » — la tournure la plus courante pour signaler quelque chose. */
const HAS_THERE_IS = /\bil y a\b/;

/** Minuscules, sans accents : de quoi comparer des mots d'usager. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(normalized: string): string[] {
  return normalized === "" ? [] : normalized.split(" ");
}

/** La saisie ressemble-t-elle à une phrase plutôt qu'à un mot-clé ? */
export function readsAsSentence(query: string): boolean {
  const normalized = normalize(query);
  const parts = words(normalized);
  if (parts.length >= SENTENCE_WORDS) return true;
  if (HAS_THERE_IS.test(normalized)) return true;
  return parts.some((word) => CONJUGATED.has(word));
}

/**
 * La place de l'assistant dans le panneau de suggestions.
 *
 * `matchCount` est ce que l'index a trouvé pour cette saisie — le nombre de
 * démarches du catalogue qui correspondent. ⚠️ **Zéro correspondance promeut
 * toujours**, quelle que soit la longueur : quand il n'y a littéralement rien
 * d'autre à montrer, l'assistant n'est plus une option parmi d'autres, c'est la
 * seule chose utile de l'écran.
 */
export function assistantPriority(query: string, matchCount: number): AssistantPriority {
  if (normalize(query).length < MIN_CHARS) return "none";
  if (matchCount === 0) return "high";
  return readsAsSentence(query) ? "high" : "low";
}
