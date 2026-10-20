/** « Mes demandes » parle au relais de MÊME ORIGINE ; la forme seulement est relue. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMaDemande, fetchMesDemandes, maDemandePieceHref } from "./mesDemandesClient.ts";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const RESUME = {
  id: "11111111-1111-4111-8111-111111111111", reference: "D-2026-0001", subject: "Voirie", demarcheName: null,
  status: "en_cours", receivedAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", closedAt: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchMesDemandes", () => {
  it("lit la première page sur /api, puis passe le curseur encodé", async () => {
    const fetchMock = vi.fn(async () => respond({ demandes: [RESUME], suivante: "2026-10-01T10:00:00.000Z", profilRequis: false }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchMesDemandes()).toEqual({
      ok: true,
      value: { demandes: [RESUME], suivante: "2026-10-01T10:00:00.000Z", profilRequis: false },
    });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/v1/compte/demandes");
    await fetchMesDemandes("2026-10-01T10:00:00+02:00");
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe("/api/v1/compte/demandes?avant=2026-10-01T10%3A00%3A00%2B02%3A00");
  });

  it("écarte une ligne au statut inconnu, et lit profilRequis", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ demandes: [{ ...RESUME, status: "?" }], suivante: null, profilRequis: true })));
    expect(await fetchMesDemandes()).toEqual({ ok: true, value: { demandes: [], suivante: null, profilRequis: true } });
  });

  it("session_required, corps illisible, réseau", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "session_required" } }, 401)));
    expect(await fetchMesDemandes()).toEqual({ ok: false, reason: "session_required" });
    vi.stubGlobal("fetch", vi.fn(async () => respond({ nope: 1 })));
    expect(await fetchMesDemandes()).toEqual({ ok: false, reason: "suivi_unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("x"); }));
    expect(await fetchMesDemandes()).toEqual({ ok: false, reason: "network" });
  });
});

describe("fetchMaDemande", () => {
  it("lit le détail et rend les refus du suivi", async () => {
    const detail = { ...RESUME, closureText: null, pieces: [], messages: [] };
    const fetchMock = vi.fn(async () => respond({ demande: detail }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchMaDemande(RESUME.id);
    expect(result.ok && result.value.reference).toBe("D-2026-0001");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/v1/compte/demandes/" + RESUME.id);
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "suivi_refused" } }, 404)));
    expect(await fetchMaDemande(RESUME.id)).toEqual({ ok: false, reason: "suivi_refused" });
  });
});

it("le lien d'une pièce passe par le relais de même origine", () => {
  expect(maDemandePieceHref("a", "b")).toBe("/api/v1/compte/demandes/a/pieces/b");
});
