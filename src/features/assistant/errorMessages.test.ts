import { describe, expect, it } from "vitest";
import type { AssistantClientFailure } from "@/services/portal/portalClient.ts";
import { assistantErrorMessage } from "./errorMessages.ts";

const ALL: AssistantClientFailure[] = [
  "assistant_closed",
  "assistant_not_configured",
  "assistant_unavailable",
  "assistant_quota_exceeded",
  "assistant_rate_limited",
  "challenge_required",
  "conversation_ended",
  "bad_request",
  "not_configured",
  "network",
];

describe("assistantErrorMessage", () => {
  it("couvre tous les échecs possibles", () => {
    for (const reason of ALL) {
      const message = assistantErrorMessage({ reason }, "fr");
      expect(message.title, reason).toBeTruthy();
      expect(message.detail, reason).toBeTruthy();
    }
  });

  it("rappelle que les démarches restent accessibles, pour les échecs explicitement listés", () => {
    // La liste que l'écran doit couvrir « pour CHAQUE échec » : voir la fiche
    // de mission. Chacun rassure sur la disponibilité des démarches.
    const listed: AssistantClientFailure[] = [
      "assistant_unavailable",
      "assistant_not_configured",
      "assistant_quota_exceeded",
      "conversation_ended",
      "bad_request",
    ];
    for (const reason of listed) {
      const message = assistantErrorMessage({ reason }, "fr");
      expect(message.title + " " + message.detail, reason).toMatch(/démarche/i);
    }
  });

  it("ne propose de réessayer que quand cela peut aboutir", () => {
    expect(assistantErrorMessage({ reason: "assistant_quota_exceeded" }, "fr").retryable).toBe(false);
    expect(assistantErrorMessage({ reason: "conversation_ended" }, "fr").retryable).toBe(false);
    expect(assistantErrorMessage({ reason: "bad_request" }, "fr").retryable).toBe(false);
    expect(assistantErrorMessage({ reason: "assistant_not_configured" }, "fr").retryable).toBe(false);

    expect(assistantErrorMessage({ reason: "assistant_unavailable" }, "fr").retryable).toBe(true);
    expect(assistantErrorMessage({ reason: "assistant_rate_limited" }, "fr").retryable).toBe(true);
    expect(assistantErrorMessage({ reason: "network" }, "fr").retryable).toBe(true);
  });

  it("cadencé : dit le délai quand le serveur l'a donné", () => {
    const withDelay = assistantErrorMessage({ reason: "assistant_rate_limited", retryAfterSeconds: 17 }, "fr");
    expect(withDelay.detail).toContain("17");

    const withoutDelay = assistantErrorMessage({ reason: "assistant_rate_limited" }, "fr");
    expect(withoutDelay.detail).not.toContain("undefined");
    expect(withoutDelay.detail).toBeTruthy();
  });

  it("cadencé : le dernier message n'est jamais dit perdu", () => {
    const message = assistantErrorMessage({ reason: "assistant_rate_limited", retryAfterSeconds: 5 }, "fr");
    expect(message.detail.toLowerCase()).toContain("perdu");
  });

  it("`not_configured` reste le message d'exploitation du portail, non traduit", () => {
    const message = assistantErrorMessage({ reason: "not_configured" }, "en");
    expect(message.title).toBe("Portail non configuré");
  });

  it("ne parle jamais au visiteur du Socle, d'une clé ni d'un jeton", () => {
    for (const reason of ALL) {
      if (reason === "not_configured") continue; // Seul message destiné à un exploitant.
      const { title, detail } = assistantErrorMessage({ reason }, "fr");
      expect((title + " " + detail).toLowerCase(), reason).not.toMatch(
        /socle|tenant|clé api|api key|token|ticket|signature/,
      );
    }
  });
});
