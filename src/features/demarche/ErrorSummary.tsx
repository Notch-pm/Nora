/**
 * Le récapitulatif des erreurs, en tête d'un formulaire : le motif RGAA d'un
 * formulaire long. Partagé par le formulaire d'une démarche et par la saisie de
 * `/suivi`.
 *
 * `tabIndex={-1}` le rend focusable par programme sans l'ajouter à l'ordre de
 * tabulation — c'est la page qui y amène le focus après un envoi refusé
 * (RGAA 10.7 / bonne pratique 11.10), via la `ref` transmise ici.
 */
import { forwardRef } from "react";
import { useTn } from "@/i18n/LanguageLayout.tsx";

export const ErrorSummary = forwardRef<HTMLDivElement, { count: number }>(function ErrorSummary(
  { count },
  ref,
) {
  const tn = useTn();
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
    >
      {tn("form.errors", count)}
    </div>
  );
});
