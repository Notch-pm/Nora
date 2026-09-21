/**
 * La mention IA — UNE LIGNE, sous le champ de saisie.
 *
 * ⚠️ **Pourquoi une ligne et plus un pavé.** L'obligation de transparence était
 * tenue par cinq puces en tête de page : lues une fois, jamais relues, et
 * surtout lues LOIN de l'endroit où l'usager s'apprête réellement à écrire. La
 * phrase qui compte — « à vérifier », « pas de données sensibles » — se place
 * donc sous le champ, au moment d'écrire. Le détail n'est pas perdu : il est
 * dans le dépliant, à un geste.
 *
 * ⚠️ **Un `<details>`, pas un composant à nous.** Le dépliant natif est
 * accessible sans une ligne de JavaScript, fonctionne sans lui, et s'ouvre à la
 * recherche dans la page. Il n'y a rien à gagner à le réécrire. Pas de page
 * « en savoir plus » non plus : il n'en existe aucune au Socle, et en inventer
 * une adresse ferait un lien mort le jour où elle n'est pas publiée.
 */
import { useT } from "@/i18n/LanguageLayout.tsx";

const DETAILS: Array<"automated" | "sources" | "noPersonalData" | "notStored" | "provider"> = [
  "automated",
  "sources",
  "noPersonalData",
  "notStored",
  "provider",
];

export function AssistantNoticeLine() {
  const t = useT();
  return (
    <details className="group">
      <summary
        className={
          "flex cursor-pointer list-none flex-wrap items-baseline gap-x-1.5 gap-y-0.5 " +
          "text-[length:var(--pt-small)] text-[color:var(--pt-muted)] " +
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
          "focus-visible:outline-[color:var(--brand-primary)] " +
          "[&::-webkit-details-marker]:hidden"
        }
      >
        <span>{t("assistant.notice.short")}</span>
        <span className="font-semibold text-[color:var(--brand-primary)] underline-offset-4 group-hover:underline">
          {t("assistant.notice.more")}
        </span>
      </summary>
      <div
        className="mt-2 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] p-3"
        style={{ background: "var(--pt-surface)" }}
      >
        <p className="text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-ink)]">
          {t("assistant.notice.lead")}
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {DETAILS.map((key) => (
            <li key={key} className="flex gap-2">
              <span aria-hidden="true">•</span>
              <span>{t(`assistant.notice.${key}` as const)}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
