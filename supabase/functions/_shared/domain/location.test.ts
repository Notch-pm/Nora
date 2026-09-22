import { describe, expect, it } from "vitest";
import { LOCATION_ADJUST_RADIUS_M } from "./formSchema.ts";
import {
  addressText,
  clampToRadius,
  distanceMeters,
  locationFromAddress,
  locationIsBlank,
  locationPoint,
  metersPerPixel,
  offsetMeters,
  parseLocationValue,
} from "./location.ts";

// 10 Avenue de Frémeur, Nantes (réponse réelle de la BAN, `ban.test.ts`).
const NANTES = { lat: 47.223, lon: -1.573 };

const FULL = {
  address: "10 Avenue de Frémeur 44000 Nantes",
  lat: NANTES.lat,
  lon: NANTES.lon,
  precision: "adresse",
  adjusted: true,
};

describe("parseLocationValue — la forme du contrat, tolérante", () => {
  it("lit une valeur complète telle quelle, et ignore les clés inconnues", () => {
    expect(parseLocationValue({ ...FULL, score: 0.9, citycode: "44109" })).toEqual(FULL);
  });

  it("sans adresse, ce n'est pas un lieu — objet vide, adresse blanche, chaîne nue, tout le reste", () => {
    for (const raw of [null, undefined, "10 rue Neuve", 42, [], {}, { address: "   " }, { lat: 1, lon: 2 }]) {
      expect(parseLocationValue(raw)).toBeNull();
      expect(locationIsBlank(raw)).toBe(true);
    }
  });

  it("une coordonnée seule, non finie ou hors bornes fait tomber le COUPLE — et l'ajustement avec", () => {
    const base = { address: "x", precision: "voie", adjusted: true };
    for (const point of [
      { lat: 47.2 },
      { lon: -1.5 },
      { lat: Number.NaN, lon: -1.5 },
      { lat: "47.2", lon: -1.5 },
      { lat: 91, lon: 0 },
      { lat: 0, lon: 181 },
    ]) {
      expect(parseLocationValue({ ...base, ...point })).toEqual({
        address: "x",
        lat: null,
        lon: null,
        precision: "voie",
        adjusted: false,
      });
    }
  });

  it("une précision hors vocabulaire devient null ; `adjusted` n'est vrai que s'il l'est vraiment", () => {
    expect(parseLocationValue({ ...FULL, precision: "housenumber" })!.precision).toBeNull();
    expect(parseLocationValue({ ...FULL, adjusted: "true" })!.adjusted).toBe(false);
    expect(parseLocationValue({ ...FULL, adjusted: undefined })!.adjusted).toBe(false);
  });

  it("borne l'adresse de ses espaces, et rend le point quand il y en a un", () => {
    const value = parseLocationValue({ ...FULL, address: "  10 Avenue de Frémeur 44000 Nantes  " })!;
    expect(value.address).toBe("10 Avenue de Frémeur 44000 Nantes");
    expect(locationPoint(value)).toEqual(NANTES);
    expect(locationPoint(locationFromAddress("12 rue Neuve"))).toBeNull();
  });

  it("la saisie libre : une adresse, aucun point, jamais ajustée", () => {
    expect(locationFromAddress("12 rue Neuve")).toEqual({
      address: "12 rue Neuve",
      lat: null,
      lon: null,
      precision: null,
      adjusted: false,
    });
  });

  // ⚠️ Régression de production du 2026-09-22 : la valeur passait par `trim()`
  // à chaque frappe, et le champ étant contrôlé, l'espace disparaissait à
  // l'instant où elle était tapée — « 12 rue de la Paix » devenait
  // « 12ruedelaPaix », que la BAN ne reconnaît pas. Même piège qu'Iris le
  // 2026-08-28 : un champ contrôlé ne se dérive jamais d'une transformation à
  // perte de ce qui vient d'être tapé.
  it("GARDE ce qui est tapé, espaces compris — et ce qui revient au champ est ce qui en est sorti", () => {
    for (const frappe of ["12", "12 ", "12 rue ", " 12 rue de la Paix ", "   "]) {
      expect(locationFromAddress(frappe).address).toBe(frappe);
      expect(addressText(locationFromAddress(frappe))).toBe(frappe);
    }
    // La frappe, lettre après lettre, survit à l'aller-retour par la valeur.
    let saisie = "";
    for (const lettre of "12 rue de la Paix") {
      saisie += lettre;
      expect(addressText(locationFromAddress(saisie))).toBe(saisie);
    }
  });

  it("addressText lit aussi une valeur d'une autre forme, sans rien reconstruire", () => {
    expect(addressText("12 rue Neuve")).toBe("12 rue Neuve");
    expect(addressText({ address: "10 Avenue de Frémeur 44000 Nantes", lat: 47.2, lon: -1.5 })).toBe(
      "10 Avenue de Frémeur 44000 Nantes",
    );
    // Blanche ou illisible : le champ affiche ce qu'il peut, il ne perd rien.
    expect(addressText({ address: "  " })).toBe("  ");
    for (const raw of [null, undefined, 42, [], {}, { address: 12 }]) expect(addressText(raw)).toBe("");
  });

  it("la normalisation se fait À LA FRONTIÈRE : c'est le parseur qui rogne", () => {
    expect(parseLocationValue(locationFromAddress(" 12 rue Neuve "))!.address).toBe("12 rue Neuve");
    expect(parseLocationValue(locationFromAddress("   "))).toBeNull();
  });
});

describe("géométrie du rayon", () => {
  it("mesure la distance à vol d'oiseau (un degré de latitude ≈ 111 km)", () => {
    expect(distanceMeters(NANTES, NANTES)).toBe(0);
    expect(distanceMeters({ lat: 47, lon: -1.5 }, { lat: 48, lon: -1.5 })).toBeCloseTo(111_195, -2);
  });

  it("offsetMeters déplace vers le nord et vers l'est de la distance demandée", () => {
    const north = offsetMeters(NANTES, 100, 0);
    const east = offsetMeters(NANTES, 0, 100);
    expect(north.lat).toBeGreaterThan(NANTES.lat);
    expect(east.lon).toBeGreaterThan(NANTES.lon);
    expect(distanceMeters(NANTES, north)).toBeCloseTo(100, 0);
    expect(distanceMeters(NANTES, east)).toBeCloseTo(100, 0);
  });

  it("clampToRadius laisse un point dans le rayon, et pose sur le cercle un point au-delà — même direction", () => {
    const inside = offsetMeters(NANTES, 60, 60);
    expect(clampToRadius(NANTES, inside)).toEqual(inside);

    const far = offsetMeters(NANTES, 0, 500);
    const clamped = clampToRadius(NANTES, far);
    expect(distanceMeters(NANTES, clamped)).toBeCloseTo(LOCATION_ADJUST_RADIUS_M, 0);
    expect(clamped.lat).toBeCloseTo(NANTES.lat, 6);
    expect(clamped.lon).toBeGreaterThan(NANTES.lon);

    // Un rayon explicite, plus petit, s'applique de même.
    expect(distanceMeters(NANTES, clampToRadius(NANTES, far, 50))).toBeCloseTo(50, 0);
  });

  it("metersPerPixel : au zoom 17 à Nantes, 150 m tiennent dans un cadre de 260 px", () => {
    const perPixel = metersPerPixel(NANTES.lat, 17);
    expect(perPixel).toBeGreaterThan(0.7);
    expect(perPixel).toBeLessThan(0.9);
    expect(LOCATION_ADJUST_RADIUS_M / perPixel).toBeLessThan(260 / 2 + 60);
    // Un cran de zoom en moins double la taille d'un pixel.
    expect(metersPerPixel(NANTES.lat, 16)).toBeCloseTo(perPixel * 2, 6);
  });
});
