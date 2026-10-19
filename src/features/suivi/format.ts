/**
 * Mise en forme du suivi — logique pure, testée sans DOM.
 *
 * ⚠️ Le fuseau est celui de la collectivité (Europe/Paris), pas celui du
 * navigateur : un dépôt de 00h30 le 2 doit se lire « 2 », même pour un usager
 * dont l'appareil est réglé ailleurs. Et un instant illisible se rend tel quel
 * plutôt que « Invalid Date ».
 */
import type { SuiviStatus } from "@fn/_shared/domain/suivi.ts";
import type { StringKey } from "@/i18n/strings.ts";

const TIME_ZONE = "Europe/Paris";

/** « 2 octobre 2026 » (ou « 2 October 2026 »). */
export function formatDate(iso: string, lang: string): string {
  return format(iso, lang, { dateStyle: "long" });
}

/** « 2 octobre 2026 à 14:05 ». */
export function formatDateTime(iso: string, lang: string): string {
  return format(iso, lang, { dateStyle: "long", timeStyle: "short" });
}

function format(iso: string, lang: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(lang, { ...options, timeZone: TIME_ZONE }).format(date);
  } catch {
    // Langue que le navigateur ne connaît pas : le français fera l'affaire.
    return new Intl.DateTimeFormat("fr", { ...options, timeZone: TIME_ZONE }).format(date);
  }
}

/** La taille d'un fichier, lisible (« 1,2 Mo ») ; `null` quand elle n'est pas connue. */
export function formatSize(bytes: number | null, lang: string): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  const [value, unit] =
    bytes >= 1024 * 1024
      ? [bytes / (1024 * 1024), "megabyte"]
      : bytes >= 1024
        ? [bytes / 1024, "kilobyte"]
        : [bytes, "byte"];
  try {
    return new Intl.NumberFormat(lang, {
      style: "unit",
      unit,
      unitDisplay: "short",
      maximumFractionDigits: unit === "megabyte" ? 1 : 0,
    }).format(value);
  } catch {
    return Math.round(bytes) + " B";
  }
}

/** La clé du dictionnaire qui dit un statut — une table, pas une concaténation, pour que le type la vérifie. */
export const STATUS_KEYS: Record<SuiviStatus, StringKey> = {
  envoyee: "suivi.status.envoyee",
  en_cours: "suivi.status.en_cours",
  en_attente: "suivi.status.en_attente",
  traitee: "suivi.status.traitee",
  annulee: "suivi.status.annulee",
  archivee: "suivi.status.archivee",
};
