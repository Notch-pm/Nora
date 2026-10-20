import { afterEach, describe, expect, it, vi } from "vitest";
import { readFragmentToken, takeFragmentToken } from "./fragmentToken.ts";

describe("readFragmentToken", () => {
  it("lit le jeton du fragment", () => {
    expect(readFragmentToken("#jeton=abc.def")).toBe("abc.def");
    expect(readFragmentToken("jeton=abc")).toBe("abc");
  });

  it("décode les caractères réservés", () => {
    expect(readFragmentToken("#jeton=a%2Bb%3D")).toBe("a+b=");
  });

  it("rend null sans jeton ou avec un jeton vide", () => {
    expect(readFragmentToken("")).toBeNull();
    expect(readFragmentToken("#")).toBeNull();
    expect(readFragmentToken("#autre=1")).toBeNull();
    expect(readFragmentToken("#jeton=")).toBeNull();
    expect(readFragmentToken("#jeton=%20")).toBeNull();
  });
});

describe("takeFragmentToken", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lit le jeton puis efface le fragment, en gardant le chemin et la requête", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { hash: "#jeton=abc", pathname: "/compte/confirmer", search: "?x=1" },
      history: { state: { idx: 2 }, replaceState },
    });
    expect(takeFragmentToken()).toBe("abc");
    expect(replaceState).toHaveBeenCalledWith({ idx: 2 }, "", "/compte/confirmer?x=1");
  });

  it("ne touche pas à l'historique quand il n'y a pas de fragment", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: { hash: "", pathname: "/compte/confirmer", search: "" },
      history: { state: null, replaceState },
    });
    expect(takeFragmentToken()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
