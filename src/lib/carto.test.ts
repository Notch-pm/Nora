import { describe, expect, it } from "vitest";
import {
  clampZoom,
  DEFAULT_TILE_URL,
  DEFAULT_ZOOM,
  mapTiles,
  markerPosition,
  MAX_ZOOM,
  MIN_ZOOM,
  pointAt,
  TILE_SIZE,
  tileUrl,
  worldPixel,
  worldPixelToLatLon,
} from "./carto.ts";

const TEMPLATE = "https://tuiles.test/{z}/{x}/{y}.png";
// 6 rue de la République, 69001 Lyon (réponse réelle de la BAN — cas d'Iris).
const LAT = 45.766371;
const LON = 4.835843;

describe("tileUrl", () => {
  it("retombe sur OpenStreetMap par défaut, et une valeur vide vaut absence", () => {
    expect(tileUrl({})).toBe(DEFAULT_TILE_URL);
    expect(tileUrl({ VITE_MAP_TILE_URL: "  " })).toBe(DEFAULT_TILE_URL);
  });
  it("accepte un fournisseur de tuiles dédié", () => {
    expect(tileUrl({ VITE_MAP_TILE_URL: ` ${TEMPLATE} ` })).toBe(TEMPLATE);
  });
});

describe("worldPixel", () => {
  it("projette le méridien et l'équateur au centre du monde", () => {
    expect(worldPixel(0, 0, 0)).toEqual({ x: 128, y: 128 });
  });
  it("place Lyon dans la tuile OSM attendue au zoom 16", () => {
    const { x, y } = worldPixel(LAT, LON, 16);
    expect(Math.floor(x / TILE_SIZE)).toBe(33648);
    expect(Math.floor(y / TILE_SIZE)).toBe(23376);
  });
  it("borne les latitudes au-delà desquelles Mercator diverge", () => {
    expect(Number.isFinite(worldPixel(90, 0, 3).y)).toBe(true);
    expect(Number.isFinite(worldPixel(-90, 0, 3).y)).toBe(true);
  });
});

describe("clampZoom", () => {
  it("borne le zoom et arrondit", () => {
    expect(clampZoom(MIN_ZOOM - 5)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM + 5)).toBe(MAX_ZOOM);
    expect(clampZoom(16.4)).toBe(16);
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM);
  });
});

describe("mapTiles", () => {
  it("couvre le conteneur et centre le point demandé", () => {
    const width = 600;
    const height = 220;
    const tiles = mapTiles({ lat: LAT, lon: LON, zoom: 16, width, height, tileUrl: TEMPLATE });
    expect(tiles.length).toBeGreaterThan(0);
    const center = worldPixel(LAT, LON, 16);
    const holder = tiles.find(
      (t) => t.key === `16/${Math.floor(center.x / TILE_SIZE)}/${Math.floor(center.y / TILE_SIZE)}`,
    );
    expect(holder).toBeDefined();
    expect(holder!.left).toBeLessThanOrEqual(width / 2);
    expect(holder!.left + TILE_SIZE).toBeGreaterThanOrEqual(width / 2);
    expect(holder!.top).toBeLessThanOrEqual(height / 2);
    expect(holder!.top + TILE_SIZE).toBeGreaterThanOrEqual(height / 2);
    // Aucun trou : la mosaïque déborde du conteneur des deux côtés.
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + TILE_SIZE))).toBeGreaterThanOrEqual(width);
  });
  it("remplit le gabarit de tuiles", () => {
    const [tile] = mapTiles({ lat: LAT, lon: LON, zoom: 16, width: 300, height: 200, tileUrl: TEMPLATE });
    expect(tile!.url).toMatch(/^https:\/\/tuiles\.test\/16\/\d+\/\d+\.png$/);
    const withSubdomain = mapTiles({
      lat: LAT,
      lon: LON,
      zoom: 16,
      width: 300,
      height: 200,
      tileUrl: "https://{s}.tuiles.test/{z}/{x}/{y}.png",
    });
    expect(withSubdomain[0]!.url).toMatch(/^https:\/\/[abc]\.tuiles\.test\//);
  });
  it("ne produit rien sans conteneur mesuré ni coordonnées valides", () => {
    expect(mapTiles({ lat: LAT, lon: LON, zoom: 16, width: 0, height: 220 })).toEqual([]);
    expect(mapTiles({ lat: Number.NaN, lon: LON, zoom: 16, width: 600, height: 220 })).toEqual([]);
  });
  it("boucle l'axe X à l'antiméridien sans sortir de la grille en Y", () => {
    const tiles = mapTiles({ lat: 0, lon: 179.999, zoom: 12, width: 800, height: 400, tileUrl: TEMPLATE });
    const indices = tiles.map((t) => Number(t.url.split("/")[3]));
    expect(Math.min(...indices)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...indices)).toBeLessThan(2 ** 12);
  });
});

describe("worldPixelToLatLon", () => {
  it("est l'inverse de worldPixel", () => {
    const { x, y } = worldPixel(LAT, LON, 15);
    const back = worldPixelToLatLon(x, y, 15);
    expect(back.lat).toBeCloseTo(LAT, 6);
    expect(back.lon).toBeCloseTo(LON, 6);
  });
});

describe("markerPosition / pointAt", () => {
  const view = { lat: LAT, lon: LON, zoom: 15, width: 800, height: 400 };

  it("pose le centre de la vue au milieu du conteneur", () => {
    expect(markerPosition({ lat: LAT, lon: LON }, view)).toEqual({ left: 400, top: 200 });
  });
  it("place l'est à droite et le nord en haut", () => {
    const east = markerPosition({ lat: LAT, lon: LON + 0.01 }, view);
    const north = markerPosition({ lat: LAT + 0.01, lon: LON }, view);
    expect(east.left).toBeGreaterThan(400);
    expect(north.top).toBeLessThan(200);
  });
  it("pointAt est l'inverse de markerPosition — le geste du pointeur redevient une coordonnée", () => {
    const point = { lat: LAT + 0.002, lon: LON - 0.003 };
    const back = pointAt(markerPosition(point, view), view);
    expect(back.lat).toBeCloseTo(point.lat, 6);
    expect(back.lon).toBeCloseTo(point.lon, 6);
  });
});
