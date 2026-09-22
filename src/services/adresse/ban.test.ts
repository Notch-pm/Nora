import { describe, expect, it } from "vitest";
import {
  addressSearchUrl,
  DEFAULT_GEOCODE_URL,
  geocodeUrl,
  MIN_QUERY_LENGTH,
  parseAddressSuggestions,
  suggestionContext,
  type AddressSuggestion,
} from "./ban.ts";

const BASE = "https://geo.test/search/";

/**
 * Réponse RÉELLE de la Géoplateforme (relevée le 2026-08-28 pour Iris),
 * champs inconnus compris : c'est le contrat qu'on lit, pas une idée qu'on
 * s'en fait.
 */
const REAL_RESPONSE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [-1.573, 47.223] },
      properties: {
        label: "10 Avenue de Frémeur 44000 Nantes",
        score: 0.5195881818181818,
        housenumber: "10",
        id: "44109_3356_00010",
        banId: "2c8e69ec-738b-49a1-a894-a6348f088748",
        name: "10 Avenue de Frémeur",
        postcode: "44000",
        citycode: "44109",
        x: 357140.87,
        y: 6691210.31,
        city: "Nantes",
        context: "44, Loire-Atlantique, Pays de la Loire",
        type: "housenumber",
        importance: 0.71547,
        depcode: "44",
        street: "Avenue de Frémeur",
        _type: "address",
      },
    },
  ],
};

function suggestion(over: Partial<AddressSuggestion> = {}): AddressSuggestion {
  return {
    id: "x",
    label: "10 Avenue de Frémeur 44000 Nantes",
    name: "10 Avenue de Frémeur",
    postcode: "44000",
    city: "Nantes",
    context: "44, Loire-Atlantique, Pays de la Loire",
    precision: "adresse",
    ...over,
  };
}

describe("geocodeUrl — le service, substituable sans toucher au code", () => {
  it("interroge la Géoplateforme par défaut", () => {
    expect(geocodeUrl({})).toBe(DEFAULT_GEOCODE_URL);
    expect(geocodeUrl({ VITE_GEOCODE_URL: "  " })).toBe(DEFAULT_GEOCODE_URL);
  });

  it("suit la variable quand elle est posée", () => {
    expect(geocodeUrl({ VITE_GEOCODE_URL: " https://geo.test/search/ " })).toBe("https://geo.test/search/");
  });
});

describe("addressSearchUrl", () => {
  it("complète pendant la frappe, cinq propositions au plus", () => {
    const url = new URL(addressSearchUrl("10 av frem", BASE)!);
    expect(url.origin + url.pathname).toBe(BASE);
    expect(url.searchParams.get("q")).toBe("10 av frem");
    expect(url.searchParams.get("autocomplete")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("ne pose pas de requête trop courte", () => {
    expect(addressSearchUrl("ru", BASE)).toBeNull();
    expect(addressSearchUrl("   ", BASE)).toBeNull();
    expect(addressSearchUrl("a".repeat(MIN_QUERY_LENGTH), BASE)).not.toBeNull();
  });

  it("ne jette pas sur une base mal configurée — la saisie libre reste entière", () => {
    expect(addressSearchUrl("10 rue neuve", "pas une url")).toBeNull();
  });
});

describe("parseAddressSuggestions", () => {
  it("lit une réponse réelle, ignore les champs inconnus et ne garde aucune coordonnée", () => {
    const [s] = parseAddressSuggestions(REAL_RESPONSE);
    expect(s).toEqual({
      id: "44109_3356_00010",
      label: "10 Avenue de Frémeur 44000 Nantes",
      name: "10 Avenue de Frémeur",
      postcode: "44000",
      city: "Nantes",
      context: "44, Loire-Atlantique, Pays de la Loire",
      precision: "adresse",
    });
  });

  it("rend une liste vide sur toute forme inattendue — jamais d'exception", () => {
    for (const raw of [null, undefined, 42, "texte", {}, { features: "non" }, { features: [] }, { features: [null, 3] }]) {
      expect(parseAddressSuggestions(raw)).toEqual([]);
    }
  });

  it("saute les entrées sans libellé et garde les bonnes", () => {
    const parsed = parseAddressSuggestions({
      features: [
        { properties: { score: 1 } },
        { properties: { label: "   " } },
        { properties: "non" },
        REAL_RESPONSE.features[0],
      ],
    });
    expect(parsed.map((s) => s.label)).toEqual(["10 Avenue de Frémeur 44000 Nantes"]);
  });

  it("se contente d'un libellé : identifiant et nom en découlent", () => {
    const [s] = parseAddressSuggestions({ features: [{ properties: { label: "Nantes" } }] });
    expect(s).toEqual({
      id: "Nantes",
      label: "Nantes",
      name: "Nantes",
      postcode: "",
      city: "",
      context: "",
      precision: "commune",
    });
  });

  it("traduit le type BAN en finesse, l'inconnu vers la plus large", () => {
    const of = (type: unknown) =>
      parseAddressSuggestions({ features: [{ properties: { label: "L", type } }] })[0]!.precision;
    expect(of("housenumber")).toBe("adresse");
    expect(of("street")).toBe("voie");
    expect(of("locality")).toBe("lieu_dit");
    expect(of("municipality")).toBe("commune");
    expect(of("galaxie")).toBe("commune");
    expect(of(undefined)).toBe("commune");
  });
});

describe("suggestionContext", () => {
  it("montre le contexte départemental, à défaut la commune", () => {
    expect(suggestionContext(suggestion())).toBe("44, Loire-Atlantique, Pays de la Loire");
    expect(suggestionContext(suggestion({ context: "" }))).toBe("44000 Nantes");
    expect(suggestionContext(suggestion({ context: "", postcode: "", city: "" }))).toBe("");
  });
});
