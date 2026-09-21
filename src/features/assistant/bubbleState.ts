/**
 * L'état d'OUVERTURE de la bulle — rien d'autre. La conversation, elle, vit
 * déjà dans `nora.assistant` et `nora.assistant.collect` : c'est ce qui permet
 * de fermer la bulle, de naviguer, de revenir, et de retrouver le fil intact.
 *
 * ⚠️ `sessionStorage`, jamais `localStorage`. C'est la troisième et dernière
 * clé que le portail écrit sur le poste du visiteur, au même régime que les
 * deux autres : le temps de l'onglet, et rien de plus. La bulle n'est comptée
 * dans aucune mesure d'audience — l'absence de stockage de mesure, et donc
 * l'absence de bandeau de consentement, reste vraie.
 */
import type { CollectStep } from "./collect.ts";

const KEY = "nora.assistant.ui";

export interface BubbleUi {
  open: boolean;
  /** La démarche depuis laquelle la bulle a été ouverte, s'il y en a une. */
  focusDemarcheId: string | null;
}

export const CLOSED: BubbleUi = { open: false, focusDemarcheId: null };

/**
 * Au doute, FERMÉ. Une clé abîmée, un stockage refusé (navigation privée,
 * données de site bloquées) : la bulle ne s'ouvre pas toute seule. S'ouvrir
 * sans que personne ne l'ait demandé serait le pire défaut d'un tel objet.
 */
export function readBubbleUi(raw: unknown): BubbleUi {
  if (typeof raw !== "object" || raw === null) return CLOSED;
  const source = raw as Record<string, unknown>;
  if (source.open !== true) return CLOSED;
  const focus = source.focusDemarcheId;
  return { open: true, focusDemarcheId: typeof focus === "string" && focus !== "" ? focus : null };
}

export function bubbleUiKey(): string {
  return KEY;
}

/**
 * La largeur que le panneau doit prendre pour l'étape en cours.
 *
 * Le récapitulatif relit tout le formulaire, et la carte d'identité aligne
 * plusieurs champs : à l'étroit, ils se lisent mal et se corrigent encore
 * moins bien. Le panneau s'élargit donc pour ces moments-là, et se resserre
 * ensuite — c'est le cadre qui s'adapte, jamais le contenu qui se recroqueville.
 */
export function panelSize(step: CollectStep | null): "compact" | "large" {
  return step === "identity" || step === "recap" ? "large" : "compact";
}
