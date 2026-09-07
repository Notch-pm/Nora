import { describe, expect, it } from "vitest";
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";
import { errorMessageFor } from "./errorMessages.ts";

const ALL: PortalLoadFailure[] = [
  "invalid_hostname",
  "unknown_domain",
  "tenant_unavailable",
  "socle_unavailable",
  "socle_misconfigured",
  "not_configured",
  "network",
];

describe("errorMessageFor", () => {
  it("couvre tous les échecs possibles", () => {
    // Un cas manquant produirait un écran vide, au moment précis où l'usager a
    // besoin qu'on lui parle.
    for (const failure of ALL) {
      const message = errorMessageFor(failure, "fr");
      expect(message.title, failure).toBeTruthy();
      expect(message.detail, failure).toBeTruthy();
    }
  });

  it("ne propose de réessayer que quand cela peut aboutir", () => {
    // Un domaine qui n'existe pas n'existera pas davantage au rechargement :
    // proposer « réessayer » ferait tourner l'usager en rond.
    expect(errorMessageFor("unknown_domain", "fr").retryable).toBe(false);
    expect(errorMessageFor("invalid_hostname", "fr").retryable).toBe(false);
    expect(errorMessageFor("not_configured", "fr").retryable).toBe(false);

    expect(errorMessageFor("socle_unavailable", "fr").retryable).toBe(true);
    expect(errorMessageFor("tenant_unavailable", "fr").retryable).toBe(true);
    expect(errorMessageFor("network", "fr").retryable).toBe(true);
  });

  it("ne parle jamais au visiteur du Socle, d'une clé ni d'un tenant", () => {
    // L'usager d'une mairie ne sait pas ce qu'est un Socle, et l'apprendre ne
    // l'aiderait pas. Le vocabulaire interne reste dans le code d'erreur.
    for (const failure of ALL) {
      if (failure === "not_configured") continue; // Seul message destiné à un exploitant.
      const { title, detail } = errorMessageFor(failure, "fr");
      expect((title + " " + detail).toLowerCase(), failure).not.toMatch(
        /socle|tenant|clé api|api key|token/,
      );
    }
  });

  it("ne laisse pas croire à un refus d'accès quand la clé est en cause", () => {
    // `socle_misconfigured` est une panne d'exploitation. Écrire « accès
    // refusé » ferait croire à l'usager qu'il n'a pas le droit d'être là.
    const message = errorMessageFor("socle_misconfigured", "fr");
    expect(message).toEqual(errorMessageFor("socle_unavailable", "fr"));
    expect((message.title + message.detail).toLowerCase()).not.toMatch(/refus|interdit|droit/);
  });
});
