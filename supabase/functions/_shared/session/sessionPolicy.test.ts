import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SESSION_POLICY, sessionPolicyFromEnv } from "./sessionPolicy.ts";

function env(values: Record<string, string>) {
  return (name: string) => values[name];
}

describe("sessionPolicyFromEnv", () => {
  it("sans réglage : 30 min d'inactivité, 12 h au plus ; rester connecté 7 j / 30 j ; invité 2 h", () => {
    expect(sessionPolicyFromEnv(env({}))).toEqual(DEFAULT_SESSION_POLICY);
    expect(DEFAULT_SESSION_POLICY.standard).toEqual({ idleSeconds: 1800, lifetimeSeconds: 43_200 });
    expect(DEFAULT_SESSION_POLICY.remember).toEqual({ idleSeconds: 604_800, lifetimeSeconds: 2_592_000 });
    expect(DEFAULT_SESSION_POLICY.guest).toEqual({ idleSeconds: 1800, lifetimeSeconds: 7200 });
  });

  it("l'inactivité réglée s'applique aux sessions standard et invitées, pas à « rester connecté »", () => {
    const policy = sessionPolicyFromEnv(env({ CITIZEN_SESSION_IDLE_MINUTES: "15" }));
    expect(policy.standard.idleSeconds).toBe(900);
    expect(policy.guest.idleSeconds).toBe(900);
    expect(policy.remember).toEqual(DEFAULT_SESSION_POLICY.remember);
  });

  it("une valeur hors bornes retombe sur le défaut, en le disant", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(sessionPolicyFromEnv(env({ CITIZEN_SESSION_IDLE_MINUTES: "0" }))).toEqual(DEFAULT_SESSION_POLICY);
    expect(sessionPolicyFromEnv(env({ CITIZEN_SESSION_IDLE_MINUTES: "trente" }))).toEqual(DEFAULT_SESSION_POLICY);
    expect(sessionPolicyFromEnv(env({ CITIZEN_SESSION_IDLE_MINUTES: "100000" }))).toEqual(DEFAULT_SESSION_POLICY);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
