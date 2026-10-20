import { afterEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("./accountClient.ts", () => ({
  fetchSessionKind: () => (calls.push("session"), Promise.resolve("account")),
  fetchAccount: () => (calls.push("account"), Promise.resolve({ ok: true })),
}));
vi.mock("./profilClient.ts", () => ({ fetchProfil: () => (calls.push("profil"), Promise.resolve({ ok: true })) }));
vi.mock("./mesDemandesClient.ts", () => ({
  fetchMesDemandes: () => (calls.push("mesDemandes"), Promise.resolve({ ok: true })),
  fetchMaDemande: (id: string) => (calls.push("maDemande:" + id), Promise.resolve({ ok: true, id })),
}));

const { maDemandeKey, resetEarlyFetches, startEarlyFetches, takeEarly } = await import("./earlyFetch.ts");

const ID = "242e0b2e-091e-4437-b633-18fde46e80c9";

afterEach(() => {
  calls.length = 0;
  resetEarlyFetches();
});

describe("startEarlyFetches", () => {
  it("la session part toujours ; les données de la page d'arrivée avec elle", () => {
    startEarlyFetches("/");
    expect(calls).toEqual(["session"]);
    calls.length = 0;
    startEarlyFetches("/compte");
    expect(calls).toEqual(["session", "account", "profil"]);
    calls.length = 0;
    startEarlyFetches("/en/compte/demandes/");
    expect(calls).toEqual(["session", "mesDemandes"]);
    calls.length = 0;
    startEarlyFetches("/compte/demandes/" + ID.toUpperCase());
    expect(calls).toEqual(["session", "maDemande:" + ID.toUpperCase()]);
  });

  it("un chemin inconnu ou forgé ne lance rien de plus que la session", () => {
    startEarlyFetches("/compte/demandes/pas-un-id");
    startEarlyFetches("/demarches/x");
    expect(calls).toEqual(["session", "session"]);
  });
});

describe("takeEarly", () => {
  it("sert la réponse déjà en route UNE fois, puis repart au serveur", async () => {
    startEarlyFetches("/compte/demandes/" + ID);
    calls.length = 0;
    const start = vi.fn(() => Promise.resolve("neuf"));
    expect(await takeEarly(maDemandeKey(ID), start)).toEqual({ ok: true, id: ID });
    expect(start).not.toHaveBeenCalled();
    expect(await takeEarly(maDemandeKey(ID), start)).toBe("neuf");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("une autre demande que celle de l'adresse ne reçoit pas sa réponse", async () => {
    startEarlyFetches("/compte/demandes/" + ID);
    const other = "11111111-1111-4111-8111-111111111111";
    expect(await takeEarly(maDemandeKey(other), () => Promise.resolve("autre"))).toBe("autre");
  });
});
