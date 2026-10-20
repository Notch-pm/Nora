/**
 * Une infobulle accessible, réutilisable (RGAA 10.13 / WCAG 1.4.13).
 *
 * Elle répond aux trois exigences du contenu au survol ou au focus :
 *   • DISCERNABLE — visible au survol ET au focus clavier, jamais au seul
 *     `title` (invisible au clavier, au tactile et aux lecteurs d'écran) ;
 *   • PERSISTANTE ET SURVOLABLE — elle reste affichée tant que le pointeur est
 *     sur la zone qui la porte (la bulle en fait partie) ou que le focus y est ;
 *   • FERMABLE — Échap la ferme sans bouger le pointeur ni le focus.
 *
 * Le texte est TOUJOURS dans le DOM : replié en `sr-only` quand la bulle est
 * fermée, il reste lu par les lecteurs d'écran via `aria-describedby` que
 * l'élément focalisable pointe vers `id`. Rien n'est masqué par display:none.
 *
 * Usage : `const tip = useTooltip();` — poser `tip.zoneProps` sur la zone qui
 * déclenche le survol/focus, `aria-describedby={tip.id}` sur l'élément
 * focalisable, et rendre `<TooltipBubble tip={tip}>texte</TooltipBubble>` dans
 * la zone. La bulle ne capte pas le pointeur : un clic la traverse.
 *
 * Couleurs : blanc sur `--pt-ink` (l'encre de la charte, sombre par construction),
 * aucune couleur codée en dur.
 */
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";

export interface TooltipControl {
  id: string;
  open: boolean;
  dismiss: () => void;
  /** À étaler sur la zone : survol et focus (qui remonte des descendants). */
  zoneProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: (event: React.FocusEvent) => void;
  };
}

export function useTooltip(): TooltipControl {
  const id = useId();
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  // Échap ferme jusqu'à ce que le survol ou le focus recommence.
  const [dismissed, setDismissed] = useState(false);
  const open = (hover || focus) && !dismissed;

  const dismiss = useCallback(() => setDismissed(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return {
    id,
    open,
    dismiss,
    zoneProps: {
      onMouseEnter: () => {
        setDismissed(false);
        setHover(true);
      },
      onMouseLeave: () => {
        setHover(false);
        setDismissed(false);
      },
      onFocus: () => {
        setDismissed(false);
        setFocus(true);
      },
      onBlur: (event) => {
        // Le focus passe à un autre descendant de la zone : la bulle reste.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocus(false);
        setDismissed(false);
      },
    },
  };
}

export function TooltipBubble({
  tip,
  children,
  className = "",
}: {
  tip: TooltipControl;
  children: ReactNode;
  /** Le placement, propre à l'appelant (la zone est `relative`). */
  className?: string;
}) {
  return (
    <span
      id={tip.id}
      role="tooltip"
      className={
        tip.open
          ? "pointer-events-none absolute z-20 w-64 max-w-[calc(100%-1rem)] rounded-[var(--pt-radius-sm)] bg-[color:var(--pt-ink)] px-3 py-2 text-[length:var(--pt-small)] font-semibold leading-snug text-white shadow-[var(--pt-shadow)] " +
            className
          : "sr-only"
      }
    >
      {children}
    </span>
  );
}
