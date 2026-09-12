/**
 * L'icône de l'onglet, à la marque de la collectivité.
 *
 * Le portail est une instance unique qui sert toutes les collectivités : il ne
 * peut pas déclarer son favicon dans `index.html`, qui est le même pour
 * toutes. L'icône arrive donc avec la charte, et se pose ici — le seul élément
 * de la charte qui vive dans l'en-tête du document plutôt que dans la page.
 *
 * La décision est séparée de l'écriture (motif `theme.ts` : `parseRememberedBranding`
 * est pur, `rememberedBranding` touche au navigateur). Ce sont les deux règles
 * ci-dessous qui méritent d'être tenues ; le reste est de la plomberie DOM.
 */
import type { Branding } from "@fn/_shared/domain/branding.ts";

/** Marque notre `<link>`, pour ne jamais toucher à ceux du document. */
const MARK = "data-portal-favicon";

/**
 * Faut-il (re)poser l'icône ?
 *
 * ⚠️ **L'ABSENCE N'EST PAS UN EFFACEMENT.** Une collectivité sans favicon
 * laisse au navigateur l'icône qu'il avait choisie : retirer le `<link>` à ce
 * moment-là ferait clignoter l'onglet d'un chargement à l'autre sans rien y
 * gagner — et le portail n'a pas d'icône à mettre à la place, `index.html`
 * étant commun à toutes les collectivités.
 *
 * ⚠️ **Une icône déjà posée ne se repose pas** : on remplace l'élément entier
 * (plusieurs navigateurs ignorent un simple changement de `href`), donc le
 * reposer relancerait un téléchargement à chaque navigation interne.
 */
export function shouldApplyFavicon(current: string | null, wanted: string | null): boolean {
  if (!wanted) return false;
  return current !== wanted;
}

/** Pose l'icône de la collectivité. Sans effet si rien n'a changé — voir ci-dessus. */
export function applyFavicon(branding: Branding | null): void {
  const wanted = branding?.faviconUrl ?? null;
  const current = document.head.querySelector<HTMLLinkElement>(`link[${MARK}]`);
  // ⚠️ On lit l'ATTRIBUT, pas la propriété `href` : celle-ci rend l'adresse
  // résolue par le navigateur, qui ajoute par exemple la barre oblique finale
  // d'une origine nue — l'icône ne se reconnaîtrait alors jamais.
  if (!shouldApplyFavicon(current?.getAttribute("href") ?? null, wanted)) return;

  const link = document.createElement("link");
  link.rel = "icon";
  link.setAttribute(MARK, "");
  link.setAttribute("href", wanted as string);
  current?.remove();
  document.head.appendChild(link);
}
