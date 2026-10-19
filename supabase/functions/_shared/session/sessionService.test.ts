/**
 * Les sessions de bout en bout, contre une base simulée qui applique les mêmes
 * règles que `citizen_session_resolve` (tenant, fin de vie, inactivité).
 *
 * C'est ici que se vérifie l'isolation : une session ne vaut que pour SA
 * collectivité, n'existe pas hors proxy, et ne survit ni à la déconnexion ni à
 * l'inactivité.
 */
import { describe, expect, it } from "vitest";
import type { ProxyContext } from "../http/proxy.ts";
import { DEFAULT_SESSION_POLICY } from "./sessionPolicy.ts";
import type { OpenSessionInput, SessionRecord, SessionStore } from "./sessionStore.ts";
import {
  checkMutation,
  currentSession,
  endSession,
  openSession,
  type SessionContext,
  traceOf,
} from "./sessionService.ts";
import { SESSION_COOKIE } from "./sessionToken.ts";

const SCEAUX = "aaaaaaaa-0000-4000-8000-000000000001";
const ANTONY = "aaaaaaaa-0000-4000-8000-000000000002";
const ACCOUNT = "bbbbbbbb-0000-4000-8000-000000000001";

const SCEAUX_PROXY: ProxyContext = { proxied: true, host: "sceaux.edilumen.fr", clientIp: "203.0.113.9" };
const ANTONY_PROXY: ProxyContext = { proxied: true, host: "antony.edilumen.fr", clientIp: "203.0.113.9" };
const DIRECT: ProxyContext = { proxied: false };

interface Row extends OpenSessionInput {
  openedAt: number;
  lastSeenAt: number;
  ended: boolean;
}

/** Une base de sessions en mémoire, à l'horloge réglable. */
function memoryStore() {
  let clock = 0;
  const rows = new Map<string, Row>();
  const store: SessionStore = {
    async open(input) {
      rows.set(input.idHash, { ...input, openedAt: clock, lastSeenAt: clock, ended: false });
      return { ok: true, value: new Date(clock + input.lifetimeSeconds * 1000).toISOString() };
    },
    async resolve(idHash, tenantId) {
      const row = rows.get(idHash);
      if (row === undefined || row.ended || row.tenantId !== tenantId) return { ok: true, value: null };
      const expires = row.openedAt + row.lifetimeSeconds * 1000;
      if (clock >= expires || clock >= row.lastSeenAt + row.idleSeconds * 1000) {
        row.ended = true;
        return { ok: true, value: null };
      }
      row.lastSeenAt = clock;
      const record: SessionRecord = {
        kind: row.kind,
        accountId: row.accountId,
        guestRequestId: row.guestRequestId,
        amr: row.amr,
        remember: row.remember,
        expiresAt: new Date(expires).toISOString(),
        idleExpiresAt: new Date(Math.min(expires, clock + row.idleSeconds * 1000)).toISOString(),
      };
      return { ok: true, value: record };
    },
    async close(idHash) {
      const row = rows.get(idHash);
      if (row === undefined || row.ended) return { ok: true, value: false };
      row.ended = true;
      return { ok: true, value: true };
    },
  };
  return {
    store,
    advance(ms: number) {
      clock += ms;
    },
    rows,
  };
}

function context(store: SessionStore, proxy: ProxyContext, tenantId: string): SessionContext {
  return { proxy, tenantId, store, trace: traceOf(new Headers(), proxy) };
}

/** Le cookie que le navigateur renverrait après ce `Set-Cookie`. */
function cookieFrom(setCookie: string): Headers {
  return new Headers({ cookie: setCookie.split(";")[0] });
}

async function openAccountSession(store: SessionStore) {
  const opened = await openSession(
    {
      kind: "account",
      accountId: ACCOUNT,
      guestRequestId: null,
      amr: ["pwd"],
      remember: false,
      durations: DEFAULT_SESSION_POLICY.standard,
    },
    context(store, SCEAUX_PROXY, SCEAUX),
  );
  if (!opened.ok) throw new Error("ouverture refusée");
  return opened;
}

describe("sessions de citoyen", () => {
  it("une session ouverte à Sceaux est reconnue à Sceaux", async () => {
    const db = memoryStore();
    const opened = await openAccountSession(db.store);
    expect(opened.setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

    const current = await currentSession(cookieFrom(opened.setCookie), context(db.store, SCEAUX_PROXY, SCEAUX));
    expect(current.ok && current.session.status).toBe("active");
    if (current.ok && current.session.status === "active") {
      expect(current.session.record.accountId).toBe(ACCOUNT);
    }
  });

  it("la base ne reçoit jamais le jeton, seulement son haché", async () => {
    const db = memoryStore();
    const opened = await openAccountSession(db.store);
    const token = opened.setCookie.split(";")[0].split("=")[1];
    const [stored] = [...db.rows.keys()];
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toBe(token);
  });

  it("la même session présentée sous une autre collectivité n'ouvre rien", async () => {
    const db = memoryStore();
    const opened = await openAccountSession(db.store);
    const current = await currentSession(cookieFrom(opened.setCookie), context(db.store, ANTONY_PROXY, ANTONY));
    expect(current).toEqual({ ok: true, session: { status: "anonymous", clearCookie: true } });
  });

  it("hors proxy, personne n'est connecté — même avec un cookie valable", async () => {
    const db = memoryStore();
    const opened = await openAccountSession(db.store);
    const current = await currentSession(cookieFrom(opened.setCookie), context(db.store, DIRECT, SCEAUX));
    expect(current).toEqual({ ok: true, session: { status: "anonymous", clearCookie: false } });
  });

  it("hors proxy, aucune session ne s'ouvre", async () => {
    const db = memoryStore();
    const opened = await openSession(
      {
        kind: "account",
        accountId: ACCOUNT,
        guestRequestId: null,
        amr: ["pwd"],
        remember: false,
        durations: DEFAULT_SESSION_POLICY.standard,
      },
      context(db.store, DIRECT, SCEAUX),
    );
    expect(opened).toEqual({ ok: false, reason: "csrf_rejected" });
    expect(db.rows.size).toBe(0);
  });

  it("30 minutes sans activité ferment la session ; l'activité la prolonge", async () => {
    const db = memoryStore();
    const opened = await openAccountSession(db.store);
    const ctx = context(db.store, SCEAUX_PROXY, SCEAUX);

    db.advance(29 * 60_000);
    expect((await currentSession(cookieFrom(opened.setCookie), ctx)).ok).toBe(true);
    db.advance(29 * 60_000);
    const still = await currentSession(cookieFrom(opened.setCookie), ctx);
    expect(still.ok && still.session.status).toBe("active");

    db.advance(31 * 60_000);
    const gone = await currentSession(cookieFrom(opened.setCookie), ctx);
    expect(gone).toEqual({ ok: true, session: { status: "anonymous", clearCookie: true } });
  });

  it("la déconnexion clôt la session et efface le cookie", async () => {
    const db = memoryStore();
    const opened = await openAccountSession(db.store);
    const ctx = context(db.store, SCEAUX_PROXY, SCEAUX);

    const ended = await endSession(cookieFrom(opened.setCookie), ctx);
    expect(ended.ok && ended.setCookie).toContain("Max-Age=0");
    const after = await currentSession(cookieFrom(opened.setCookie), ctx);
    expect(after.ok && after.session.status).toBe("anonymous");
  });

  it("une base injoignable est une panne, pas un visiteur anonyme", async () => {
    const down: SessionStore = {
      async open() {
        return { ok: false };
      },
      async resolve() {
        return { ok: false };
      },
      async close() {
        return { ok: false };
      },
    };
    const headers = new Headers({ cookie: `${SESSION_COOKIE}=${"A".repeat(43)}` });
    expect(await currentSession(headers, context(down, SCEAUX_PROXY, SCEAUX))).toEqual({
      ok: false,
      reason: "session_unavailable",
    });
  });
});

describe("checkMutation", () => {
  const sameOrigin = { "x-nora-request": "1", origin: "https://sceaux.edilumen.fr", "sec-fetch-site": "same-origin" };

  it("accepte une écriture venue d'une page du portail", () => {
    expect(checkMutation(new Headers(sameOrigin), SCEAUX_PROXY)).toEqual({ ok: true });
    // Navigateur qui ne dit pas d'où il vient : l'en-tête suffit.
    expect(checkMutation(new Headers({ "x-nora-request": "1" }), SCEAUX_PROXY)).toEqual({ ok: true });
  });

  it("refuse sans l'en-tête du portail", () => {
    expect(checkMutation(new Headers({ origin: "https://sceaux.edilumen.fr" }), SCEAUX_PROXY)).toEqual({ ok: false });
  });

  it("refuse une écriture venue d'un autre site ou d'une autre collectivité", () => {
    expect(checkMutation(new Headers({ ...sameOrigin, origin: "https://evil.example" }), SCEAUX_PROXY)).toEqual({
      ok: false,
    });
    expect(checkMutation(new Headers({ ...sameOrigin, origin: "https://antony.edilumen.fr" }), SCEAUX_PROXY)).toEqual({
      ok: false,
    });
    expect(checkMutation(new Headers({ ...sameOrigin, "sec-fetch-site": "cross-site" }), SCEAUX_PROXY)).toEqual({
      ok: false,
    });
  });

  it("refuse hors proxy", () => {
    expect(checkMutation(new Headers(sameOrigin), DIRECT)).toEqual({ ok: false });
  });
});
