/**
 * Les parcours du compte, contre un GoTrue, une base et un relais simulés.
 * On y vérifie surtout ce qui ne doit PAS arriver : qu'une adresse révèle un
 * compte, qu'un pré-inscrit garde la main sur l'adresse d'un autre, qu'une
 * autre collectivité reçoive un lien, qu'un code TOTP resserve.
 */
import { describe, expect, it } from "vitest";
import { hashKey } from "../http/rateLimit.ts";
import type { AccountStore, TotpState } from "./accountStore.ts";
import { type AccountDeps, createAccountService } from "./accountService.ts";
import type { IdentityProvider, LinkType } from "./identity.ts";
import type { AccountMessage } from "./mail/messages.ts";
import { base32Decode, hotp, totpStep } from "./totp.ts";

const SCEAUX = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Ville de Sceaux" };
const ANTONY = { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Ville d'Antony" };
const PASSWORD = "Correct-cheval-9";

function world() {
  let now = 1_800_000_000;
  const users = new Map<string, { id: string; email: string; password: string; confirmed: boolean }>();
  const links = new Map<string, { type: LinkType; email: string }>();
  const accounts = new Map<string, { emailHash: string; confirmed: boolean; active: boolean; spaces: Set<string> }>();
  const guards = new Map<string, { attempts: number; lockedUntil: number }>();
  const quota = new Map<string, number>();
  const totp = new Map<string, TotpState & { lastStep: number | null }>();
  const events: string[] = [];
  const sent: { to: string; message: AccountMessage; tenant: string }[] = [];
  let mailReady = true;
  let seq = 0;

  const identity: IdentityProvider = {
    async createUser(email, password) {
      if ([...users.values()].some((u) => u.email === email)) return { kind: "exists" };
      const id = `user-${++seq}`;
      users.set(id, { id, email, password, confirmed: false });
      return { kind: "created", userId: id };
    },
    async linkToken(type, email) {
      if (![...users.values()].some((u) => u.email === email)) return null;
      const token = `jeton-de-lien-${++seq}`;
      links.set(token, { type, email });
      return token;
    },
    async verifyLink(type, token) {
      const link = links.get(token);
      if (link === undefined || link.type !== type) return { kind: "invalid" };
      links.delete(token);
      const user = [...users.values()].find((u) => u.email === link.email)!;
      if (type === "magiclink") user.confirmed = true;
      return { kind: "ok", userId: user.id };
    },
    async checkPassword(email, password) {
      const user = [...users.values()].find((u) => u.email === email);
      if (user === undefined || user.password !== password) return { kind: "invalid" };
      if (!user.confirmed) return { kind: "unconfirmed" };
      return { kind: "ok", userId: user.id };
    },
    async setPassword(id, password) {
      users.get(id)!.password = password;
      return true;
    },
    async emailOf(id) {
      return users.get(id)?.email ?? null;
    },
  };

  const okv = <T>(value: T) => ({ ok: true as const, value });
  const store: AccountStore = {
    async register(id, emailHash, tenantId) {
      if (accounts.has(id)) return okv(false);
      accounts.set(id, { emailHash, confirmed: false, active: true, spaces: new Set([tenantId]) });
      return okv(true);
    },
    async byEmail(hash, tenantId) {
      const entry = [...accounts.entries()].find(([, a]) => a.emailHash === hash);
      return okv(
        entry
          ? { accountId: entry[0], confirmed: entry[1].confirmed, active: entry[1].active, hasSpace: entry[1].spaces.has(tenantId) }
          : null,
      );
    },
    async confirm(id) {
      const a = accounts.get(id);
      if (!a) return okv(false);
      a.confirmed = true;
      return okv(true);
    },
    async forLogin(id) {
      const a = accounts.get(id);
      return okv(a ? { confirmed: a.confirmed, active: a.active, totpEnabled: totp.get(id)?.enabled === true } : null);
    },
    async ensureSpace(id, tenantId) {
      accounts.get(id)?.spaces.add(tenantId);
      return okv(null);
    },
    async loginAttempt(hash) {
      const g = guards.get(hash) ?? { attempts: 0, lockedUntil: 0 };
      guards.set(hash, g);
      if (g.lockedUntil > now) return okv(false);
      g.attempts++;
      if (g.attempts > 10) {
        g.attempts = 0;
        g.lockedUntil = now + 900;
        return okv(false);
      }
      return okv(true);
    },
    async loginSucceeded(hash) {
      guards.delete(hash);
      return okv(null);
    },
    async mailAllowed(hash) {
      const n = quota.get(hash) ?? 0;
      if (n >= 5) return okv(false);
      quota.set(hash, n + 1);
      return okv(true);
    },
    async passwordChanged() {
      events.push("password_changed");
      return okv(0);
    },
    async event(e) {
      events.push(e);
      return okv(null);
    },
    async totp(id) {
      const t = totp.get(id);
      return okv({ secretEnc: t?.secretEnc ?? null, pendingEnc: t?.pendingEnc ?? null, enabled: t?.enabled === true });
    },
    async totpSetPending(id, enc) {
      const t = totp.get(id) ?? { secretEnc: null, pendingEnc: null, enabled: false, lastStep: null };
      t.pendingEnc = enc;
      totp.set(id, t);
      return okv(null);
    },
    async totpEnable(id, step) {
      const t = totp.get(id);
      if (!t?.pendingEnc) return okv(false);
      Object.assign(t, { secretEnc: t.pendingEnc, pendingEnc: null, enabled: true, lastStep: step });
      return okv(true);
    },
    async totpUseStep(id, step) {
      const t = totp.get(id);
      if (!t?.enabled || (t.lastStep !== null && t.lastStep >= step)) return okv(false);
      t.lastStep = step;
      return okv(true);
    },
    async totpDisable(id) {
      return okv(totp.delete(id));
    },
    async spaceContact() {
      return okv(null);
    },
    async setSpaceContact() {
      return okv(true);
    },
  };

  const pending: Promise<unknown>[] = [];
  const serviceFor = (tenant: { id: string; name: string }) => {
    const deps: AccountDeps = {
      identity,
      store,
      mailer: {
        ready: async () => mailReady,
        async send(to, message) {
          sent.push({ to, message, tenant: tenant.id });
          return true;
        },
      },
      defer: (work) => pending.push(work),
      authSecret: "s".repeat(40),
      tenant,
      portalUrl: "https://ville.edilumen.fr",
      trace: { ip: "203.0.113.9", userAgent: "test" },
      nowSeconds: () => now,
      sha256: hashKey,
    };
    return createAccountService(deps);
  };
  return {
    service: serviceFor(SCEAUX),
    serviceFor,
    sent,
    events,
    users,
    /** Les envois différés, comme après la réponse. */
    flush: async () => {
      while (pending.length > 0) await pending.shift();
    },
    advance: (s: number) => (now += s),
    now: () => now,
    noMail: () => (mailReady = false),
  };
}

/** Le jeton du dernier lien envoyé (dans le fragment `#jeton=`). */
function lastToken(sent: { message: AccountMessage }[]): string {
  const match = sent[sent.length - 1].message.text.match(/#jeton=([^\s]+)/);
  if (!match) throw new Error("pas de lien");
  return decodeURIComponent(match[1]);
}

async function registeredAndConfirmed(w: ReturnType<typeof world>, email = "jeanne@example.fr") {
  expect((await w.service.register({ email, cguAccepted: true })).ok).toBe(true);
  await w.flush();
  expect((await w.service.confirm({ token: lastToken(w.sent), password: PASSWORD })).ok).toBe(true);
}

describe("inscription", () => {
  it("adresse + CGU ; le mot de passe se choisit au lien de confirmation", async () => {
    const w = world();
    expect(await w.service.register({ email: " Jeanne@Example.fr ", cguAccepted: true })).toEqual({ ok: true, value: null });
    expect(w.sent).toHaveLength(0); // différé : rien n'est parti pendant la réponse
    await w.flush();
    expect(w.sent[0].to).toBe("jeanne@example.fr");
    expect(w.sent[0].message.text).toContain("https://ville.edilumen.fr/compte/confirmer#jeton=");
    expect((await w.service.confirm({ token: lastToken(w.sent), password: PASSWORD })).ok).toBe(true);
    const login = await w.service.login({ email: "jeanne@example.fr", password: PASSWORD, remember: true });
    expect(login).toEqual({ ok: true, value: { kind: "session", session: { accountId: "user-1", amr: ["pwd"], remember: true } } });
  });

  it("⚠️ pré-inscrire l'adresse d'un autre ne donne la main sur rien", async () => {
    const w = world();
    // L'attaquant inscrit l'adresse de la victime : il ne choisit aucun mot de passe.
    await w.service.register({ email: "victime@example.fr", cguAccepted: true });
    await w.flush();
    // Le lien part à la VICTIME, qui choisit SON mot de passe.
    expect(w.sent[w.sent.length - 1].to).toBe("victime@example.fr");
    await w.service.confirm({ token: lastToken(w.sent), password: PASSWORD });
    expect(w.users.get("user-1")!.password).toBe(PASSWORD);
  });

  it("ne révèle pas qu'une adresse a déjà un compte", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    expect(await w.service.register({ email: "jeanne@example.fr", cguAccepted: true })).toEqual({ ok: true, value: null });
    await w.flush();
    expect(w.sent[w.sent.length - 1].message.subject).toBe("Vous avez déjà un compte");
  });

  it("refuse une adresse qui ferait une seconde destination, ou des CGU non acceptées", async () => {
    const w = world();
    expect((await w.service.register({ email: "x<pirate@evil.fr>", cguAccepted: true })).ok).toBe(false);
    expect((await w.service.register({ email: "a@b.fr, c@d.fr", cguAccepted: true })).ok).toBe(false);
    expect(await w.service.register({ email: "a@b.fr", cguAccepted: false })).toEqual({ ok: false, reason: "cgu_required" });
  });

  it("le mot de passe choisi au lien respecte les règles", async () => {
    const w = world();
    await w.service.register({ email: "a@b.fr", cguAccepted: true });
    await w.flush();
    expect(await w.service.confirm({ token: lastToken(w.sent), password: "court" })).toEqual({
      ok: false,
      reason: "password_weak",
      rules: ["length", "digit", "special"],
    });
  });

  it("sans serveur d'envoi, rien ne commence", async () => {
    const w = world();
    w.noMail();
    expect(await w.service.register({ email: "a@b.fr", cguAccepted: true })).toEqual({ ok: false, reason: "mail_unavailable" });
    expect(w.users.size).toBe(0);
  });

  it("au plus 5 courriels par adresse et par heure, compte ou non", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) expect((await w.service.requestReset({ email: "personne@example.fr" })).ok).toBe(true);
    expect(await w.service.requestReset({ email: "personne@example.fr" })).toEqual({ ok: false, reason: "too_many_emails" });
  });

  it("un lien ne sert qu'une fois", async () => {
    const w = world();
    await w.service.register({ email: "a@b.fr", cguAccepted: true });
    await w.flush();
    const token = lastToken(w.sent);
    expect((await w.service.confirm({ token, password: PASSWORD })).ok).toBe(true);
    expect(await w.service.confirm({ token, password: PASSWORD })).toEqual({ ok: false, reason: "link_invalid" });
  });
});

describe("connexion", () => {
  it("même réponse pour une adresse inconnue et un mauvais mot de passe", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    const wrong = await w.service.login({ email: "jeanne@example.fr", password: "Mauvais-mot-2passe", remember: false });
    const unknown = await w.service.login({ email: "personne@example.fr", password: PASSWORD, remember: false });
    expect(wrong).toEqual({ ok: false, reason: "credentials_invalid" });
    expect(unknown).toEqual(wrong);
  });

  it("au-delà de 10 tentatives, l'adresse est verrouillée 15 minutes, même avec le bon mot de passe", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await w.service.login({ email: "jeanne@example.fr", password: "x", remember: false }));
    expect(results[9]).toEqual({ ok: false, reason: "credentials_invalid" });
    expect(results[10]).toEqual({ ok: false, reason: "account_locked" });
    expect(await w.service.login({ email: "jeanne@example.fr", password: PASSWORD, remember: false })).toEqual({
      ok: false,
      reason: "account_locked",
    });
    w.advance(901);
    expect((await w.service.login({ email: "jeanne@example.fr", password: PASSWORD, remember: false })).ok).toBe(true);
  });

  it("se connecter dans une autre collectivité y ouvre un espace", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    const antony = w.serviceFor(ANTONY);
    expect((await antony.login({ email: "jeanne@example.fr", password: PASSWORD, remember: false })).ok).toBe(true);
  });
});

describe("liens et collectivités", () => {
  it("⚠️ une collectivité où le compte n'a pas d'espace n'envoie aucun lien", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    const before = w.sent.length;
    const antony = w.serviceFor(ANTONY);
    expect(await antony.requestReset({ email: "jeanne@example.fr" })).toEqual({ ok: true, value: null });
    await w.flush();
    expect(w.sent.length).toBe(before);
    // Une fois l'usager connecté à Antony (espace ouvert), Antony peut lui écrire.
    await antony.login({ email: "jeanne@example.fr", password: PASSWORD, remember: false });
    await antony.requestReset({ email: "jeanne@example.fr" });
    await w.flush();
    expect(w.sent[w.sent.length - 1]).toMatchObject({ to: "jeanne@example.fr", tenant: ANTONY.id });
  });
});

describe("double authentification", () => {
  async function withTotp() {
    const w = world();
    await registeredAndConfirmed(w);
    const started = await w.service.totpStart("user-1", { password: PASSWORD });
    if (!started.ok) throw new Error("activation refusée");
    expect(started.value.uri).toContain("otpauth://totp/");
    const key = base32Decode(started.value.secret)!;
    const code = async (offset = 0) => hotp(key, totpStep(w.now()) + offset);
    const wrong = async () => ((await code()) === "000000" ? "111111" : "000000");
    expect(await w.service.totpConfirm("user-1", { code: await wrong() })).toEqual({ ok: false, reason: "totp_invalid" });
    expect((await w.service.totpConfirm("user-1", { code: await code() })).ok).toBe(true);
    return { w, code, wrong };
  }

  it("l'activation exige le mot de passe", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    expect(await w.service.totpStart("user-1", { password: "faux" })).toEqual({ ok: false, reason: "credentials_invalid" });
  });

  it("un mot de passe juste ne suffit plus : il faut le code, une seule fois", async () => {
    const { w, code, wrong } = await withTotp();
    w.advance(30);
    const login = await w.service.login({ email: "jeanne@example.fr", password: PASSWORD, remember: false });
    if (!login.ok || login.value.kind !== "mfa") throw new Error("second facteur attendu");
    const ticket = login.value.ticket;
    expect(await w.service.loginTotp({ ticket, code: await wrong() })).toEqual({ ok: false, reason: "totp_invalid" });
    const current = await code();
    expect(await w.service.loginTotp({ ticket, code: current })).toEqual({
      ok: true,
      value: { accountId: "user-1", amr: ["pwd", "totp"], remember: false },
    });
    expect(await w.service.loginTotp({ ticket, code: current })).toEqual({ ok: false, reason: "totp_invalid" });
  });

  it("⚠️ les codes essayés comptent : pas de salve sur un ticket", async () => {
    const { w, wrong } = await withTotp();
    w.advance(30);
    const login = await w.service.login({ email: "jeanne@example.fr", password: PASSWORD, remember: false });
    if (!login.ok || login.value.kind !== "mfa") throw new Error("second facteur attendu");
    const results = await Promise.all(
      Array.from({ length: 20 }, async () => w.service.loginTotp({ ticket: login.value.kind === "mfa" ? login.value.ticket : "", code: await wrong() })),
    );
    expect(results.filter((r) => !r.ok && r.reason === "account_locked").length).toBeGreaterThanOrEqual(10);
  });

  it("le ticket expire, et ne vaut pas dans une autre collectivité", async () => {
    const { w, code } = await withTotp();
    w.advance(30);
    const login = await w.service.login({ email: "jeanne@example.fr", password: PASSWORD, remember: false });
    if (!login.ok || login.value.kind !== "mfa") throw new Error("second facteur attendu");
    expect(await w.serviceFor(ANTONY).loginTotp({ ticket: login.value.ticket, code: await code() })).toEqual({
      ok: false,
      reason: "mfa_expired",
    });
    w.advance(301);
    expect(await w.service.loginTotp({ ticket: login.value.ticket, code: await code() })).toEqual({ ok: false, reason: "mfa_expired" });
  });

  it("changer d'appareil exige le code actuel", async () => {
    const { w, code, wrong } = await withTotp();
    w.advance(30);
    expect(await w.service.totpStart("user-1", { password: PASSWORD, code: await wrong() })).toEqual({
      ok: false,
      reason: "totp_invalid",
    });
    expect((await w.service.totpStart("user-1", { password: PASSWORD, code: await code() })).ok).toBe(true);
  });

  it("le retrait exige le mot de passe et un code, et l'usager en est averti", async () => {
    const { w, code } = await withTotp();
    w.advance(30);
    expect(await w.service.totpDisable("user-1", { password: "faux", code: await code() })).toEqual({
      ok: false,
      reason: "credentials_invalid",
    });
    expect((await w.service.totpDisable("user-1", { password: PASSWORD, code: await code() })).ok).toBe(true);
    await w.flush();
    expect(w.sent.map((s) => s.message.subject)).toContain("Double authentification désactivée");
  });
});

describe("mot de passe", () => {
  it("oublié : même réponse pour une adresse inconnue ; le lien change le mot de passe et prévient", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    const before = w.sent.length;
    expect(await w.service.requestReset({ email: "personne@example.fr" })).toEqual({ ok: true, value: null });
    await w.flush();
    expect(w.sent.length).toBe(before);
    expect(await w.service.requestReset({ email: "jeanne@example.fr" })).toEqual({ ok: true, value: null });
    await w.flush();
    expect(w.sent[w.sent.length - 1].message.text).toContain("/compte/mot-de-passe#jeton=");
    const token = lastToken(w.sent);
    expect((await w.service.resetPassword({ token, password: "Nouveau-mot-2passe" })).ok).toBe(true);
    expect(w.events).toContain("password_changed");
    await w.flush();
    expect(w.sent[w.sent.length - 1].message.subject).toBe("Votre mot de passe a été modifié");
    expect((await w.service.login({ email: "jeanne@example.fr", password: "Nouveau-mot-2passe", remember: false })).ok).toBe(true);
    expect(await w.service.resetPassword({ token, password: "Encore-un-autre-3" })).toEqual({ ok: false, reason: "link_invalid" });
  });

  it("changé connecté : l'ancien est exigé", async () => {
    const w = world();
    await registeredAndConfirmed(w);
    expect(await w.service.changePassword("user-1", "h", { current: "faux", password: "Nouveau-mot-2passe" })).toEqual({
      ok: false,
      reason: "credentials_invalid",
    });
    expect((await w.service.changePassword("user-1", "h", { current: PASSWORD, password: "Nouveau-mot-2passe" })).ok).toBe(true);
  });
});
