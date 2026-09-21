/**
 * La porte de l'assistant, sous le champ de recherche de l'accueil.
 *
 * ⚠️ **C'EST LE SEUL POINT D'ENTRÉE.** Plus de bouton « Poser une question à
 * l'assistant » isolé en haut de page : l'assistant est le repli naturel quand
 * la recherche par mots-clés ne suffit pas, et il se montre AU MOMENT DE
 * L'HÉSITATION, au même endroit de l'écran. (`AssistantEntryLink` ne survit que
 * sur un accueil sans section « recherche » — il n'y a alors aucun champ d'où
 * naître, et un assistant injoignable ne sert personne.)
 *
 * ⚠️ **La place est CALCULÉE** (`promotion.ts`), jamais fixe : une ligne
 * discrète pour qui tape un mot-clé que l'index trouve, un bloc en tête et
 * l'action par défaut d'Entrée pour qui raconte sa situation. Rien ne part vers
 * le guichet IA avant que l'usager n'active l'assistant lui-même.
 *
 * ⚠️ **Ce bloc ne double PAS le catalogue.** La maquette d'origine listait les
 * démarches trouvées dans un panneau déroulant ; l'accueil de Nora filtre déjà
 * sa grille en direct, sous le champ. Les répéter ici ferait lire deux fois la
 * même liste — on ne garde donc que ce que la grille ne sait pas dire.
 */
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { AssistantPriority } from "./promotion.ts";

/** Le repère de l'assistant. Décoratif : le texte à côté dit tout. */
function AssistantMark({ size }: { size: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "var(--pt-primary)",
        color: "var(--pt-on-primary)",
      }}
    >
      <svg
        width={Math.round(size * 0.55)}
        height={Math.round(size * 0.55)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
      </svg>
    </span>
  );
}

export function AssistantSearchPrompt({
  priority,
  onStart,
}: {
  priority: AssistantPriority;
  /** Bascule la page en conversation, avec la saisie en cours comme premier message. */
  onStart: () => void;
}) {
  const t = useT();
  if (priority === "none") return null;

  // Priorité basse — une ligne en pied, après les démarches que la grille
  // montre déjà. L'usager pressé la traverse sans la voir.
  if (priority === "low") {
    return (
      <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        <span>{t("assistant.search.noMatch")}</span>
        <button
          type="button"
          onClick={onStart}
          // 48 px de cible tactile (exigence du design system sur toute surface
          // usager) : la hauteur vient du `py`, pas d'une taille figée, pour que
          // le texte reste agrandissable à 200 % (RGAA 10.4).
          className="min-h-[48px] rounded-[var(--pt-radius-sm)] px-2 py-3 font-semibold text-[color:var(--brand-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-primary)]"
        >
          {t("assistant.search.explain")}
        </button>
      </p>
    );
  }

  // Priorité haute — en tête, et action par défaut d'Entrée dans le champ.
  return (
    <button
      type="button"
      onClick={onStart}
      style={{ background: "var(--pt-primary-soft)" }}
      className="flex w-full items-center gap-3 rounded-[var(--pt-radius-sm)] p-3 text-left transition hover:brightness-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--brand-primary)]"
    >
      <AssistantMark size={30} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
          {t("assistant.search.explain")}
        </span>
        <span className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {t("assistant.search.detail")}
        </span>
      </span>
      {/* Le raccourci est une INFORMATION, pas un contrôle : masqué au lecteur
          d'écran, qui a déjà le bouton lui-même sous le doigt. */}
      <span
        aria-hidden="true"
        className="hidden shrink-0 text-[length:var(--pt-small)] text-[color:var(--pt-muted)] sm:inline"
      >
        {t("assistant.search.enter")} ↵
      </span>
    </button>
  );
}
