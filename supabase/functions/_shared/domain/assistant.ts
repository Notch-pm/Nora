/**
 * L'assistant conversationnel du portail — ce que la collectivité a OUVERT.
 *
 * Miroir du bloc `assistant` de `GET /v1/portal/tenant` (contrat 1.28.0 du
 * Socle ; `voice_enabled` depuis 1.37.0). Le réglage n'appartient pas au portail : il est posé par le super
 * administrateur du Socle, sur la collectivité, et prend effet sans publication
 * du site. Le portail le LIT, il ne le décide pas.
 *
 * ⚠️ **Au doute, fermé.** Un Socle d'avant 1.28.0 ne sert pas ce champ, une
 * réponse peut être abîmée : l'assistant dépense le crédit IA de la collectivité,
 * et ce n'est pas au portail de l'ouvrir sur une lecture incertaine. Seul un
 * `true` littéral ouvre quelque chose.
 *
 * ⚠️ Le Socle applique déjà le commutateur à sa frontière (`deposit_enabled`
 * et `voice_enabled` n'y sortent `true` que sous un assistant ouvert). Le portail le réapplique quand
 * même : c'est lui qui laisserait un usager remplir un formulaire par la
 * conversation, il ne suspend pas ce droit à la discipline d'un autre dépôt.
 */
export interface PortalAssistant {
  /** L'assistant est proposé sur le site : il renseigne et oriente. */
  enabled: boolean;
  /** Il peut en outre recueillir les réponses d'un formulaire dans la conversation. */
  depositEnabled: boolean;
  /**
   * Il propose le MODE DIALOGUE : il prononce ses réponses, l'usager répond de
   * vive voix. Les langues où c'est possible : `domain/voice.ts`.
   */
  voiceEnabled: boolean;
}

/** L'assistant fermé — l'état de toute collectivité qui n'a rien demandé. */
export function closedAssistant(): PortalAssistant {
  return { enabled: false, depositEnabled: false, voiceEnabled: false };
}

/** Lecture défensive du bloc servi par le Socle (snake_case → camelCase du portail). */
export function parseAssistant(raw: unknown): PortalAssistant {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return closedAssistant();
  const source = raw as Record<string, unknown>;
  const enabled = source.enabled === true;
  return {
    enabled,
    depositEnabled: enabled && source.deposit_enabled === true,
    // Un Socle d'avant 1.37.0 ne sert pas le champ : la voix reste fermée.
    voiceEnabled: enabled && source.voice_enabled === true,
  };
}
