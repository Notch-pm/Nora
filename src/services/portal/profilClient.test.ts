/** Le profil parle au relais de MÊME ORIGINE, avec l'en-tête anti-CSRF sur l'écriture. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProfil, saveCoordonnees, saveIdentite } from "./profilClient.ts";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Call = [string, RequestInit | undefined];

const PROFIL = {
  civilite: "madame", prenom: "Anne", nom: "Martin", nomUsage: null, dateNaissance: "1980-02-03",
  courriel: "a@b.fr", mobile: null, fixe: null, adresse1: "1 rue X", adresse2: null, codePostal: "46000", ville: "Cahors",
  consentements: { traitement: null, partage: null },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("fetchProfil", () => {
  it("lit sur /api, sans toucher à l'adresse directe de l'API", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "https://direct.supabase.example");
    const fetchMock = vi.fn(async () => respond({ profil: PROFIL }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchProfil();
    expect(result).toEqual({ ok: true, value: PROFIL });
    expect((fetchMock.mock.calls[0] as unknown as Call)[0]).toBe("/api/v1/compte/profil");
  });

  it("rend null quand le profil n'a jamais été rempli", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ profil: null })));
    expect(await fetchProfil()).toEqual({ ok: true, value: null });
  });

  it("un corps illisible est une indisponibilité", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({})));
    expect(await fetchProfil()).toEqual({ ok: false, reason: "profil_indisponible" });
  });

  it("session_required reste lisible, un code inconnu devient indisponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "session_required" } }, 401)));
    expect(await fetchProfil()).toEqual({ ok: false, reason: "session_required" });
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "bizarre" } }, 500)));
    expect(await fetchProfil()).toEqual({ ok: false, reason: "profil_indisponible" });
  });

  it("panne réseau", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("x"); }));
    expect(await fetchProfil()).toEqual({ ok: false, reason: "network" });
  });
});

describe("saveIdentite / saveCoordonnees", () => {
  it("postent avec x-nora-request et rendent le profil", async () => {
    const fetchMock = vi.fn(async () => respond({ profil: PROFIL }));
    vi.stubGlobal("fetch", fetchMock);
    const coordonnees = { mobile: "0612345678", ville: "Cahors" };
    expect(await saveCoordonnees(coordonnees)).toEqual({ ok: true, value: PROFIL });
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe("/api/v1/compte/profil");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["x-nora-request"]).toBe("1");
    expect(JSON.parse(init?.body as string)).toEqual(coordonnees);
    expect(await saveIdentite({
      civilite: "madame", prenom: "Anne", nom: "Martin", nomUsage: null, dateNaissance: null, mobile: null, fixe: null,
      adresse1: "1 rue X", adresse2: null, codePostal: "46000", ville: "Cahors",
    })).toEqual({ ok: true, value: PROFIL });
  });

  it("rend les champs refusés par le serveur, sans les inconnus", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "profil_invalide", champs: ["codePostal", "inconnu"] } }, 400)));
    expect(await saveCoordonnees({ codePostal: "12" })).toEqual({ ok: false, reason: "profil_invalide", champs: ["codePostal"] });
  });

  it("un profil null après une écriture est une indisponibilité", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ profil: null })));
    expect(await saveCoordonnees({ ville: "X" })).toEqual({ ok: false, reason: "profil_indisponible" });
  });
});
