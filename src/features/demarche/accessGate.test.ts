import { describe, expect, it } from "vitest";
import { accessGate, gateAfterRefusal } from "./accessGate.ts";

describe("accessGate", () => {
  it("une démarche libre est toujours ouverte", () => {
    for (const session of [null, "none", "guest", "account"] as const) {
      expect(accessGate({ accessMode: "libre", session, profil: "unknown" })).toBe("open");
    }
  });

  it("réservée : attend la session, renvoie à la connexion sans compte", () => {
    expect(accessGate({ accessMode: "authentifie", session: null, profil: "unknown" })).toBe("pending");
    expect(accessGate({ accessMode: "authentifie", session: "none", profil: "unknown" })).toBe("login");
    // Une session invitée (suivi) n'est pas un compte.
    expect(accessGate({ accessMode: "authentifie", session: "guest", profil: "unknown" })).toBe("login");
  });

  it("réservée, connecté : le profil décide", () => {
    expect(accessGate({ accessMode: "authentifie", session: "account", profil: "unknown" })).toBe("pending");
    expect(accessGate({ accessMode: "authentifie", session: "account", profil: "empty" })).toBe("complete");
    expect(accessGate({ accessMode: "authentifie", session: "account", profil: "filled" })).toBe("open");
    expect(accessGate({ accessMode: "authentifie", session: "account", profil: "unavailable" })).toBe("open");
  });
});

describe("gateAfterRefusal", () => {
  it("profil vide : compléter ; sinon se connecter", () => {
    expect(gateAfterRefusal("account", "empty")).toBe("complete");
    expect(gateAfterRefusal("account", "filled")).toBe("login");
    expect(gateAfterRefusal("none", "unknown")).toBe("login");
    expect(gateAfterRefusal(null, "unknown")).toBe("login");
  });
});
