/**
 * Le client du suivi parle au relais de MÊME ORIGINE (`/api`), jamais à
 * `VITE_PORTAL_API_URL` : le cookie de session est de première partie.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { endSuivi, fetchSuiviDemande, openSuivi, suiviPieceHref } from "./suiviClient.ts";

const ACCESS = { reference: "DEM-2026-000123", email: "a@b.fr", code: "ABCD-EFGH-JK" };

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const DEMANDE = {
  reference: "DEM-2026-000123",
  subject: "Un objet",
  demarcheName: "Une démarche",
  status: "en_cours",
  receivedAt: "2026-10-01T08:00:00Z",
  updatedAt: "2026-10-02T08:00:00Z",
  closedAt: null,
  closureText: null,
  pieces: [{ id: "p1", fileName: "a.pdf", mimeType: "application/pdf", size: 1200 }],
  messages: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("openSuivi", () => {
  it("poste sur /api avec l'en-tête anti-CSRF, sans toucher à l'adresse directe de l'API", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "https://direct.supabase.example");
    const fetchMock = vi.fn(async () => respond({ authenticated: true, kind: "guest", expiresAt: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await openSuivi(ACCESS)).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/suivi");
    expect((init.headers as Record<string, string>)["x-nora-request"]).toBe("1");
    expect(JSON.parse(init.body as string)).toEqual(ACCESS);
    expect(init.credentials).toBeUndefined();
  });

  it("rend le refus générique tel quel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "suivi_refused", message: "x" } }, 404)));
    expect(await openSuivi(ACCESS)).toEqual({ ok: false, reason: "suivi_refused" });
  });

  it("un code inconnu vaut « indisponible »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "wat" } }, 500)));
    expect(await openSuivi(ACCESS)).toEqual({ ok: false, reason: "suivi_unavailable" });
  });

  it("une coupure vaut `network`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await openSuivi(ACCESS)).toEqual({ ok: false, reason: "network" });
  });
});

describe("fetchSuiviDemande", () => {
  it("rend la demande", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ demande: DEMANDE })));
    const result = await fetchSuiviDemande();
    expect(result.ok && result.demande.reference).toBe("DEM-2026-000123");
    expect(result.ok && result.demande.pieces).toHaveLength(1);
  });

  it("401 session_required : pas d'accès ouvert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "session_required" } }, 401)));
    expect(await fetchSuiviDemande()).toEqual({ ok: false, reason: "session_required" });
  });

  it("une réponse 200 illisible est une indisponibilité", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ demande: { reference: "X" } })));
    expect(await fetchSuiviDemande()).toEqual({ ok: false, reason: "suivi_unavailable" });
  });

  it("des listes absentes valent des listes vides", async () => {
    const { pieces: _p, messages: _m, ...sansListes } = DEMANDE;
    vi.stubGlobal("fetch", vi.fn(async () => respond({ demande: sansListes })));
    const result = await fetchSuiviDemande();
    expect(result.ok && result.demande.messages).toEqual([]);
  });
});

describe("endSuivi", () => {
  it("poste sur /api/v1/session/fin avec l'en-tête", async () => {
    const fetchMock = vi.fn(async () => respond({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await endSuivi()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/session/fin");
    expect(init.method).toBe("POST");
  });
});

describe("suiviPieceHref", () => {
  it("pointe le relais de même origine", () => {
    expect(suiviPieceHref("p 1")).toBe("/api/v1/suivi/demande/pieces/p%201");
  });
});
