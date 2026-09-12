/**
 * Bloc « Recherche de démarche ».
 *
 * Le champ est possédé par `HomeComposition` : c'est lui qui filtre les
 * sections « démarches » qui suivent. Les raccourcis ne filtrent rien
 * eux-mêmes — ils préremplissent le champ avec le nom de la démarche, pour
 * qu'il n'existe qu'un seul mécanisme de filtre, celui du champ.
 *
 * ⚠️ L'image de fond est posée en CSS, jamais en `<img>` : c'est un FOND, elle
 * ne porte aucune information (le titre et le sous-titre sont posés dessus).
 * Elle recouvre tout le bloc, et sous elle un voile clair garde les textes
 * lisibles quelle que soit la photo — voir `IMAGE_VEIL_ALPHA`.
 *
 * ⚠️ En **pleine largeur**, `HomeComposition` rend ce bloc HORS de son
 * conteneur centré — c'est la seule façon qu'a un fond d'atteindre les bords de
 * l'écran. Le contenu, lui, garde sa largeur de lecture : d'où le conteneur
 * intérieur, qui ne fait rien de plus quand le bloc est rendu normalement.
 */
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import type { RechercheSection as RechercheSectionData } from "@fn/_shared/domain/page.ts";
import { resolveShortcuts } from "../composition.ts";
import { imageBackdropStyle } from "../themeStyle.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";

/** Exportée : la page d'un organisme s'en sert pour son propre champ de recherche. */
export function SearchIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      className="shrink-0 text-[color:var(--pt-muted)]"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function RechercheSection({
  section,
  demarches,
  query,
  onQueryChange,
}: {
  section: RechercheSectionData;
  /** Catalogue complet (non filtré) : les raccourcis référencent l'ensemble des démarches publiées. */
  demarches: Demarche[];
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const shortcuts = resolveShortcuts(section.shortcuts, demarches);
  const t = useT();
  const label =
    section.placeholder.trim() !== "" ? section.placeholder : t("search.placeholder");

  const backdrop = imageBackdropStyle(section.imageUrl, section.imageFixed);
  const hasImage = backdrop !== undefined;

  return (
    <section
      style={backdrop}
      className={
        (hasImage ? "py-14 " : "py-2 ") +
        // Sans pleine largeur, le fond s'arrête aux marges du contenu : il
        // prend les angles du thème, sinon c'est une boîte carrée au milieu
        // d'une page arrondie. En pleine largeur, des angles n'auraient pas de
        // sens — le fond touche les bords de l'écran.
        (hasImage && !section.imageFullWidth ? "rounded-[var(--pt-radius)] " : "") +
        // Pleine largeur : le conteneur centré de la page a été retiré, le bloc
        // remet les marges latérales pour son propre contenu.
        (section.imageFullWidth ? "px-6" : "")
      }
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3.5">
        <h2 className="text-center text-[length:var(--pt-h1)] font-extrabold leading-tight tracking-tight text-[color:var(--pt-ink)]">
          {section.title}
        </h2>
        {section.subtitle.trim() !== "" && (
          <p
            className={
              "text-center text-[length:var(--pt-body)] " +
              // ⚠️ Le gris de texte passe à l'encre pleine sur une image : sous
              // le voile, il ne tiendrait que 2,1 : 1 (voir `IMAGE_VEIL_ALPHA`).
              (hasImage ? "text-[color:var(--pt-ink)]" : "text-[color:var(--pt-muted)]")
            }
          >
            {section.subtitle}
          </p>
        )}
        <div className="flex h-12 w-full max-w-[520px] items-center gap-2.5 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-3.5 shadow-[var(--pt-shadow)]">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={section.placeholder}
            aria-label={label}
            className="w-full border-0 bg-transparent p-0 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] outline-none placeholder:text-[color:var(--pt-muted)] focus:outline-none focus:ring-0"
          />
        </div>
        {shortcuts.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {shortcuts.map((demarche) => (
              <button
                key={demarche.id}
                type="button"
                onClick={() => onQueryChange(demarche.name)}
                className={
                  "rounded-full px-3 py-1.5 text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-ink)] hover:opacity-80 " +
                  // L'aplat neutre des puces se confondrait avec le voile : sur
                  // une image, elles se détachent en blanc plein.
                  (hasImage ? "bg-white" : "bg-[color:var(--pt-surface)]")
                }
              >
                {demarche.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
