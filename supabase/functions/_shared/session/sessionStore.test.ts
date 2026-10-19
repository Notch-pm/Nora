import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionStore, parseSessionRow } from "./sessionStore.ts";

const ROW = {
  kind: "account",
  account_id: "11111111-1111-4111-8111-111111111111",
  guest_request_id: null,
  amr: ["pwd"],
  remember: false,
  expires_at: "2026-10-20T00:00:00Z",
  idle_expires_at: "2026-10-19T12:30:00Z",
};

const TRACE = { ip: "203.0.113.9", userAgent: "Firefox" };

afterEach(() => vi.unstubAllGlobals());

describe("parseSessionRow", () => {
  it("lit une session de compte", () => {
    expect(parseSessionRow(ROW)).toEqual({
      kind: "account",
      accountId: ROW.account_id,
      guestRequestId: null,
      amr: ["pwd"],
      remember: false,
      expiresAt: ROW.expires_at,
      idleExpiresAt: ROW.idle_expires_at,
    });
  });

  it("refuse une session dont le sujet ne correspond pas à la nature", () => {
    expect(parseSessionRow({ ...ROW, account_id: null })).toBeNull();
    expect(parseSessionRow({ ...ROW, kind: "guest" })).toBeNull();
    expect(parseSessionRow({ ...ROW, kind: "admin" })).toBeNull();
    expect(parseSessionRow({ ...ROW, expires_at: undefined })).toBeNull();
    expect(parseSessionRow(null)).toBeNull();
  });
});

describe("createSessionStore", () => {
  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const store = () => createSessionStore({ url: "https://nora.example/", serviceKey: "service-key" });

  it("appelle la fonction SQL par PostgREST, avec la clé service role", async () => {
    const fetchMock = stubFetch(200, [ROW]);
    const result = await store().resolve("a".repeat(64), "tenant-1", TRACE);
    expect(result).toEqual({ ok: true, value: parseSessionRow(ROW) });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://nora.example/rest/v1/rpc/citizen_session_resolve");
    const sent = new Headers(init.headers);
    expect(sent.get("apikey")).toBe("service-key");
    expect(JSON.parse(String(init.body))).toEqual({
      p_id_hash: "a".repeat(64),
      p_tenant_id: "tenant-1",
      p_ip: "203.0.113.9",
      p_user_agent: "Firefox",
    });
  });

  it("une réponse vide veut dire : pas de session valable", async () => {
    stubFetch(200, []);
    expect(await store().resolve("a".repeat(64), "tenant-1", TRACE)).toEqual({ ok: true, value: null });
  });

  it("une base en erreur ou injoignable n'est jamais lue comme « pas de session »", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(404, { message: "function not found" });
    expect(await store().resolve("a".repeat(64), "tenant-1", TRACE)).toEqual({ ok: false });

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("network");
    }));
    expect(await store().resolve("a".repeat(64), "tenant-1", TRACE)).toEqual({ ok: false });
  });

  it("ouvre et clôt", async () => {
    stubFetch(200, "2026-10-20T00:00:00Z");
    const opened = await store().open(
      {
        idHash: "b".repeat(64),
        kind: "account",
        accountId: ROW.account_id,
        guestRequestId: null,
        tenantId: "tenant-1",
        amr: ["pwd"],
        remember: false,
        idleSeconds: 1800,
        lifetimeSeconds: 43_200,
      },
      TRACE,
    );
    expect(opened).toEqual({ ok: true, value: "2026-10-20T00:00:00Z" });

    stubFetch(200, true);
    expect(await store().close("b".repeat(64), "logout", TRACE)).toEqual({ ok: true, value: true });
  });
});
