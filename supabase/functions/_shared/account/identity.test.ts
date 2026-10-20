import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentityProvider } from "./identity.ts";

const calls: { url: string; method: string; body: unknown; auth: string | null }[] = [];

function stub(replies: Record<string, { status: number; body: unknown }>) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace("https://nora.supabase.co/auth/v1", "");
      const headers = init.headers as Record<string, string>;
      calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null, auth: headers.Authorization ?? null });
      const key = Object.keys(replies).find((k) => path.startsWith(k));
      const reply = key ? replies[key] : { status: 404, body: {} };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    }),
  );
}

const idp = () => createIdentityProvider({ url: "https://nora.supabase.co/", serviceKey: "service" });

afterEach(() => vi.unstubAllGlobals());

describe("identité GoTrue", () => {
  it("crée une identité NON confirmée, et reconnaît une adresse déjà prise", async () => {
    stub({ "/admin/users": { status: 200, body: { id: "u1", email: "a@b.fr" } } });
    expect(await idp().createUser("a@b.fr", "x")).toEqual({ kind: "created", userId: "u1" });
    expect(calls[0].body).toEqual({ email: "a@b.fr", password: "x", email_confirm: false });
    stub({ "/admin/users": { status: 422, body: { code: 422, error_code: "email_exists" } } });
    expect(await idp().createUser("a@b.fr", "x")).toEqual({ kind: "exists" });
  });

  it("vérifie un lien par empreinte (type email) puis révoque la session GoTrue", async () => {
    stub({
      "/verify": { status: 200, body: { access_token: "jwt", user: { id: "u1" } } },
      "/logout": { status: 204, body: {} },
    });
    expect(await idp().verifyLink("magiclink", "hash")).toEqual({ kind: "ok", userId: "u1" });
    expect(calls[0].body).toEqual({ type: "email", token_hash: "hash" });
    expect(calls[1]).toMatchObject({ url: "/logout?scope=local", auth: "Bearer jwt" });
  });

  it("mot de passe : juste, faux, adresse non confirmée, GoTrue indisponible", async () => {
    stub({ "/token": { status: 200, body: { access_token: "jwt", user: { id: "u1" } } }, "/logout": { status: 204, body: {} } });
    expect(await idp().checkPassword("a@b.fr", "x")).toEqual({ kind: "ok", userId: "u1" });
    stub({ "/token": { status: 400, body: { error_code: "invalid_credentials" } } });
    expect(await idp().checkPassword("a@b.fr", "x")).toEqual({ kind: "invalid" });
    stub({ "/token": { status: 400, body: { error_code: "email_not_confirmed" } } });
    expect(await idp().checkPassword("a@b.fr", "x")).toEqual({ kind: "unconfirmed" });
    stub({ "/token": { status: 429, body: {} } });
    expect(await idp().checkPassword("a@b.fr", "x")).toEqual({ kind: "unavailable" });
  });

  it("rend le jeton d'un lien sans rien envoyer", async () => {
    stub({ "/admin/generate_link": { status: 200, body: { properties: { hashed_token: "h1" } } } });
    expect(await idp().linkToken("recovery", "a@b.fr")).toBe("h1");
    expect(calls[0].body).toEqual({ type: "recovery", email: "a@b.fr" });
    stub({ "/admin/generate_link": { status: 404, body: {} } });
    expect(await idp().linkToken("recovery", "a@b.fr")).toBeNull();
  });
});
