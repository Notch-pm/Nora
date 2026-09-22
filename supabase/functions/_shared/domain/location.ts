/**
 * Le lieu d'intervention — la VALEUR d'un champ `location` du Socle (contrat
 * `public-api` 1.29.0), et la géométrie qui borne son point. Logique pure,
 * sans DOM ni réseau, partagée par l'écran (saisie), `portal-api` (dépôt) et
 * l'assistant (recueil).
 *
 * Ce qui part dans la demande, et rien d'autre :
 *
 *   { address, lat, lon, precision, adjusted }
 *
 *  - `address` : le libellé BAN entier si une proposition a été retenue,
 *    sinon le texte tapé. Jamais vide — sans adresse, il n'y a pas de lieu.
 *  - `lat` / `lon` : le point RETENU (WGS 84) — celui de l'adresse, ou celui
 *    où l'usager l'a déplacé. Ensemble, ou `null` tous les deux (saisie libre).
 *  - `precision` : la finesse de la proposition retenue, dans le vocabulaire
 *    de `ban.ts` ; `null` en saisie libre.
 *  - `adjusted` : l'usager a déplacé le point. ⚠️ L'ADRESSE NE BOUGE PAS :
 *    déplacer le point ne réécrit jamais `address`.
 *
 * Le déplacement est borné à `LOCATION_ADJUST_RADIUS_M` du point de l'adresse
 * — un dépôt sauvage se signale « près du 12 », pas dans la ville voisine. La
 * borne s'applique à la SAISIE (`clampToRadius`) ; le serveur, qui ne connaît
 * pas le point de l'adresse, ne revalide que la forme.
 */
import { LOCATION_ADJUST_RADIUS_M } from "./formSchema.ts";

export const LOCATION_PRECISIONS = ["adresse", "voie", "lieu_dit", "commune"] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

export interface LatLon {
  lat: number;
  lon: number;
}

export interface LocationValue {
  address: string;
  lat: number | null;
  lon: number | null;
  precision: LocationPrecision | null;
  adjusted: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteCoordinate(value: unknown, bound: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.abs(value) <= bound ? value : null;
}

/**
 * Lecture TOLÉRANTE d'une valeur venue du navigateur, d'un état sauvegardé ou
 * d'un modèle : les clés inconnues sont ignorées, une coordonnée seule ou hors
 * bornes fait tomber le couple, une précision hors vocabulaire devient `null`,
 * et `adjusted` n'est vrai qu'avec un point. Sans adresse, `null` : ce n'est
 * pas un lieu. Jamais d'exception.
 */
export function parseLocationValue(raw: unknown): LocationValue | null {
  if (!isRecord(raw)) return null;
  const address = typeof raw.address === "string" ? raw.address.trim() : "";
  if (address === "") return null;
  const lat = finiteCoordinate(raw.lat, 90);
  const lon = finiteCoordinate(raw.lon, 180);
  const hasPoint = lat !== null && lon !== null;
  const precision = (LOCATION_PRECISIONS as readonly unknown[]).includes(raw.precision)
    ? (raw.precision as LocationPrecision)
    : null;
  return {
    address,
    lat: hasPoint ? lat : null,
    lon: hasPoint ? lon : null,
    precision,
    adjusted: hasPoint && raw.adjusted === true,
  };
}

/** Un objet qui ne fait pas un lieu (adresse vide ou absente) — vu par `isBlank`. */
export function locationIsBlank(raw: unknown): boolean {
  return parseLocationValue(raw) === null;
}

/**
 * La saisie libre : une adresse tapée, aucun point.
 *
 * ⚠️ **Le texte est gardé TEL QUEL, espaces compris.** Cette valeur alimente un
 * champ contrôlé : la rogner ici empêcherait de taper une espace — elle
 * disparaîtrait à l'instant où elle est frappée, et « 12 rue de la Paix »
 * s'écrirait « 12ruedelaPaix », que la Base Adresse Nationale ne reconnaît pas
 * (constaté en production le 2026-09-22). C'est la règle qu'Iris avait tirée du
 * même piège le 2026-08-28 : **un champ contrôlé ne se dérive jamais d'une
 * transformation à perte de ce qui vient d'être tapé.**
 *
 * La normalisation se fait À LA FRONTIÈRE, quand la réponse part :
 * `parseLocationValue` rogne l'adresse, et une adresse blanche n'est pas un lieu.
 */
export function locationFromAddress(address: string): LocationValue {
  return { address, lat: null, lon: null, precision: null, adjusted: false };
}

/**
 * Le texte à AFFICHER dans le champ, lu sans rien reconstruire : l'adresse de
 * la valeur telle qu'elle a été tapée — même blanche, même illisible pour
 * `parseLocationValue` (une valeur d'une autre forme n'affiche que ce qu'elle
 * peut). C'est l'autre moitié de la règle ci-dessus : ce qui revient dans le
 * champ est exactement ce qui en est sorti.
 */
export function addressText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const address = (raw as { address?: unknown }).address;
    if (typeof address === "string") return address;
  }
  return "";
}

/** Le point de l'adresse, s'il y en a un. */
export function locationPoint(value: LocationValue): LatLon | null {
  return value.lat !== null && value.lon !== null ? { lat: value.lat, lon: value.lon } : null;
}

// ---- Géométrie ---------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Distance à vol d'oiseau, en mètres (haversine) — assez juste à l'échelle d'une rue. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Le point ramené dans le rayon autour du centre : au-delà, il est POSÉ SUR LE
 * CERCLE dans la même direction, jamais refusé — un geste trop ample s'arrête
 * à la limite au lieu de retomber sur l'adresse. Calcul en projection locale
 * (équirectangulaire), largement suffisant pour quelques centaines de mètres.
 */
export function clampToRadius(center: LatLon, point: LatLon, radiusM = LOCATION_ADJUST_RADIUS_M): LatLon {
  const distance = distanceMeters(center, point);
  if (distance <= radiusM || distance === 0) return point;
  const ratio = radiusM / distance;
  return {
    lat: center.lat + (point.lat - center.lat) * ratio,
    lon: center.lon + (point.lon - center.lon) * ratio,
  };
}

/**
 * Le point déplacé de `north` mètres vers le nord et `east` mètres vers l'est
 * — le geste du clavier (flèches), avant `clampToRadius`.
 */
export function offsetMeters(point: LatLon, north: number, east: number): LatLon {
  const dLat = (north / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon = ((east / EARTH_RADIUS_M) * (180 / Math.PI)) / Math.cos(toRad(point.lat));
  return { lat: point.lat + dLat, lon: point.lon + dLon };
}

/**
 * Ce que vaut un pixel, en mètres, au sol — pour dessiner le cercle du rayon
 * sur la mosaïque (Web Mercator, tuiles de 256 px).
 */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156_543.03392 * Math.cos(toRad(lat))) / 2 ** zoom;
}
