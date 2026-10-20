/**
 * La collectivité telle qu'elle entre dans la phrase du consentement
 * « partage » : « l'organisme « Agglomération … » », ou le repli « la
 * collectivité » quand elle n'a pas de nom. Iris compose la phrase consignée
 * de la même façon (`organismPhrase`) : ce que l'usager lit est ce qui est
 * archivé.
 */
import { t } from "./t.ts";

export function consentOrganism(lang: string, name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? t(lang, "consent.organismFallback") : t(lang, "consent.organismNamed", { name: trimmed });
}
