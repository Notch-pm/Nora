/**
 * Ce que la collectivité écrit POUR SES USAGERS sur une démarche : délai de
 * traitement, précision sur le public, pièces annoncées, questions fréquentes.
 * Servi par le Socle en `user_communication` sur le détail d'une démarche
 * (contrat 1.24.0), étape « Communication usager » du paramétrage.
 *
 * Miroir EN LECTURE de `Socle/src/features/procedures/userCommunication.ts`,
 * qui possède le schéma — même motif que `formSchema.ts` et
 * `requesterConfig.ts`. Il s'en écarte là où un écran d'édition et une page
 * publique n'ont pas les mêmes besoins : le Socle garde une ligne à moitié
 * écrite pour ne pas la faire disparaître pendant la saisie ; le portail
 * n'affiche que ce qui se lit.
 *
 * ⚠️ **RIEN D'ÉCRIT = RIEN D'AFFICHÉ.** Les défauts de cette colonne sont
 * VIDES — à l'inverse de `communication_config`, dont un `null` se lit
 * « visible ». Un `null`, un bloc absent ou abîmé donnent un bloc vide, et
 * l'écran n'affiche pas la section. On ne compose aucun texte à la place de la
 * collectivité : ce serait publier en son nom ce qu'elle n'a pas dit.
 *
 * ⚠️ **LE DESCRIPTIF N'EST PAS ICI** : c'est `user_description`, servi à côté,
 * lu par `demarcheService.ts`.
 *
 * ⚠️ **PAS DE TRADUCTION** : ces textes n'ont pas d'entrée dans `translations`
 * au Socle. Ils sont en français quelle que soit la langue servie — l'écran les
 * marque `lang="fr"` (RGAA 8.7) —, et ne passent PAS par `localizedText`.
 *
 * Module PUR : pas de Deno, pas de réseau.
 */

/** Les unités du Socle, telles qu'il les écrit. */
export type ResponseDelayUnit = "jour_ouvre" | "jour" | "semaine" | "mois";

const UNITS: readonly ResponseDelayUnit[] = ["jour_ouvre", "jour", "semaine", "mois"];

/** Au-delà, le Socle refuse la saisie : ce ne serait plus un délai. */
const MAX_DELAY = 999;

/**
 * Combien de temps la collectivité met à RÉPONDRE.
 *
 * ⚠️ **TROIS DURÉES, aucune ne se déduit d'une autre** :
 *   · `Demarche.estimatedMinutes` — le temps pour REMPLIR le formulaire ;
 *   · celle-ci — le temps pour obtenir une RÉPONSE ;
 *   · la période de publication — entre quelles dates la démarche est
 *     proposée (le Socle l'applique, le portail n'en voit que l'effet).
 * Les deux premières s'affichent côte à côte : c'est là qu'on se trompe.
 */
export interface ResponseDelay {
  /** Entier de 1 à 999. ⚠️ `0` n'existe pas : ce serait promettre une réponse immédiate. */
  value: number;
  /** ⚠️ Toujours celle de la donnée, jamais déduite du nombre. */
  unit: ResponseDelayUnit;
}

/**
 * Une pièce ANNONCÉE à l'usager.
 *
 * ⚠️ **CE N'EST PAS UNE PIÈCE À TÉLÉVERSER.** Celles-là sont les champs
 * `attachment` du formulaire (`DemarcheDetail.form`), servis sur le même
 * détail. L'annonce peut les recouper — on n'annonce pas une pièce comme on la
 * collecte — et porter ce qui ne se dépose pas en ligne : un original à
 * présenter, un chèque de caution. Les CONCATÉNER afficherait deux fois la même
 * pièce ; n'afficher que l'annonce en cacherait certaines du dépôt. L'annonce
 * habille la présentation, le formulaire construit la saisie.
 */
export interface AnnouncedPiece {
  label: string;
  /** Précision facultative (« De moins de trois mois »), `null` si aucune. */
  description: string | null;
}

/**
 * Une question d'usager et sa réponse.
 *
 * ⚠️ **LA FAQ USAGER, pas celle de l'agent.** Le Socle en tient une seconde
 * (`knowledge_base.faq`), écrite pour l'agent et son assistant : elle ne
 * traverse jamais vers le portail, et n'a rien à faire ici.
 */
export interface UserFaqEntry {
  question: string;
  answer: string;
}

export interface UserCommunication {
  /** `null` = aucun délai annoncé. */
  responseDelay: ResponseDelay | null;
  /**
   * Une PHRASE sur le public concerné (« Réservée aux associations
   * déclarées… »), `null` si aucune.
   *
   * ⚠️ **NE FILTRE RIEN.** Le filtre « Je suis… » reste `Demarche.audiences`,
   * et en cas de contradiction c'est lui qui fait foi : une note qui dit
   * « réservée aux résidents » ne retire la démarche d'aucun public.
   */
  audienceNote: string | null;
  announcedPieces: AnnouncedPiece[];
  faq: UserFaqEntry[];
}

/** Ce que vaut une démarche dont la collectivité n'a rien écrit pour l'usager. */
export function emptyUserCommunication(): UserCommunication {
  return { responseDelay: null, audienceNote: null, announcedPieces: [], faq: [] };
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function block(raw: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = raw[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function entries(raw: Record<string, unknown> | null): Record<string, unknown>[] {
  const items = raw?.items;
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

/**
 * Le délai, ou `null`.
 *
 * ⚠️ Plus strict que le Socle, et c'est voulu : son éditeur retombe sur `jour`
 * devant une unité inconnue (il faut bien pré-remplir un sélecteur) ; une page
 * publique, elle, n'invente pas d'unité. Une unité que ce portail ne connaît
 * pas — un Socle plus récent qui aurait appris les heures — fait taire le
 * délai plutôt que d'afficher « 48 jours » pour quarante-huit heures. Même
 * règle pour la valeur : un entier de 1 à 999, pas une chaîne, pas `0`.
 */
function toResponseDelay(raw: Record<string, unknown> | null): ResponseDelay | null {
  if (raw === null) return null;
  const value = raw.processingTimeValue;
  const unit = raw.processingTimeUnit;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_DELAY) {
    return null;
  }
  if (!UNITS.includes(unit as ResponseDelayUnit)) return null;
  return { value, unit: unit as ResponseDelayUnit };
}

/**
 * Lecture tolérante, BLOC PAR BLOC : un bloc abîmé est vide sans emporter ses
 * voisins. Une pièce sans intitulé, une question sans réponse (ou l'inverse)
 * sont écartées — le Socle refuse de les enregistrer, mais une puce orpheline
 * ou une question restée en l'air n'ont rien à faire sur une page publique si
 * l'une passait quand même.
 */
export function parseUserCommunication(raw: unknown): UserCommunication {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return emptyUserCommunication();
  }
  const root = raw as Record<string, unknown>;

  const announcedPieces: AnnouncedPiece[] = [];
  for (const item of entries(block(root, "attachments"))) {
    const label = text(item.label);
    if (label !== null) announcedPieces.push({ label, description: text(item.description) });
  }

  const faq: UserFaqEntry[] = [];
  for (const item of entries(block(root, "faq"))) {
    const question = text(item.question);
    const answer = text(item.answer);
    if (question !== null && answer !== null) faq.push({ question, answer });
  }

  return {
    responseDelay: toResponseDelay(block(root, "delays")),
    audienceNote: text(block(root, "audience")?.note),
    announcedPieces,
    faq,
  };
}
