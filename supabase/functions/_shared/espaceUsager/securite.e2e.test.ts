/**
 * SÉCURITÉ de l'espace usager, de bout en bout : CSRF, liaison de la session à
 * la ville, inactivité et expiration, révocation, verrouillage, énumération de
 * comptes, durées plancher, freins par visiteur, corps démesurés, défi
 * anti-robot, double authentification.
 *
 * Les durées plancher (900 ms) sont vérifiées de deux façons : par la durée
 * demandée au minuteur (déterministe, tous les refus), et une fois en temps réel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { solveChallenge } from "../ai/challenge.ts";
import { base32Decode, hotp, totpStep } from "../account/totp.ts";
import { ANTONY, IDENTITE, login, PASSWORD, PROC_LIBRE, registerConfirmed, SCEAUX, signedIn, withProfile, World, type Browser } from "./harness/world.ts";

vi.mock("../account/mail/transport.ts", async () => {
  const { mailbox } = await import("./harness/mailbox.ts");
  return {
    sendAccountMessage: async (config: { host: string }, to: string, message: { subject: string; text: string }) => {
      mailbox.push({ to, subject: message.subject, text: message.text, smtpHost: config.host });
    },
  };
});

const EMAIL = "camille.durand@example.org";
let world: World;
let n = 0;
/** Une adresse IP neuve à chaque appel : les freins par visiteur ne se mélangent pas. */
const freshIp = () => `198.51.${100 + Math.floor(n / 250)}.${(n++ % 250) + 1}`;

beforeEach(async () => {
  world = await World.create();
});
afterEach(async () => {
  await world.close();
});

const deposit = (extra: Record<string, unknown> = {}) => ({
  demarcheId: PROC_LIBRE.id,
  submissionId: crypto.randomUUID(),
  formData: { message: "x" },
  consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }],
  ...extra,
});

// ── CSRF et relais ──────────────────────────────────────────────────────────

describe("CSRF : toute écriture de l'espace exige une page du portail, relayée par le Worker", () => {
  const MUTATIONS: [string, unknown][] = [
    ["/v1/compte/inscription", { email: EMAIL, cguAccepted: true }],
    ["/v1/compte/confirmation", { jeton: "x".repeat(20), password: PASSWORD }],
    ["/v1/compte/confirmation/renvoi", { email: EMAIL }],
    ["/v1/compte/mot-de-passe-oublie", { email: EMAIL }],
    ["/v1/compte/mot-de-passe", { jeton: "x".repeat(20), password: PASSWORD }],
    ["/v1/compte/connexion", { email: EMAIL, password: PASSWORD }],
    ["/v1/compte/connexion/totp", { ticket: "t", code: "123456" }],
    ["/v1/compte/mot-de-passe/changement", { current: PASSWORD, password: PASSWORD + "2" }],
    ["/v1/compte/totp/activation", { password: PASSWORD }],
    ["/v1/compte/totp/confirmation", { code: "123456" }],
    ["/v1/compte/totp/desactivation", { password: PASSWORD, code: "123456" }],
    ["/v1/compte/profil", IDENTITE],
    ["/v1/compte/consentements", { kind: "partage", granted: true }],
    ["/v1/session/fin", {}],
    ["/v1/suivi", { reference: "DEM-2026-000001", email: EMAIL, code: "ABCD-EFGH-JK" }],
  ];

  it.each(MUTATIONS)("%s : refusée sans l'en-tête du portail", async (path, json) => {
    const reply = await world.browser(SCEAUX, freshIp()).send(path, { json, mutationHeader: false });
    expect(reply.status).toBe(403);
    expect(reply.body.error.code).toBe("csrf_rejected");
  });

  it.each(MUTATIONS)("%s : refusée depuis un autre site (Origin, Sec-Fetch-Site)", async (path, json) => {
    const browser = world.browser(SCEAUX, freshIp());
    for (const headers of [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
      expect((await browser.send(path, { json, headers })).status).toBe(403);
    }
    expect((await browser.send(path, { json, origin: "https://evil.example" })).status).toBe(403);
    // Une autre collectivité de la gamme n'est pas « le même site » non plus.
    expect((await browser.send(path, { json, origin: `https://${ANTONY.hostname}` })).status).toBe(403);
    expect((await browser.send(path, { json, origin: "null" })).status).toBe(403);
  });

  it.each(MUTATIONS)("%s : refusée en appel direct, hors du Worker (aucune session hors relais)", async (path, json) => {
    const reply = await world.direct(path, { json, headers: { "x-nora-request": "1", origin: `https://${SCEAUX.hostname}` } });
    expect(reply.status).toBe(403);
  });

  it("les en-têtes certifiés posés par un visiteur sont écartés par le Worker : il reste sur SA ville", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    const reply = await browser.send("/v1/session", {
      headers: { "x-nora-host": ANTONY.hostname, "x-nora-proxy-secret": "p".repeat(40), "x-nora-client-ip": "10.0.0.1" },
    });
    expect(reply.status).toBe(200);
    // L'hôte résolu au Socle est celui du domaine visité.
    const tenantCalls = world.callsTo("socle").filter((c) => c.path.includes("/v1/portal/tenant"));
    expect(tenantCalls.at(-1)!.path).toContain(`hostname=${SCEAUX.hostname}`);
  });

  it("appel direct avec un faux secret de relais : traité comme anonyme hors relais", async () => {
    const reply = await world.direct("/v1/session", {
      headers: { "x-nora-proxy-secret": "q".repeat(40), "x-nora-host": SCEAUX.hostname, origin: `https://${SCEAUX.hostname}` },
    });
    expect(reply.body).toEqual({ authenticated: false });
  });

  it("dépôt depuis un site voisin : le cookie n'a pas autorité, la demande part SANS rattachement", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await withProfile(world, browser, EMAIL);
    const cross = await browser.send("/v1/demandes", { json: deposit(), origin: "https://autre.edilumen.fr" });
    expect(cross.status).toBe(201);
    expect(world.iris.ingested.at(-1)!.socle_contact_id).toBeUndefined();
    const same = await browser.send("/v1/demandes", { json: deposit() });
    expect(same.status).toBe(201);
    expect(world.iris.ingested.at(-1)!.socle_contact_id).toBeTypeOf("string");
  });

  it("démarche réservée déposée depuis un autre site : refusée (account_required)", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await withProfile(world, browser, EMAIL);
    const reply = await browser.send("/v1/demandes", { json: deposit({ demarcheId: "p-reservee" }), origin: "https://evil.example" });
    expect(reply.body.error.code).toBe("account_required");
  });
});

// ── Sessions ────────────────────────────────────────────────────────────────

describe("sessions : inactivité, expiration, révocation", () => {
  it("30 minutes sans activité ferment la session ; le cookie est effacé et la fin consignée", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await signedIn(world, browser, EMAIL);
    await world.sql("update citizen_sessions set last_seen_at = now() - interval '31 minutes'");
    const reply = await browser.send("/v1/compte");
    expect(reply.status).toBe(401);
    expect(reply.body.error.code).toBe("session_required");
    expect(reply.setCookies[0]).toMatch(/Max-Age=0/);
    const [row] = await world.sql<{ end_reason: string }>("select end_reason from citizen_sessions");
    expect(row.end_reason).toBe("idle");
  });

  it("l'activité prolonge la session (au plus une écriture par minute)", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await signedIn(world, browser, EMAIL);
    await world.sql("update citizen_sessions set last_seen_at = now() - interval '29 minutes'");
    expect((await browser.send("/v1/compte")).status).toBe(200);
    const [row] = await world.sql<{ fresh: boolean }>("select now() - last_seen_at < interval '10 seconds' as fresh from citizen_sessions");
    expect(row.fresh).toBe(true);
    // Une seconde requête immédiate n'écrit pas à nouveau.
    const [before] = await world.sql<{ t: string }>("select last_seen_at::text t from citizen_sessions");
    await browser.send("/v1/compte");
    const [after] = await world.sql<{ t: string }>("select last_seen_at::text t from citizen_sessions");
    expect(after.t).toBe(before.t);
  });

  it("l'inactivité est réglable (CITIZEN_SESSION_IDLE_MINUTES) et bornée", async () => {
    const short = await World.create({ CITIZEN_SESSION_IDLE_MINUTES: "5" });
    try {
      const browser = short.browser(SCEAUX, freshIp());
      await signedIn(short, browser, EMAIL);
      await short.sql("update citizen_sessions set last_seen_at = now() - interval '6 minutes'");
      expect((await browser.send("/v1/compte")).status).toBe(401);
    } finally {
      await short.close();
    }
    // Une valeur absurde retombe sur 30 minutes, jamais sur « jamais ».
    const silly = await World.create({ CITIZEN_SESSION_IDLE_MINUTES: "999999" });
    try {
      const browser = silly.browser(SCEAUX, freshIp());
      await signedIn(silly, browser, EMAIL);
      const [row] = await silly.sql<{ idle_seconds: number }>("select idle_seconds from citizen_sessions");
      expect(row.idle_seconds).toBe(1800);
    } finally {
      await silly.close();
    }
  });

  it("12 heures après la connexion, la session expire même en activité continue", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await signedIn(world, browser, EMAIL);
    await world.sql("update citizen_sessions set expires_at = now() - interval '1 second'");
    expect((await browser.send("/v1/compte")).status).toBe(401);
    const [row] = await world.sql<{ end_reason: string }>("select end_reason from citizen_sessions");
    expect(row.end_reason).toBe("expired");
  });

  it("durées par profil : standard 30 min / 12 h, rester connecté 7 j / 30 j, invité 30 min / 2 h", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await registerConfirmed(world, browser, EMAIL);
    await login(browser, EMAIL);
    await browser.send("/v1/compte/connexion", { json: { email: EMAIL, password: PASSWORD, remember: true } });
    const guestBrowser = world.browser(SCEAUX, freshIp());
    const dep = await guestBrowser.send("/v1/demandes", { json: deposit({ requester: { courriel: "g@example.org" }, guestAccess: true }) });
    await guestBrowser.send("/v1/suivi", { json: { reference: dep.body.receipt.reference, email: "g@example.org", code: dep.body.receipt.accessCode } });
    const rows = await world.sql<{ kind: string; remember: boolean; idle: number; life: number }>(
      "select kind, remember, idle_seconds idle, extract(epoch from expires_at - created_at)::int life from citizen_sessions order by created_at",
    );
    // Le premier login est refermé par le second (un navigateur, une session) : trois lignes au total.
    const open = rows.map((r) => [r.kind, r.remember, r.idle, Math.round(r.life / 60)]);
    expect(open).toContainEqual(["account", false, 1800, 720]);
    expect(open).toContainEqual(["account", true, 7 * 86400, 30 * 1440]);
    expect(open).toContainEqual(["guest", false, 1800, 120]);
  });

  it("fixation de session : se connecter ferme l'ancienne session de ce navigateur et en émet une neuve", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await registerConfirmed(world, browser, EMAIL);
    await login(browser, EMAIL);
    const first = browser.sessionCookie;
    await login(browser, EMAIL);
    expect(browser.sessionCookie).not.toBe(first);
    const old = world.browser(SCEAUX, freshIp());
    old.sessionCookie = first;
    expect((await old.send("/v1/session")).body.authenticated).toBe(false);
  });

  it("la déconnexion est idempotente et ne laisse rien valable", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await signedIn(world, browser, EMAIL);
    const token = browser.sessionCookie;
    expect((await browser.send("/v1/session/fin", { json: {} })).status).toBe(200);
    expect((await browser.send("/v1/session/fin", { json: {} })).status).toBe(200);
    const replay = world.browser(SCEAUX, freshIp());
    replay.sessionCookie = token;
    expect((await replay.send("/v1/compte")).status).toBe(401);
  });

  it("un compte désactivé perd toutes ses sessions, et ne peut plus se connecter", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await signedIn(world, browser, EMAIL);
    await world.sql("update citizen_accounts set status = 'disabled'");
    expect((await browser.send("/v1/compte")).status).toBe(401);
    expect((await login(world.browser(SCEAUX, freshIp()), EMAIL)).status).toBe(401);
  });

  it("le jeton de session n'est jamais stocké : la base ne garde que son SHA-256", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await signedIn(world, browser, EMAIL);
    const [row] = await world.sql<{ id_hash: string }>("select id_hash from citizen_sessions");
    expect(row.id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.id_hash).not.toContain(browser.sessionCookie!);
    const dump = JSON.stringify(await world.sql("select * from citizen_sessions"));
    expect(dump).not.toContain(browser.sessionCookie!);
  });

  it("un cookie mal formé, trop long ou d'un autre nom n'atteint pas la base", async () => {
    const before = world.callsTo("nora-db").length;
    const browser = world.browser(SCEAUX, freshIp());
    for (const value of ["", "court", "A".repeat(44), "A".repeat(42) + "=", "A".repeat(42) + "'"]) {
      browser.jar.set("__Host-nora_sid", value);
      expect((await browser.send("/v1/session")).body).toEqual({ authenticated: false });
    }
    browser.jar.clear();
    browser.jar.set("nora_sid", "A".repeat(43));
    await browser.send("/v1/session");
    expect(world.callsTo("nora-db").length).toBe(before);
  });
});

// ── Verrouillage ────────────────────────────────────────────────────────────

describe("verrouillage après tentatives répétées (CCTP 6.3)", () => {
  async function wrongPasswords(email: string, count: number) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(await login(world.browser(SCEAUX, freshIp()), email, "Mauvais-Mot-De-Passe-1!"));
    return out;
  }

  it("10 essais faux sont répondus 401, le 11e verrouille ; ensuite le BON mot de passe est refusé aussi", async () => {
    await registerConfirmed(world, world.browser(SCEAUX, freshIp()), EMAIL);
    const results = await wrongPasswords(EMAIL, 11);
    expect(results.slice(0, 10).map((r) => r.status)).toEqual(Array(10).fill(401));
    expect(results[10].status).toBe(429);
    expect(results[10].body.error.code).toBe("account_locked");
    const good = await login(world.browser(SCEAUX, freshIp()), EMAIL);
    expect(good.status).toBe(429);
    expect(good.body.error.code).toBe("account_locked");
    const [row] = await world.sql<{ n: number }>("select count(*)::int n from citizen_auth_events where event = 'login_locked'");
    expect(row.n).toBeGreaterThanOrEqual(1);
  });

  it("le verrou vaut pour une adresse SANS compte (rien ne distingue les deux)", async () => {
    const results = await wrongPasswords("inconnu@example.org", 11);
    expect(results[10].status).toBe(429);
    expect(results[10].body).toEqual({ error: { code: "account_locked", message: expect.any(String) } });
  });

  it("le verrou tombe après 15 minutes, ou par un mot de passe réinitialisé", async () => {
    await registerConfirmed(world, world.browser(SCEAUX, freshIp()), EMAIL);
    await wrongPasswords(EMAIL, 11);
    await world.sql("update citizen_login_guards set locked_until = now() - interval '1 second'");
    expect((await login(world.browser(SCEAUX, freshIp()), EMAIL)).status).toBe(200);

    await wrongPasswords(EMAIL, 11);
    const stranger = world.browser(SCEAUX, freshIp());
    await stranger.send("/v1/compte/mot-de-passe-oublie", { json: { email: EMAIL } });
    await world.flush();
    await stranger.send("/v1/compte/mot-de-passe", { json: { jeton: world.linkToken(EMAIL), password: "Nouveau-Pass-Word-5!" } });
    expect((await login(world.browser(SCEAUX, freshIp()), EMAIL, "Nouveau-Pass-Word-5!")).status).toBe(200);
  });

  it("des essais lancés en parallèle ne passent pas plus de 10 fois la vérification du mot de passe", async () => {
    await registerConfirmed(world, world.browser(SCEAUX, freshIp()), EMAIL);
    const before = world.callsTo("gotrue").filter((c) => c.path.startsWith("/auth/v1/token")).length;
    const replies = await Promise.all(
      Array.from({ length: 30 }, () => login(world.browser(SCEAUX, freshIp()), EMAIL, "Mauvais-Mot-De-Passe-1!")),
    );
    const checked = world.callsTo("gotrue").filter((c) => c.path.startsWith("/auth/v1/token")).length - before;
    expect(checked).toBeLessThanOrEqual(10);
    expect(replies.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(20);
  });

  it("changer de mot de passe connecté : l'ancien mot de passe compte dans les tentatives", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await signedIn(world, browser, EMAIL);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await browser.send("/v1/compte/mot-de-passe/changement", { json: { current: "Faux-Mot-De-Passe-3!", password: "Nouveau-Pass-Word-5!" } })).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

// ── Énumération de comptes ──────────────────────────────────────────────────

describe("énumération de comptes : mêmes réponses que l'adresse existe ou non", () => {
  const shape = (r: { status: number; body: unknown; headers: Headers; setCookies: string[] }) => ({
    status: r.status,
    body: r.body,
    cache: r.headers.get("cache-control"),
    cookies: r.setCookies,
  });

  it("inscription : adresse neuve, compte confirmé, compte non confirmé → même réponse", async () => {
    const confirmed = world.browser(SCEAUX, freshIp());
    await registerConfirmed(world, confirmed, "existant@example.org");
    const pending = world.browser(SCEAUX, freshIp());
    await pending.send("/v1/compte/inscription", { json: { email: "attente@example.org", cguAccepted: true } });
    const replies = [];
    for (const email of ["neuf@example.org", "existant@example.org", "attente@example.org"]) {
      replies.push(shape(await world.browser(SCEAUX, freshIp()).send("/v1/compte/inscription", { json: { email, cguAccepted: true } })));
    }
    expect(replies[1]).toEqual(replies[0]);
    expect(replies[2]).toEqual(replies[0]);
    await world.flush();
    // Seul le titulaire apprend qu'un compte existe — dans sa boîte.
    expect(world.mailsTo("existant@example.org").at(-1)!.subject).toMatch(/d[ée]j[àa]/i);
  });

  it("connexion : adresse inconnue, mauvais mot de passe, compte désactivé, non confirmé → même réponse", async () => {
    await registerConfirmed(world, world.browser(SCEAUX, freshIp()), "existant@example.org");
    await world.browser(SCEAUX, freshIp()).send("/v1/compte/inscription", { json: { email: "attente@example.org", cguAccepted: true } });
    const wrong = [
      await login(world.browser(SCEAUX, freshIp()), "inconnu@example.org", "Mauvais-Mot-De-Passe-1!"),
      await login(world.browser(SCEAUX, freshIp()), "existant@example.org", "Mauvais-Mot-De-Passe-1!"),
      await login(world.browser(SCEAUX, freshIp()), "attente@example.org", "Mauvais-Mot-De-Passe-1!"),
    ].map(shape);
    expect(wrong[1]).toEqual(wrong[0]);
    expect(wrong[2]).toEqual(wrong[0]);
    expect(wrong[0].status).toBe(401);

    // Compte désactivé avec le BON mot de passe : même « identifiants invalides ».
    await world.sql("update citizen_accounts set status = 'disabled' where email_hash = $1", [await sha("email:existant@example.org")]);
    expect(shape(await login(world.browser(SCEAUX, freshIp()), "existant@example.org"))).toEqual(wrong[0]);
  });

  it("mot de passe oublié et renvoi du lien : même réponse pour toute adresse bien formée", async () => {
    await registerConfirmed(world, world.browser(SCEAUX, freshIp()), "existant@example.org");
    for (const path of ["/v1/compte/mot-de-passe-oublie", "/v1/compte/confirmation/renvoi"]) {
      const a = shape(await world.browser(SCEAUX, freshIp()).send(path, { json: { email: "inconnu@example.org" } }));
      const b = shape(await world.browser(SCEAUX, freshIp()).send(path, { json: { email: "existant@example.org" } }));
      expect(b).toEqual(a);
      expect(a.status).toBe(200);
    }
  });

  it("le quota de 5 courriels par heure s'applique à toute adresse, comptes ou non", async () => {
    for (const email of ["inconnu@example.org", "existant@example.org"]) {
      if (email.startsWith("existant")) await registerConfirmed(world, world.browser(SCEAUX, freshIp()), email);
      const statuses = [];
      for (let i = 0; i < 7; i++) {
        statuses.push((await world.browser(SCEAUX, freshIp()).send("/v1/compte/mot-de-passe-oublie", { json: { email } })).status);
      }
      // `existant` a déjà consommé deux courriels (inscription + lien) : le seuil arrive plus tôt, mais le motif est le même.
      expect(statuses).toContain(429);
      expect(statuses.indexOf(429)).toBeLessThanOrEqual(5);
    }
  });

  it("durée plancher : chaque réponse anonyme du compte attend ~900 ms, refus compris", async () => {
    world.floorWaits.length = 0;
    const b = () => world.browser(SCEAUX, freshIp());
    await b().send("/v1/compte/inscription", { json: { email: "a@example.org", cguAccepted: true } });
    await b().send("/v1/compte/inscription", { json: { email: "pas-une-adresse", cguAccepted: true } }); // refus de forme
    await b().send("/v1/compte/connexion", { json: { email: "a@example.org", password: "x" } }); // refus
    await b().send("/v1/compte/mot-de-passe-oublie", { json: { email: "a@example.org" } });
    await b().send("/v1/compte/confirmation", { json: { jeton: "x".repeat(20), password: PASSWORD } }); // lien invalide
    expect(world.floorWaits).toHaveLength(5);
    for (const wait of world.floorWaits) {
      expect(wait).toBeGreaterThan(600);
      expect(wait).toBeLessThanOrEqual(900);
    }
  });

  it("durée plancher en temps réel : un refus ne revient pas avant ~900 ms (adresse inconnue comme connue)", async () => {
    const real = await World.create({}, { realTime: true });
    try {
      await registerConfirmed(real, real.browser(SCEAUX, freshIp()), "existant@example.org");
      for (const email of ["inconnu@example.org", "existant@example.org"]) {
        const started = performance.now();
        const reply = await login(real.browser(SCEAUX, freshIp()), email, "Mauvais-Mot-De-Passe-1!");
        const elapsed = performance.now() - started;
        expect(reply.status).toBe(401);
        expect(elapsed).toBeGreaterThanOrEqual(880);
      }
    } finally {
      await real.close();
    }
  }, 30_000);
});

// ── Freins par visiteur ─────────────────────────────────────────────────────

describe("freins par visiteur", () => {
  const suivi = { reference: "DEM-2026-000001", email: "x@example.org", code: "ABCD-EFGH-JK" };

  it("/suivi : 10 essais par visiteur, le 11e est freiné (429) — l'adresse certifiée, pas un en-tête", async () => {
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      // Un visiteur qui change d'X-Forwarded-For à chaque essai reste le même visiteur.
      statuses.push((await world.browser(SCEAUX, ip).send("/v1/suivi", { json: suivi, headers: { "x-forwarded-for": `10.0.0.${i}` } })).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(404));
    expect(statuses[10]).toBe(429);
    // Un autre visiteur n'est pas freiné.
    expect((await world.browser(SCEAUX, freshIp()).send("/v1/suivi", { json: suivi })).status).toBe(404);
  });

  it("IPv6 : le frein compte par /64 (changer d'adresse dans son préfixe n'aide pas)", async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await world.browser(SCEAUX, `2001:db8:1:2:${i.toString(16)}::${i + 1}`).send("/v1/suivi", { json: suivi })).status);
    }
    expect(statuses[10]).toBe(429);
    expect((await world.browser(SCEAUX, "2001:db8:1:3::1").send("/v1/suivi", { json: suivi })).status).toBe(404);
  });

  it("comptes : 20 parcours anonymes par visiteur en 10 minutes, puis 429", async () => {
    const ip = freshIp();
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await world.browser(SCEAUX, ip).send("/v1/compte/connexion", { json: { email: `u${i}@example.org`, password: "x" } })).status);
    }
    expect(statuses[20]).toBe(429);
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
  });
});

// ── Corps, pièces, défi ─────────────────────────────────────────────────────

describe("corps démesurés et pièces", () => {
  function stream(bytes: number, chunk = 64 * 1024): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream({
      pull(controller) {
        const size = Math.min(chunk, bytes - sent);
        if (size <= 0) return controller.close();
        controller.enqueue(new Uint8Array(size).fill(0x20));
        sent += size;
      },
    });
  }

  it("un corps JSON de plusieurs Mo sans Content-Length est refusé proprement (400), jamais chargé en entier", async () => {
    const reply = await world.browser(SCEAUX, freshIp()).send("/v1/compte/connexion", { stream: stream(1024 * 1024 + 4096, 1024 * 1024 + 4096), headers: { "content-type": "application/json" } });
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe("bad_request");
  });

  it("JSON invalide, tableau ou scalaire : 400 sur chaque route d'écriture du compte", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    for (const body of ["{", "[]", "42", '"texte"', "null"]) {
      const reply = await browser.send("/v1/compte/connexion", { body, headers: { "content-type": "application/json" } });
      expect(reply.status, body).toBe(400);
    }
  });

  it("pièces : 20 Mo exacts acceptés, 20 Mo + 1 octet refusés (413), bien au-delà refusé sans atteindre Iris", async () => {
    const send = (size: number) => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(size)], "justificatif.pdf", { type: "application/pdf" }));
      return world.browser(SCEAUX, freshIp()).send("/v1/demandes/pieces", { body: form });
    };
    const MiB = 1024 * 1024;
    expect((await send(20 * MiB)).status).toBe(201);
    const over = await send(20 * MiB + 1);
    expect(over.status).toBe(413);
    expect(over.body.error.code).toBe("piece_too_large");
    expect(world.iris.uploads.map((u) => u.size)).toEqual([20 * MiB]);
  });

  it("pièce : un envoi en flux qui dépasse 20 Mo sans le dire est coupé en cours de lecture, rien n'atteint Iris", async () => {
    const reply = await world.browser(SCEAUX, freshIp()).send("/v1/demandes/pieces", {
      stream: stream(21 * 1024 * 1024, 256 * 1024),
      headers: { "content-type": "multipart/form-data; boundary=zzz" },
    });
    expect([400, 413]).toContain(reply.status);
    expect(world.iris.uploads).toHaveLength(0);
  });

  it("pièce : le Content-Length annoncé trop grand est refusé avant lecture", async () => {
    const reply = await world.browser(SCEAUX, freshIp()).send("/v1/demandes/pieces", {
      body: new FormData(),
      headers: { "content-length": String(300 * 1024 * 1024) },
    });
    expect(reply.status).toBe(413);
  });

  it("pièce : un champ déclaré qui n'est pas une pièce, ou un format hors liste, est refusé", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(10)], "x.exe"));
    form.append("demarcheId", PROC_LIBRE.id);
    form.append("fieldId", "f1");
    const reply = await world.browser(SCEAUX, freshIp()).send("/v1/demandes/pieces", { body: form });
    expect(reply.status).toBe(400);
    expect(world.iris.uploads).toHaveLength(0);
  });
});

describe("défi anti-robot sur les parcours qui font écrire à une adresse", () => {
  it("exigé, il manque : 428 ; résolu pour L'ADRESSE saisie : accepté ; rejoué pour une autre adresse : refusé", async () => {
    const guarded = await World.create({ ASSISTANT_SIGNING_SECRET: "s".repeat(40), DEPOSIT_CHALLENGE_REQUIRED: "true", ASSISTANT_CHALLENGE_BITS: "8" });
    try {
      const browser = guarded.browser(SCEAUX, freshIp());
      const none = await browser.send("/v1/compte/inscription", { json: { email: EMAIL, cguAccepted: true } });
      expect(none.status).toBe(428);
      expect(none.body.error.code).toBe("challenge_required");
      expect(guarded.gotrue.users.size).toBe(0);

      const { challenge } = (await browser.send("/v1/defi", { method: "POST", json: {} })).body;
      const solved = await solveChallenge(challenge, 2000, EMAIL);
      expect((await browser.send("/v1/compte/inscription", { json: { email: EMAIL, cguAccepted: true, challenge: solved } })).status).toBe(200);
      const other = await browser.send("/v1/compte/inscription", { json: { email: "autre@example.org", cguAccepted: true, challenge: solved } });
      expect(other.status).toBe(428);
      // Un défi falsifié (difficulté abaissée) ne passe pas.
      const forged = { ...solved, bits: 0 };
      expect((await browser.send("/v1/compte/mot-de-passe-oublie", { json: { email: EMAIL, challenge: forged } })).status).toBe(428);
      // La connexion, elle, n'en demande pas (le verrou y suffit).
      expect((await login(browser, EMAIL, "x")).status).not.toBe(428);
    } finally {
      await guarded.close();
    }
  });
});

// ── Double authentification ─────────────────────────────────────────────────

describe("double authentification (TOTP)", () => {
  async function codeFor(secret: string, offset = 0) {
    return hotp(base32Decode(secret)!, totpStep(Math.floor(Date.now() / 1000)) + offset);
  }

  async function enable(browser: Browser) {
    await signedIn(world, browser, EMAIL);
    const start = await browser.send("/v1/compte/totp/activation", { json: { password: PASSWORD } });
    expect(start.status).toBe(200);
    const secret: string = start.body.secret;
    expect((await browser.send("/v1/compte/totp/confirmation", { json: { code: await codeFor(secret) } })).status).toBe(200);
    return secret;
  }

  it("activation, connexion en deux temps, rejeu d'un code refusé", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    const secret = await enable(browser);
    const stored = JSON.stringify(await world.sql("select * from citizen_totp"));
    expect(stored).not.toContain(secret); // le secret est chiffré en base

    const other = world.browser(SCEAUX, freshIp());
    const first = await login(other, EMAIL);
    expect(first.body).toMatchObject({ authenticated: false, mfaRequired: true });
    expect(first.setCookies).toEqual([]); // pas de session avant le second facteur
    expect((await other.send("/v1/compte")).status).toBe(401);

    // Le pas de l'activation est déjà consommé : on prend le suivant.
    const code = await codeFor(secret, 1);
    const ok = await other.send("/v1/compte/connexion/totp", { json: { ticket: first.body.ticket, code } });
    expect(ok.status).toBe(200);
    expect(ok.body.authenticated).toBe(true);
    const third = world.browser(SCEAUX, freshIp());
    const again = await login(third, EMAIL);
    const replay = await third.send("/v1/compte/connexion/totp", { json: { ticket: again.body.ticket, code } });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("totp_invalid");
    const amr = await world.sql<{ amr: string[] }>("select amr from citizen_sessions where ended_at is null and 'totp' = any(amr)");
    expect(amr[0].amr).toEqual(["pwd", "totp"]);
  });

  it("un ticket de Sceaux ne vaut pas à Antony, ni inventé, ni altéré", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    const secret = await enable(browser);
    const ticket = (await login(world.browser(SCEAUX, freshIp()), EMAIL)).body.ticket as string;
    const code = await codeFor(secret, 1);
    const antony = world.browser(ANTONY, freshIp());
    expect((await antony.send("/v1/compte/connexion/totp", { json: { ticket, code } })).status).toBe(401);
    for (const bad of ["", "x.y", ticket.slice(0, -2) + "AA", ticket.split(".")[0]]) {
      expect((await world.browser(SCEAUX, freshIp()).send("/v1/compte/connexion/totp", { json: { ticket: bad, code } })).status).toBe(401);
    }
  });

  it("des codes faux comptent dans le verrou : pas de salve sur un ticket", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await enable(browser);
    const ticket = (await login(world.browser(SCEAUX, freshIp()), EMAIL)).body.ticket as string;
    const statuses = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await world.browser(SCEAUX, freshIp()).send("/v1/compte/connexion/totp", { json: { ticket, code: String(100000 + i) } })).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    expect(statuses.indexOf(429)).toBeLessThanOrEqual(10);
  });

  it("retirer la double authentification exige le mot de passe ET un code valable", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    const secret = await enable(browser);
    expect((await browser.send("/v1/compte/totp/desactivation", { json: { password: "Faux-Mot-De-Passe-3!", code: await codeFor(secret, 2) } })).status).toBe(401);
    expect((await browser.send("/v1/compte/totp/desactivation", { json: { password: PASSWORD, code: "000000" } })).status).toBe(400);
    expect((await browser.send("/v1/compte/totp/desactivation", { json: { password: PASSWORD, code: await codeFor(secret, 1) } })).status).toBe(200);
    expect((await login(world.browser(SCEAUX, freshIp()), EMAIL)).body.authenticated).toBe(true);
  });
});

// ── Mot de passe ────────────────────────────────────────────────────────────

describe("règles du mot de passe (CCTP 6.3)", () => {
  it.each([
    ["trop court", "Court-1!"],
    ["sans chiffre", "Un-Mot-De-Passe-Long!"],
    ["sans caractère spécial", "UnMotDePasseLong12"],
    ["vide", ""],
  ])("%s : refusé au choix du mot de passe, avec la liste des règles non tenues", async (_label, password) => {
    const browser = world.browser(SCEAUX, freshIp());
    await browser.send("/v1/compte/inscription", { json: { email: EMAIL, cguAccepted: true } });
    await world.flush();
    const reply = await browser.send("/v1/compte/confirmation", { json: { jeton: world.linkToken(EMAIL), password } });
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe("password_weak");
    expect(Array.isArray(reply.body.error.rules)).toBe(true);
    expect(reply.body.error.rules.length).toBeGreaterThan(0);
    // Le lien n'est pas consommé par un mot de passe refusé : l'usager peut corriger.
    const retry = await browser.send("/v1/compte/confirmation", { json: { jeton: world.linkToken(EMAIL), password: PASSWORD } });
    expect(retry.status).toBe(200);
  });

  it("l'inscription refuse des CGU non acceptées et ne crée rien", async () => {
    const reply = await world.browser(SCEAUX, freshIp()).send("/v1/compte/inscription", { json: { email: EMAIL, cguAccepted: "true" } });
    expect(reply.status).toBe(400);
    expect(reply.body.error.code).toBe("cgu_required");
    expect(world.gotrue.users.size).toBe(0);
  });

  it("adresses piégées : une seconde destination ou une injection d'en-tête n'est pas une adresse", async () => {
    for (const email of ["a@example.org, b@example.org", "<b@example.org>", "a@example.org\r\nBcc: v@example.org", "a b@example.org", "a@@example.org", "a".repeat(250) + "@example.org"]) {
      const reply = await world.browser(SCEAUX, freshIp()).send("/v1/compte/inscription", { json: { email, cguAccepted: true } });
      expect(reply.status, email).toBe(400);
      expect(reply.body.error.code).toBe("email_invalid");
    }
    expect(world.mails).toHaveLength(0);
  });
});

async function sha(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
