/**
 * Ce qu'un VISITEUR lit quand un tour de l'assistant échoue — même doctrine
 * que `src/features/portal/errorMessages.ts` (logique pure, séparée de
 * l'écran) : un message NEUTRE, jamais culpabilisant, qui rappelle que les
 * démarches restent accessibles sans l'assistant.
 *
 * ⚠️ PLUSIEURS CODES PARTAGENT UN MÊME TEXTE (`GROUP`) : du point de vue de
 * l'usager, « le guichet IA n'a pas de fournisseur configuré » et « le guichet
 * ne répond pas » se valent — les deux disent « indisponible, réessayez ». Ce
 * qui les distingue (`RETRYABLE`) reste séparé du texte, comme côté portail :
 * mettre un comportement dans une traduction en ferait une décision de
 * traducteur.
 */
import { t } from "@/i18n/t.ts";
import type { StringKey } from "@/i18n/strings.ts";
import type { AssistantClientFailure } from "@/services/portal/portalClient.ts";
import type { ConversationFailure } from "./conversation.ts";

export interface AssistantErrorMessage {
  title: string;
  detail: string;
  /** Un nouvel essai a une chance d'aboutir : l'écran propose de réessayer. */
  retryable: boolean;
}

type Group = "generic" | "quota" | "rateLimited" | "ended" | "badRequest";

/**
 * `assistant_closed` est ici par prudence : la page ferme déjà l'assistant
 * AVANT toute requête dès que `tenant.assistant.enabled` est faux (voir
 * `AssistantPage.tsx`), ce code ne devrait donc jamais atteindre l'écran. Le
 * couvrir coûte une ligne et évite un message vide le jour d'une course
 * (l'interrupteur bascule pendant que l'onglet reste ouvert).
 *
 * `challenge_required` de même : une réouverture automatique le rattrape
 * (voir `useAssistantConversation.ts`) ; s'il ressort quand même, un message
 * générique vaut mieux qu'un écran muet.
 */
const GROUP: Record<AssistantClientFailure, Group> = {
  assistant_closed: "generic",
  assistant_not_configured: "generic",
  assistant_unavailable: "generic",
  assistant_quota_exceeded: "quota",
  assistant_rate_limited: "rateLimited",
  challenge_required: "generic",
  conversation_ended: "ended",
  bad_request: "badRequest",
  not_configured: "generic",
  network: "generic",
};

/** Réessayer a un sens pour une panne transitoire — jamais pour un quota, un fil clos ou un message refusé. */
const RETRYABLE: Record<AssistantClientFailure, boolean> = {
  assistant_closed: false,
  assistant_not_configured: false,
  assistant_unavailable: true,
  assistant_quota_exceeded: false,
  assistant_rate_limited: true,
  challenge_required: false,
  conversation_ended: false,
  bad_request: false,
  not_configured: false,
  network: true,
};

const KEYS: Record<Group, { title: StringKey; detail: StringKey }> = {
  generic: { title: "assistant.error.generic.title", detail: "assistant.error.generic.detail" },
  quota: { title: "assistant.error.quota.title", detail: "assistant.error.quota.detail" },
  rateLimited: { title: "assistant.error.rateLimited.title", detail: "assistant.error.rateLimited.detail" },
  ended: { title: "assistant.error.ended.title", detail: "assistant.error.ended.detail" },
  badRequest: { title: "assistant.error.badRequest.title", detail: "assistant.error.badRequest.detail" },
};

/**
 * `not_configured` réutilise le message d'exploitation du portail
 * (`error.not_configured.*`, français seul) : c'est exactement la même
 * cause — `VITE_PORTAL_API_URL` absent — et il ne devrait jamais s'afficher
 * en production.
 */
export function assistantErrorMessage(failure: ConversationFailure, lang: string): AssistantErrorMessage {
  const { reason, retryAfterSeconds } = failure;
  if (reason === "not_configured") {
    return {
      title: t(lang, "error.not_configured.title"),
      detail: t(lang, "error.not_configured.detail"),
      retryable: false,
    };
  }
  const group = GROUP[reason];
  const keys = KEYS[group];
  const detail =
    group === "rateLimited"
      ? typeof retryAfterSeconds === "number"
        ? t(lang, keys.detail, { seconds: retryAfterSeconds })
        : t(lang, "assistant.error.rateLimited.detailGeneric")
      : t(lang, keys.detail);
  return { title: t(lang, keys.title), detail, retryable: RETRYABLE[reason] };
}
