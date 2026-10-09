/**
 * L'entrée vers le courrier libre, sur la page qui le propose — l'accueil de
 * la collectivité (`/courrier`) ou la page d'un organisme (`/{slug}/courrier`).
 *
 * Ne s'affiche que si le Socle l'a ouvert pour CET organisme
 * (`free_mail.enabled`) : le composant ne décide rien, il reçoit `freeMail`
 * et rend `null` sur un courrier fermé. Le titre est celui que la collectivité
 * a choisi, sinon le libellé par défaut, traduit.
 *
 * Un vrai lien (`<a>`), pas un bouton : il mène à une page, il s'ouvre dans un
 * onglet et se partage. Son intitulé se suffit hors contexte (RGAA 6.1).
 */
import { Link } from "react-router-dom";
import type { FreeMail } from "@fn/_shared/domain/courrier.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { organismePath } from "@/i18n/localizedPath.ts";

export function CourrierLibreCallout({
  freeMail,
  organisme,
}: {
  freeMail: FreeMail;
  /** Le slug de la page ; `null` = la collectivité (son accueil). */
  organisme: string | null;
}) {
  const { lang } = useLanguage();
  const t = useT();
  if (!freeMail.enabled) return null;
  const title = freeMail.title ?? t("courrierLibre.title");

  return (
    <section
      aria-labelledby="courrier-libre-titre"
      className="flex flex-col gap-3 rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] bg-[color:var(--pt-surface)] p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h2 id="courrier-libre-titre" className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">
          {title}
        </h2>
        <p className="mt-1 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("courrierLibre.cta.text")}</p>
      </div>
      <Link
        to={organismePath(lang, organisme, "/courrier")}
        className="inline-flex shrink-0 justify-center rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] focus-visible:ring-offset-2"
      >
        {t("courrierLibre.cta.button")}
      </Link>
    </section>
  );
}
