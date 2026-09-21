/**
 * Classes partagées entre `AssistantPage.tsx` et `CollectCards.tsx` — pour ne
 * pas dupliquer les mêmes chaînes Tailwind des deux côtés, et pour éviter un
 * import circulaire entre les deux (la page affiche les cartes, les cartes
 * n'ont pas besoin de connaître la page).
 */
export const CARD_CLASS =
  "rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] bg-white p-[var(--pt-pad)]";
export const LINK_CLASS =
  "rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]";
export const BUTTON_CLASS =
  "rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90 disabled:opacity-60";
export const SECONDARY_BUTTON_CLASS =
  "rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)] hover:bg-[color:var(--pt-surface)] disabled:opacity-60";
/** Le petit intitulé au-dessus d'une carte — nomme la région sans redire le titre du champ. */
export const EYEBROW_CLASS =
  "text-[length:var(--pt-small)] font-semibold uppercase tracking-wide text-[color:var(--pt-muted)]";
