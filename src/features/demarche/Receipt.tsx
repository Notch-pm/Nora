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
import { useT } from "@/i18n/LanguageLayout.tsx";

export function Receipt({
  receipt,
  demarcheName,
  footer,
}: {
  receipt: DemandeReceipt;
  demarcheName: string;
  footer?: ReactNode;
}) {
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
      {footer}
    </section>
  );
}
