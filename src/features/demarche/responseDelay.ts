/**
 * Le délai de traitement d'une démarche, en toutes lettres (« 3 semaines »).
 *
 * ⚠️ **L'UNITÉ VIENT DE LA DONNÉE**, jamais du nombre : « 30 » ne dit pas si ce
 * sont trente jours ou trente jours ouvrés. Le Socle la sert structurée
 * (`{ value, unit }`) précisément pour que chaque portail l'écrive dans sa
 * langue — une phrase toute faite aurait exigé une traduction par langue.
 *
 * Jours, semaines et mois passent par `Intl.NumberFormat`, qui connaît
 * l'accord de chaque langue (le duel arabe, les trois formes du russe) mieux
 * qu'un dictionnaire à deux formes. Les jours OUVRÉS n'y existent pas : ils
 * viennent du dictionnaire (`demarche.delay.businessDays`).
 *
 * Module PUR, testé sans DOM.
 */
import type { ResponseDelay, ResponseDelayUnit } from "@fn/_shared/domain/userCommunication.ts";
import { COVERED_LANGUAGES } from "@/i18n/strings.ts";
import { PIVOT_LANGUAGE, tn } from "@/i18n/t.ts";

const INTL_UNITS: Record<Exclude<ResponseDelayUnit, "jour_ouvre">, string> = {
  jour: "day",
  semaine: "week",
  mois: "month",
};

/**
 * ⚠️ Écrit dans la langue de l'OUTIL, pas dans celle du visiteur : dans une
 * langue que le dictionnaire ne couvre pas (breton, shimaoré…), l'étiquette
 * « Délai de traitement habituel » est en français — la valeur l'est aussi,
 * plutôt que « 3 sizhun » sous une étiquette française.
 */
export function responseDelayText(lang: string, delay: ResponseDelay): string {
  const chrome = (COVERED_LANGUAGES as readonly string[]).includes(lang) ? lang : PIVOT_LANGUAGE;
  if (delay.unit === "jour_ouvre") return tn(chrome, "demarche.delay.businessDays", delay.value);
  return new Intl.NumberFormat(chrome, {
    style: "unit",
    unit: INTL_UNITS[delay.unit],
    unitDisplay: "long",
  }).format(delay.value);
}
