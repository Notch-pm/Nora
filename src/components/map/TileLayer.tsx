/**
 * Mosaïque de tuiles + attribution — la seule brique qui « peint » une carte.
 * Portée d'Iris (`components/map/TileLayer.tsx`). Toute la géométrie vit dans
 * `src/lib/carto.ts` (pure, testée) ; ce composant ne fait que positionner des
 * images.
 *
 * L'attribution OpenStreetMap (ODbL) est portée par la mosaïque elle-même :
 * elle suit ainsi toute carte, sans risque d'oubli. Ne pas la retirer.
 */
import * as React from "react";
import { mapTiles, TILE_SIZE, type MapView } from "@/lib/carto.ts";

export function TileLayer({ view }: { view: MapView }) {
  const tiles = mapTiles(view);
  return (
    <>
      {tiles.map((tile) => (
        <img
          key={tile.key}
          src={tile.url}
          alt=""
          width={TILE_SIZE}
          height={TILE_SIZE}
          // Pas de `loading="lazy"` : les tuiles SONT le contenu, les différer
          // laisse la carte blanche au chargement et au zoom.
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: tile.left, top: tile.top }}
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
      ))}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-0 right-0 z-10 rounded-tl-[var(--pt-radius-sm)] bg-white/85 px-1.5 py-0.5 text-[10px] text-[color:var(--pt-muted)] hover:underline"
      >
        © les contributeurs OpenStreetMap
      </a>
    </>
  );
}

/**
 * Taille réelle du conteneur de carte (le rendu des tuiles en dépend).
 *
 * ⚠️ La mesure se fait au MONTAGE : l'élément doit exister au premier rendu du
 * composant qui appelle ce hook. Un conteneur rendu conditionnellement plus
 * tard ne sera jamais mesuré, et sa mosaïque restera vide — monter le
 * composant entier quand la condition est vraie, plutôt que masquer le
 * conteneur (piège vécu dans Iris le 2026-08-28).
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
