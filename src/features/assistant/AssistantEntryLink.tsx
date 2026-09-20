/**
 * Le point d'entrée vers l'assistant, partagé par l'accueil et la page d'une
 * démarche (voir la fiche de mission) — jamais affiché ailleurs, et jamais
 * quand `tenant.assistant.enabled` est faux : `enabled` vient TOUJOURS de
 * `Tenant.assistant.enabled`, fermé au doute (voir `domain/assistant.ts`).
 *
 * Deux habillages : `pill` pour l'accueil (repère discret, près du haut de
 * page), `subtle` pour la page d'une démarche (un second lien texte, à côté
 * du bouton « Commencer la démarche », qui ne doit pas lui faire concurrence).
 *
 * ⚠️ JAMAIS `organismePath` : l'assistant vaut pour la collectivité ENTIÈRE,
 * comme la déclaration d'accessibilité (voir `AssistantPage.tsx`) — un lien
 * construit sous un organisme ferait juste un aller-retour de redirection.
 */
import { Link } from "react-router-dom";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";

export function AssistantEntryLink({
  enabled,
  demarcheId,
  variant = "pill",
}: {
  enabled: boolean;
  /** Présent sur la page d'une démarche : porté dans l'adresse comme `focusDemarcheId`. */
  demarcheId?: string;
  variant?: "pill" | "subtle";
}) {
  const { lang } = useLanguage();
  const t = useT();
  if (!enabled) return null;

  const to =
    localizedPath(lang, "/assistant") +
    (demarcheId === undefined ? "" : "?demarche=" + encodeURIComponent(demarcheId));

  if (variant === "subtle") {
    return (
      <Link
        to={to}
        className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
      >
        {t("assistant.askAboutThis")}
      </Link>
    );
  }

  return (
    <Link
      to={to}
      className="inline-flex w-fit items-center gap-2 rounded-full border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-ink)] hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)]"
    >
      {t("assistant.entry")}
    </Link>
  );
}
