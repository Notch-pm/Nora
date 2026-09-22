/**
 * Cartographie libre — logique PURE (ni DOM ni réseau) : configuration du
 * fournisseur de tuiles, projection Web Mercator découpée en tuiles, position
 * d'un point dans le conteneur. Portée d'Iris (`src/lib/carto.ts`, 2026-09-22)
 * et réduite à ce qu'une carte FIXE consomme : le lieu d'intervention se
 * dessine centré sur l'adresse, et c'est le marqueur qui bouge, pas la vue.
 * Ni panoramique, ni géocodage ici (le portail a `services/adresse/ban.ts`).
 *
 * Un service public, sans clé ni compte (rien de secret dans le bundle) :
 * **tuiles** OpenStreetMap. L'affichage DOIT porter l'attribution
 * « © les contributeurs OpenStreetMap » (ODbL) — `TileLayer` s'en charge. La
 * politique d'usage de l'OSMF réserve ses serveurs aux faibles volumes :
 * `VITE_MAP_TILE_URL` permet de basculer sur un fournisseur dédié sans toucher
 * au code.
 *
 * ⚠️ Les tuiles partent DU NAVIGATEUR de l'usager. Ce qui transite : la zone
 * regardée (indices de tuiles) et l'adresse IP du visiteur — comme pour tout
 * site qui affiche une carte. Jamais un nom, jamais une démarche.
 */

export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Le fournisseur de tuiles : OpenStreetMap, sauf substitution par
 * `VITE_MAP_TILE_URL` (gabarit à jetons `{z}` `{x}` `{y}`, `{s}` facultatif).
 * Une valeur vide vaut absence.
 */
export function tileUrl(env: { VITE_MAP_TILE_URL?: string } = import.meta.env): string {
  const raw = env.VITE_MAP_TILE_URL;
  return raw === undefined || raw.trim() === "" ? DEFAULT_TILE_URL : raw.trim();
}

// ---- Projection et tuiles ---------------------------------------------------

export const TILE_SIZE = 256;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 19;
/** L'échelle d'une rue : 150 m de rayon tiennent dans un cadre de 260 px. */
export const DEFAULT_ZOOM = 17;

/** Latitude au-delà de laquelle la projection Mercator diverge. */
const MERCATOR_LIMIT = 85.05112878;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
}

/** Position en pixels « monde » (Web Mercator) au niveau de zoom donné. */
export function worldPixel(lat: number, lon: number, zoom: number): { x: number; y: number } {
  const size = TILE_SIZE * 2 ** zoom;
  const rad = (Math.min(MERCATOR_LIMIT, Math.max(-MERCATOR_LIMIT, lat)) * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * size,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size,
  };
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Inverse de `worldPixel` : des pixels « monde » vers les coordonnées. */
export function worldPixelToLatLon(x: number, y: number, zoom: number): LatLon {
  const size = TILE_SIZE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / size;
  return {
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    lon: (x / size) * 360 - 180,
  };
}

export interface MapTile {
  key: string;
  url: string;
  /** Position absolue de la tuile dans le conteneur, en pixels. */
  left: number;
  top: number;
}

const SUBDOMAINS = ["a", "b", "c"] as const;

function tileUrlOf(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{s}", SUBDOMAINS[(x + y) % SUBDOMAINS.length]!)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Vue d'une carte : centre géographique, zoom, taille du conteneur. */
export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
  width: number;
  height: number;
  tileUrl?: string;
}

/**
 * Tuiles couvrant une vue `width`×`height` centrée sur (lat, lon), chacune avec
 * sa position absolue dans le conteneur. Le point demandé tombe au centre exact
 * du conteneur.
 */
export function mapTiles(input: MapView): MapTile[] {
  const { lat, lon, width, height } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  if (!(width > 0) || !(height > 0)) return [];

  const zoom = clampZoom(input.zoom);
  const template = input.tileUrl ?? tileUrl();
  const count = 2 ** zoom;
  const center = worldPixel(lat, lon, zoom);
  const originX = center.x - width / 2;
  const originY = center.y - height / 2;

  const firstX = Math.floor(originX / TILE_SIZE);
  const lastX = Math.floor((originX + width) / TILE_SIZE);
  const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const lastY = Math.min(count - 1, Math.floor((originY + height) / TILE_SIZE));

  const tiles: MapTile[] = [];
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) {
      // Antiméridien : l'axe X boucle, l'axe Y non (déjà borné ci-dessus).
      const wrapped = ((x % count) + count) % count;
      tiles.push({
        key: `${zoom}/${x}/${y}`,
        url: tileUrlOf(template, zoom, wrapped, y),
        left: x * TILE_SIZE - originX,
        top: y * TILE_SIZE - originY,
      });
    }
  }
  return tiles;
}

/** Position d'un point dans le conteneur (le centre de la vue tombe au milieu). */
export function markerPosition(point: LatLon, view: MapView): { left: number; top: number } {
  const center = worldPixel(view.lat, view.lon, view.zoom);
  const target = worldPixel(point.lat, point.lon, view.zoom);
  return {
    left: target.x - center.x + view.width / 2,
    top: target.y - center.y + view.height / 2,
  };
}

/** Inverse de `markerPosition` : d'une position dans le conteneur aux coordonnées. */
export function pointAt(position: { left: number; top: number }, view: MapView): LatLon {
  const center = worldPixel(view.lat, view.lon, view.zoom);
  return worldPixelToLatLon(
    center.x + position.left - view.width / 2,
    center.y + position.top - view.height / 2,
    view.zoom,
  );
}
