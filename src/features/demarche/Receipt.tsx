/**
 * L'accusé de dépôt — ce que l'usager doit pouvoir noter avant de fermer.
 * Partagé par `FormulairePage` (dépôt classique) et l'assistant (recueil dans
 * la conversation, lot 2) : LA MÊME présentation de la référence, pour ne pas
 * avoir à la reconnaître deux fois.
 *
 * `footer` est ce qui suit la note sur l'absence de courriel — un lien
 * « Retour à l'accueil » côté formulaire classique, des boutons « Copier » /
 * « Imprimer » côté assistant. Le composant ne décide d'aucun des deux.
 */
import type { ReactNode } from "react";
import type { DemandeReceipt } from "@fn/_shared/domain/demande.ts";
import { Link } from "react-router-dom";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";

export function Receipt({
  receipt,
  demarcheName,
  footer,
  followUpRequested = false,
}: {
  receipt: DemandeReceipt;
  demarcheName: string;
  footer?: ReactNode;
  /**
   * L'usager avait coché le suivi en ligne. Sans `receipt.accessCode` (rejeu,
   * ou accès non ouvert), l'accusé se contente de dire que le code part par
   * courriel — il ne promet pas de l'afficher.
   */
  followUpRequested?: boolean;
}) {
  const { lang } = useLanguage();
  const t = useT();
  return (
    <section className="rounded-[var(--pt-radius)] border border-[color:var(--brand-primary)] bg-[color:color-mix(in_srgb,var(--brand-primary)_6%,white)] p-6">
      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
        {t(receipt.created ? "receipt.title" : "receipt.titleAgain")}
      </h1>
      <p className="mt-2 text-[color:var(--pt-ink)]">{demarcheName}</p>
      <p className="mt-6 text-[length:var(--pt-body)] font-semibold uppercase tracking-wide text-[color:var(--pt-muted)]">
        {t("receipt.reference")}
      </p>
      <p className="mt-1 text-[length:var(--pt-h1)] font-black tracking-tight text-[color:var(--pt-ink)]">{receipt.reference}</p>
      <p className="mt-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("receipt.note")}</p>
      {receipt.accessCode ? (
        <>
          <p className="mt-6 text-[length:var(--pt-body)] font-semibold uppercase tracking-wide text-[color:var(--pt-muted)]">
            {t("receipt.accessCode")}
          </p>
          {/* Un code, pas une phrase : il se lit caractère par caractère. */}
          <p translate="no" className="mt-1 text-[length:var(--pt-h1)] font-black tracking-tight text-[color:var(--pt-ink)]">
            {receipt.accessCode}
          </p>
          <p className="mt-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("receipt.accessCodeNote")}</p>
          <Link
            to={localizedPath(lang, "/suivi")}
            className="mt-4 inline-flex rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-4 py-2 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90"
          >
            {t("receipt.follow")}
          </Link>
        </>
      ) : (
        followUpRequested && (
          <p className="mt-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("receipt.accessCodeMailed")}</p>
        )
      )}
      {footer}
    </section>
  );
}
