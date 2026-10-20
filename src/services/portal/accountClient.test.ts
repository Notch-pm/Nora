/**
 * Le client du compte parle au relais de MÊME ORIGINE (`/api`) — sauf le défi
 * anti-robot, sans état et sans cookie, qui suit le chemin du dépôt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueChallenge, verifySolution } from "@fn/_shared/ai/challenge.ts";
import {
  changePassword,
  confirmAccount,
  endAccountSession,
  fetchAccount,
  fetchSessionKind,
  login,
  loginTotp,
  registerAccount,
  requestPasswordReset,
  resendConfirmation,
  resetPassword,
  startTotp,
} from "./accountClient.ts";

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Call = [string, RequestInit | undefined];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("login", () => {
  it("poste sur /api avec l'en-tête anti-CSRF, sans toucher à l'adresse directe de l'API", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "https://direct.supabase.example");
    const fetchMock = vi.fn(async () => respond({ authenticated: true, kind: "account", expiresAt: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { email: "a@b.fr", password: "x", remember: true };
    expect(await login(input)).toEqual({ ok: true, value: { kind: "session" } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe("/api/v1/compte/connexion");
    expect((init?.headers as Record<string, string>)["x-nora-request"]).toBe("1");
    expect(JSON.parse(init?.body as string)).toEqual(input);
    expect(init?.credentials).toBeUndefined();
  });

  it("rend le ticket quand un second facteur est exigé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ authenticated: false, mfaRequired: true, ticket: "t.k" })));
    expect(await login({ email: "a@b.fr", password: "x", remember: false })).toEqual({
      ok: true,
      value: { kind: "mfa", ticket: "t.k" },
    });
  });

  it("une réponse 200 illisible est une indisponibilité", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ authenticated: false })));
    expect(await login({ email: "a@b.fr", password: "x", remember: false })).toEqual({
      ok: false,
      reason: "account_unavailable",
    });
  });

  it("rend l'échec générique tel quel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "credentials_invalid", message: "x" } }, 401)));
    expect(await login({ email: "a@b.fr", password: "x", remember: false })).toEqual({
      ok: false,
      reason: "credentials_invalid",
    });
  });

  it("un code inconnu vaut « indisponible »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "wat" } }, 500)));
    expect(await login({ email: "a@b.fr", password: "x", remember: false })).toEqual({
      ok: false,
      reason: "account_unavailable",
    });
  });

  it("une coupure vaut `network`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await login({ email: "a@b.fr", password: "x", remember: false })).toEqual({ ok: false, reason: "network" });
  });
});

describe("loginTotp", () => {
  it("envoie le ticket et le code", async () => {
    const fetchMock = vi.fn(async () => respond({ authenticated: true, kind: "account" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loginTotp({ ticket: "t", code: "123456" })).toEqual({ ok: true, value: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe("/api/v1/compte/connexion/totp");
    expect(JSON.parse(init?.body as string)).toEqual({ ticket: "t", code: "123456" });
  });
});

describe("registerAccount", () => {
  it("n'appelle rien sans les conditions acceptées ni avec une adresse invalide", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await registerAccount({ email: "a@b.fr", cguAccepted: false })).toEqual({
      ok: false,
      reason: "cgu_required",
    });
    expect(await registerAccount({ email: "pas une adresse", cguAccepted: true })).toEqual({
      ok: false,
      reason: "email_invalid",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("résout un défi LIÉ à l'adresse normalisée et le joint à l'inscription", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "https://direct.supabase.example");
    const challenge = await issueChallenge("secret", Math.floor(Date.now() / 1000), 4);
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        return url.endsWith("/v1/defi") ? respond({ challenge }) : respond({ ok: true });
      }),
    );
    expect(await registerAccount({ email: "  Alice@Exemple.FR ", cguAccepted: true })).toEqual({
      ok: true,
      value: null,
    });
    expect(calls[0][0]).toBe("https://direct.supabase.example/v1/defi");
    expect(calls[1][0]).toBe("/api/v1/compte/inscription");
    const sent = JSON.parse(calls[1][1]?.body as string);
    expect(sent.cguAccepted).toBe(true);
    expect("password" in sent).toBe(false);
    expect(sent.email).toBe("  Alice@Exemple.FR ");
    expect(await verifySolution("secret", sent.challenge, Math.floor(Date.now() / 1000), "alice@exemple.fr")).toBe(true);
  });

  it("tente quand même l'inscription sans défi disponible", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "https://direct.supabase.example");
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        return url.endsWith("/v1/defi") ? respond({}, 404) : respond({ ok: true });
      }),
    );
    expect((await registerAccount({ email: "a@b.fr", cguAccepted: true })).ok).toBe(true);
    expect("challenge" in JSON.parse(calls[1][1]?.body as string)).toBe(false);
  });

  it("rend les règles non respectées d'un mot de passe faible, sans en inventer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ error: { code: "password_weak", rules: ["length", "wat", "digit"] } }, 400)),
    );
    expect(await registerAccount({ email: "a@b.fr", cguAccepted: true })).toEqual({
      ok: false,
      reason: "password_weak",
      rules: ["length", "digit"],
    });
  });

  it("428 challenge_required est rendu tel quel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "challenge_required" } }, 428)));
    expect(await registerAccount({ email: "a@b.fr", cguAccepted: true })).toEqual({
      ok: false,
      reason: "challenge_required",
    });
  });
});

describe("liens à jeton", () => {
  it("confirmation : le jeton part dans le corps, jamais dans l'adresse", async () => {
    const fetchMock = vi.fn(async () => respond({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await confirmAccount("abc.def", "Mot de passe 12!")).toEqual({ ok: true, value: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as Call;
    expect(url).toBe("/api/v1/compte/confirmation");
    expect(JSON.parse(init?.body as string)).toEqual({ jeton: "abc.def", password: "Mot de passe 12!" });
  });

  it("410 link_invalid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "link_invalid" } }, 410)));
    expect(await resetPassword("abc", "x")).toEqual({ ok: false, reason: "link_invalid" });
  });
});

describe("défi sur les liens envoyés par courriel", () => {
  it.each([
    ["renvoi", resendConfirmation, "/api/v1/compte/confirmation/renvoi"],
    ["mot de passe oublié", requestPasswordReset, "/api/v1/compte/mot-de-passe-oublie"],
  ] as const)("%s : défi lié à l'adresse normalisée", async (_name, fn, path) => {
    vi.stubEnv("VITE_PORTAL_API_URL", "https://direct.supabase.example");
    const challenge = await issueChallenge("secret", Math.floor(Date.now() / 1000), 4);
    const calls: Call[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      return url.endsWith("/v1/defi") ? respond({ challenge }) : respond({ ok: true });
    }));
    expect(await fn(" Bob@Exemple.fr ")).toEqual({ ok: true, value: null });
    expect(calls[1][0]).toBe(path);
    const sent = JSON.parse(calls[1][1]?.body as string);
    expect(await verifySolution("secret", sent.challenge, Math.floor(Date.now() / 1000), "bob@exemple.fr")).toBe(true);
  });

  it("429 too_many_emails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "too_many_emails" } }, 429)));
    expect(await resendConfirmation("a@b.fr")).toEqual({ ok: false, reason: "too_many_emails" });
  });
});

describe("compte connecté", () => {
  it("lit le profil", async () => {
    const fetchMock = vi.fn(async () => respond({ compte: { email: "a@b.fr", totpEnabled: false } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAccount()).toEqual({ ok: true, value: { email: "a@b.fr", totpEnabled: false } });
    expect((fetchMock.mock.calls[0] as unknown as Call)[0]).toBe("/api/v1/compte");
  });

  it("401 session_required", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "session_required" } }, 401)));
    expect(await fetchAccount()).toEqual({ ok: false, reason: "session_required" });
  });

  it("un profil illisible est une indisponibilité", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ compte: { email: "a@b.fr" } })));
    expect(await fetchAccount()).toEqual({ ok: false, reason: "account_unavailable" });
  });

  it("changement de mot de passe", async () => {
    const fetchMock = vi.fn(async () => respond({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await changePassword({ current: "a", password: "b" });
    expect((fetchMock.mock.calls[0] as unknown as Call)[0]).toBe("/api/v1/compte/mot-de-passe/changement");
  });

  it("activation : refuse une URI qui n'est pas otpauth://", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ secret: "ABCD", uri: "https://evil.example" })));
    expect(await startTotp({ password: "x" })).toEqual({ ok: false, reason: "account_unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => respond({ secret: "ABCD", uri: "otpauth://totp/x?secret=ABCD" })));
    expect(await startTotp({ password: "x" })).toEqual({ ok: true, value: { secret: "ABCD", uri: "otpauth://totp/x?secret=ABCD" } });
  });

  it("réenrôlement : le code actuel part avec le mot de passe, seulement s'il est fourni", async () => {
    const fetchMock = vi.fn(async () => respond({ secret: "AB", uri: "otpauth://totp/x" }));
    vi.stubGlobal("fetch", fetchMock);
    await startTotp({ password: "p", code: "123456" });
    await startTotp({ password: "p" });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(((c as unknown as Call)[1])?.body as string));
    expect(bodies).toEqual([{ password: "p", code: "123456" }, { password: "p" }]);
  });

  it("déconnexion : le statut seul compte", async () => {
    const fetchMock = vi.fn(async () => respond({ authenticated: false }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await endAccountSession()).toEqual({ ok: true, value: null });
    expect((fetchMock.mock.calls[0] as unknown as Call)[0]).toBe("/api/v1/session/fin");
  });
});

describe("fetchSessionKind", () => {
  it("distingue un compte, un invité et personne", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ authenticated: true, kind: "account" })));
    expect(await fetchSessionKind()).toBe("account");
    vi.stubGlobal("fetch", vi.fn(async () => respond({ authenticated: true, kind: "guest" })));
    expect(await fetchSessionKind()).toBe("guest");
    vi.stubGlobal("fetch", vi.fn(async () => respond({ authenticated: false })));
    expect(await fetchSessionKind()).toBe("none");
  });

  it("une panne ne lève jamais", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await fetchSessionKind()).toBe("none");
    vi.stubGlobal("fetch", vi.fn(async () => respond({}, 503)));
    expect(await fetchSessionKind()).toBe("none");
  });
});
