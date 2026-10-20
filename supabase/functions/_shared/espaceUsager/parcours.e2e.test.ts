/**
 * Parcours de bout en bout de l'espace usager, côté serveur : navigateur →
 * Worker de relais → portal-api (réel) → base Nora (SQL réel) → Socle / Iris /
 * GoTrue simulés. Voir `harness/world.ts`.
 *
 * Ce fichier couvre le chemin NOMINAL et les états vides / erreurs d'API ;
 * l'anti-fuite est dans `antiFuite.e2e.test.ts`, la sécurité dans
 * `securite.e2e.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITE, login, PASSWORD, PROC_FUTUR, PROC_LIBRE, PROC_RESERVEE, registerConfirmed, SCEAUX, signedIn, withProfile, World } from "./harness/world.ts";

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

beforeEach(async () => {
  world = await World.create();
});
afterEach(async () => {
  await world.close();
});

const CONSENTS = [
  { kind: "traitement", granted: true },
  { kind: "partage", granted: false },
];
const depot = (extra: Record<string, unknown> = {}, procedure = PROC_LIBRE.id) => ({
  demarcheId: procedure,
  submissionId: crypto.randomUUID(),
  formData: { message: "Un nid de poule rue Houdan" },
  requester: { courriel: "visiteur@example.org", nom_usuel: "Visiteur" },
  consents: CONSENTS,
  ...extra,
});

describe("session anonyme", () => {
  it("un visiteur sans cookie n'est pas connecté, et rien ne lui est posé", async () => {
    const reply = await world.browser().send("/v1/session");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ authenticated: false });
    expect(reply.setCookies).toEqual([]);
    expect(reply.headers.get("cache-control")).toBe("no-store");
  });

  it("un cookie périmé est effacé par la réponse, pas rejoué indéfiniment", async () => {
    const browser = world.browser();
    browser.sessionCookie = "A".repeat(43);
    const reply = await browser.send("/v1/session");
    expect(reply.body).toEqual({ authenticated: false });
    expect(reply.setCookies[0]).toMatch(/^__Host-nora_sid=; .*Max-Age=0/);
    expect(browser.sessionCookie).toBeNull();
  });
});

describe("inscription → confirmation → connexion → déconnexion", () => {
  it("parcours complet : le lien part du serveur d'envoi de la collectivité et se consomme une fois", async () => {
    const browser = world.browser();
    const signup = await browser.send("/v1/compte/inscription", { json: { email: EMAIL, cguAccepted: true } });
    expect(signup.status).toBe(200);
    expect(signup.body).toEqual({ ok: true });
    await world.flush();

    const [mail] = world.mailsTo(EMAIL);
    expect(mail.smtpHost).toBe("smtp.sceaux.test");
    expect(mail.text).toContain("https://sceaux.edilumen.fr/compte/confirmer#jeton=");
    // Jamais le jeton en paramètre de requête (Referer, journaux) : fragment seulement.
    expect(mail.text).not.toMatch(/confirmer\?/);

    // Avant la confirmation : pas de connexion possible, même avec un mot de passe inventé.
    expect((await login(browser, EMAIL, PASSWORD)).status).toBe(401);

    const token = world.linkToken(EMAIL)!;
    expect((await browser.send("/v1/compte/confirmation", { json: { jeton: token, password: PASSWORD } })).status).toBe(200);
    // Le lien est à usage unique.
    const replay = await browser.send("/v1/compte/confirmation", { json: { jeton: token, password: "Autre-Mot-De-Passe-9!" } });
    expect(replay.status).toBe(410);
    expect(replay.body.error.code).toBe("link_invalid");

    const connexion = await login(browser, EMAIL);
    expect(connexion.status).toBe(200);
    expect(connexion.body).toMatchObject({ authenticated: true, kind: "account" });
    expect(connexion.setCookies).toHaveLength(1);
    expect(connexion.setCookies[0]).toMatch(/^__Host-nora_sid=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
    // Sans « rester connecté » : cookie de session, pas de Max-Age.
    expect(connexion.setCookies[0]).not.toMatch(/Max-Age/);

    const who = await browser.send("/v1/session");
    expect(who.body).toMatchObject({ authenticated: true, kind: "account" });
    // Ni identifiant de compte ni de fiche dans la réponse.
    expect(JSON.stringify(who.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    const compte = await browser.send("/v1/compte");
    expect(compte.body).toEqual({ compte: { email: EMAIL, totpEnabled: false } });

    const fin = await browser.send("/v1/session/fin", { method: "POST" });
    expect(fin.body).toEqual({ authenticated: false });
    expect((await browser.send("/v1/session")).body).toEqual({ authenticated: false });
    // Le jeton d'avant la déconnexion ne rouvre rien.
    const [row] = await world.sql<{ open: number }>("select count(*)::int open from citizen_sessions where ended_at is null");
    expect(row.open).toBe(0);
  });

  it("« rester connecté » pose un cookie persistant de 30 jours", async () => {
    const browser = world.browser();
    await registerConfirmed(world, browser, EMAIL);
    const reply = await browser.send("/v1/compte/connexion", { json: { email: EMAIL, password: PASSWORD, remember: true } });
    expect(reply.setCookies[0]).toMatch(/Max-Age=2592000/);
  });

  it("le journal consigne l'inscription, la confirmation et la connexion avec l'adresse IP du visiteur", async () => {
    const browser = world.browser(SCEAUX, "203.0.113.77");
    await signedIn(world, browser, EMAIL);
    const events = await world.sql<{ event: string; ip: string | null }>("select event, host(ip) as ip from citizen_auth_events order by id");
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["account_registered", "account_confirmed", "session_opened"]));
    expect(events.find((e) => e.event === "session_opened")!.ip).toBe("203.0.113.77");
  });

  it("changer de mot de passe garde la session courante et ferme les autres", async () => {
    const phone = world.browser();
    await signedIn(world, phone, EMAIL);
    const laptop = world.browser(SCEAUX, "198.51.100.11");
    await login(laptop, EMAIL);
    const change = await phone.send("/v1/compte/mot-de-passe/changement", { json: { current: PASSWORD, password: "Nouveau-Mot-De-Passe-7!" } });
    expect(change.status).toBe(200);
    expect((await phone.send("/v1/session")).body.authenticated).toBe(true);
    expect((await laptop.send("/v1/session")).body.authenticated).toBe(false);
    // L'ancien mot de passe ne sert plus, le nouveau oui.
    expect((await login(world.browser(), EMAIL, PASSWORD)).status).toBe(401);
    expect((await login(world.browser(), EMAIL, "Nouveau-Mot-De-Passe-7!")).status).toBe(200);
    await world.flush();
    expect(world.mailsTo(EMAIL).some((m) => /mot de passe/i.test(m.subject))).toBe(true);
  });

  it("mot de passe oublié : lien de réinitialisation, toutes les sessions fermées", async () => {
    const owner = world.browser();
    await signedIn(world, owner, EMAIL);
    const stranger = world.browser(SCEAUX, "198.51.100.99");
    expect((await stranger.send("/v1/compte/mot-de-passe-oublie", { json: { email: EMAIL } })).status).toBe(200);
    await world.flush();
    const reset = world.mailsTo(EMAIL).at(-1)!;
    expect(reset.text).toContain("/compte/mot-de-passe#jeton=");
    const token = world.linkToken(EMAIL)!;
    expect((await stranger.send("/v1/compte/mot-de-passe", { json: { jeton: token, password: "Reinitialise-Pass-3!" } })).status).toBe(200);
    expect((await owner.send("/v1/session")).body.authenticated).toBe(false);
    expect((await login(stranger, EMAIL, "Reinitialise-Pass-3!")).status).toBe(200);
  });
});

describe("profil, dépôt connecté et « Mes demandes »", () => {
  it("compte sans profil : pas de fiche, « Mes demandes » vide avec profilRequis", async () => {
    const browser = world.browser();
    await signedIn(world, browser, EMAIL);
    expect((await browser.send("/v1/compte/profil")).body).toEqual({ profil: null });
    expect((await browser.send("/v1/compte/demandes")).body).toEqual({ demandes: [], suivante: null, profilRequis: true });
  });

  it("premier remplissage : le Socle rattache avec l'adresse du COMPTE, puis seules les coordonnées bougent", async () => {
    const browser = world.browser();
    await signedIn(world, browser, EMAIL);
    const first = await browser.send("/v1/compte/profil", { json: { ...IDENTITE, courriel: "autre@example.org" } });
    expect(first.status).toBe(200);
    expect(first.body.profil).toMatchObject({ prenom: "Camille", nom: "Durand", courriel: EMAIL });
    // Le courriel envoyé au Socle est celui du compte, jamais celui du corps.
    const link = world.callsTo("contacts").find((c) => c.path.endsWith("/link"))!;
    expect((link.body as Record<string, string>).email).toBe(EMAIL);
    expect(JSON.stringify(link.body)).not.toContain("autre@example.org");

    const update = await browser.send("/v1/compte/profil", { json: { mobile: "06 12 34 56 78", nom: "Pirate", prenom: "Pirate" } });
    expect(update.status).toBe(200);
    expect(update.body.profil).toMatchObject({ mobile: "06 12 34 56 78", nom: "Durand", prenom: "Camille" });
    const patch = world.callsTo("contacts").find((c) => c.method === "PATCH")!;
    expect(Object.keys(patch.body as object)).toEqual(["mobile_phone"]);
  });

  it("le profil exige les champs obligatoires, un par un", async () => {
    const browser = world.browser();
    await signedIn(world, browser, EMAIL);
    const reply = await browser.send("/v1/compte/profil", { json: { civilite: "madame", prenom: "Camille" } });
    expect(reply.status).toBe(400);
    expect(reply.body.error.champs).toEqual(expect.arrayContaining(["nom", "adresse1", "codePostal", "ville"]));
    expect(world.callsTo("contacts")).toHaveLength(0);
  });

  it("dépôt connecté : la fiche vient de la session, jamais du corps ; la demande apparaît dans « Mes demandes »", async () => {
    const browser = world.browser();
    const contactId = await withProfile(world, browser, EMAIL);
    const reply = await browser.send("/v1/demandes", { json: depot({ socleContactId: "00000000-0000-4000-8000-000000000000", socle_contact_id: "00000000-0000-4000-8000-000000000000" }) });
    expect(reply.status).toBe(201);
    expect(reply.body.receipt.reference).toMatch(/^DEM-2026-/);
    const envelope = world.iris.ingested.at(-1)!;
    expect(envelope.socle_contact_id).toBe(contactId);

    const list = await browser.send("/v1/compte/demandes");
    expect(list.status).toBe(200);
    expect(list.body.profilRequis).toBe(false);
    expect(list.body.demandes).toHaveLength(1);
    expect(list.body.demandes[0].reference).toBe(reply.body.receipt.reference);
    // Le jeton court a bien été présenté à Iris à chaque lecture.
    expect(world.iris.tokensSeen.every((t) => typeof t === "string" && t.includes("."))).toBe(true);

    const id = list.body.demandes[0].id;
    const one = await browser.send(`/v1/compte/demandes/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.demande.reference).toBe(reply.body.receipt.reference);
  });

  it("un dépôt SANS compte part sans fiche, et sans erreur", async () => {
    const reply = await world.browser().send("/v1/demandes", { json: depot() });
    expect(reply.status).toBe(201);
    expect(world.iris.ingested.at(-1)!.socle_contact_id).toBeUndefined();
  });

  it("suivi en ligne : la case donne un code, affiché une fois ; /suivi ouvre une session invitée sur cette seule demande", async () => {
    const browser = world.browser();
    const reply = await browser.send("/v1/demandes", { json: depot({ guestAccess: true }) });
    expect(reply.status).toBe(201);
    expect(reply.body.receipt.accessCode).toBe("ABCD-EFGH-JK");

    const visitor = world.browser(SCEAUX, "198.51.100.50");
    const session = await visitor.send("/v1/suivi", {
      json: { reference: reply.body.receipt.reference, email: "visiteur@example.org", code: "ABCD-EFGH-JK" },
    });
    expect(session.status).toBe(200);
    expect(session.body).toMatchObject({ authenticated: true, kind: "guest" });
    const view = await visitor.send("/v1/suivi/demande");
    expect(view.status).toBe(200);
    expect(view.body.demande.reference).toBe(reply.body.receipt.reference);
  });
});

describe("accès invité : coupure, nouveau code, code perdu (L4a)", () => {
  async function guestSession() {
    const reply = await world.browser().send("/v1/demandes", { json: depot({ guestAccess: true }) });
    const reference = reply.body.receipt.reference as string;
    const visitor = world.browser(SCEAUX, "198.51.100.61");
    const opened = await visitor.send("/v1/suivi", { json: { reference, email: "visiteur@example.org", code: "ABCD-EFGH-JK" } });
    expect(opened.status).toBe(200);
    const request = [...world.iris.requests.values()].find((r) => r.reference === reference)!;
    return { visitor, reference, request };
  }

  it("le jeton de la session invitée porte la version de l'accès rendue par Iris", async () => {
    const { visitor } = await guestSession();
    expect((await visitor.send("/v1/suivi/demande")).status).toBe(200);
    const token = world.iris.tokensSeen.at(-1)!;
    expect(JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).g).toBe(1);
  });

  it("coupure par un agent : la session DÉJÀ ouverte ne lit plus rien, et le code ne rouvre rien", async () => {
    const { visitor, reference, request } = await guestSession();
    world.iris.revoke(request);
    expect((await visitor.send("/v1/suivi/demande")).status).not.toBe(200);
    const again = world.browser(SCEAUX, "198.51.100.62");
    expect((await again.send("/v1/suivi", { json: { reference, email: "visiteur@example.org", code: "ABCD-EFGH-JK" } })).status).toBe(404);
  });

  it("nouveau code : l'ancienne session est fermée, le nouveau code en ouvre une qui lit", async () => {
    const { visitor, reference, request } = await guestSession();
    world.iris.reissue(request, "ZZZZ-YYYY-XX");
    expect((await visitor.send("/v1/suivi/demande")).status).not.toBe(200);
    const fresh = world.browser(SCEAUX, "198.51.100.63");
    expect((await fresh.send("/v1/suivi", { json: { reference, email: "visiteur@example.org", code: "ABCD-EFGH-JK" } })).status).toBe(404);
    expect((await fresh.send("/v1/suivi", { json: { reference, email: "visiteur@example.org", code: "ZZZZ-YYYY-XX" } })).status).toBe(200);
    expect((await fresh.send("/v1/suivi/demande")).status).toBe(200);
  });

  it("code perdu : 202 que la demande existe ou non ; seuls la référence et l'adresse partent chez Iris", async () => {
    const browser = world.browser(SCEAUX, "198.51.100.64");
    const known = await browser.send("/v1/suivi/renvoi", { json: { reference: "DEM-2026-000001", email: "visiteur@example.org" } });
    const unknown = await browser.send("/v1/suivi/renvoi", { json: { reference: "DEM-1999-999999", email: "personne@example.org", extra: "x" } });
    expect([known.status, unknown.status]).toEqual([202, 202]);
    expect(known.body).toEqual(unknown.body);
    expect(world.iris.resends).toEqual([
      { reference: "DEM-2026-000001", email: "visiteur@example.org" },
      { reference: "DEM-1999-999999", email: "personne@example.org" },
    ]);
  });

  it("code perdu : saisie illisible refusée sans appeler Iris ; 5 demandes par visiteur et par heure, saisies illisibles comprises", async () => {
    const browser = world.browser(SCEAUX, "198.51.100.65");
    expect((await browser.send("/v1/suivi/renvoi", { json: { reference: "DEM-2026-000001", email: "sans-arobase" } })).status).toBe(400);
    expect(world.iris.resends).toHaveLength(0);
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await browser.send("/v1/suivi/renvoi", { json: { reference: "DEM-2026-000001", email: "v@example.org" } })).status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 429, 429]);
  });
});

describe("démarche réservée (account_required)", () => {
  it("refusée sans compte, sans profil, et en session invitée ; acceptée connecté avec profil", async () => {
    const anon = await world.browser().send("/v1/demandes", { json: depot({}, PROC_RESERVEE.id) });
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("account_required");
    expect(world.iris.ingested).toHaveLength(0);

    const noProfile = world.browser();
    await signedIn(world, noProfile, EMAIL);
    expect((await noProfile.send("/v1/demandes", { json: depot({}, PROC_RESERVEE.id) })).body.error.code).toBe("account_required");

    const ok = world.browser(SCEAUX, "198.51.100.20");
    await withProfile(world, ok, "autre.personne@example.org");
    const accepted = await ok.send("/v1/demandes", { json: depot({}, PROC_RESERVEE.id) });
    expect(accepted.status).toBe(201);
  });

  it("un mode d'accès inconnu du Socle vaut « réservé » (jamais ouvert par défaut)", async () => {
    const reply = await world.browser().send("/v1/demandes", { json: depot({}, PROC_FUTUR.id) });
    expect(reply.body.error.code).toBe("account_required");
  });

  it("la fiche confirmée par le Socle fait foi : un rattachement corrigé par un agent coupe le dépôt rattaché", async () => {
    const browser = world.browser();
    await withProfile(world, browser, EMAIL);
    // Un agent a corrigé le rattachement : le Socle ne désigne plus la fiche mémorisée.
    for (const key of [...world.socle.refs.keys()]) world.socle.refs.delete(key);
    const reply = await browser.send("/v1/demandes", { json: depot({}, PROC_RESERVEE.id) });
    expect(reply.body.error.code).toBe("account_required");
    // Une démarche libre part, mais SANS rattachement.
    await browser.send("/v1/demandes", { json: depot() });
    expect(world.iris.ingested.at(-1)!.socle_contact_id).toBeUndefined();
  });
});

describe("consentements (trois états)", () => {
  it("accorder puis retirer : deux recueils datés, l'état suit la date la plus récente", async () => {
    const browser = world.browser();
    await withProfile(world, browser, EMAIL);
    expect((await browser.send("/v1/compte/profil")).body.profil.consentements).toEqual({ traitement: null, partage: null });
    const granted = await browser.send("/v1/compte/consentements", { json: { kind: "partage", granted: true } });
    expect(granted.body.profil.consentements.partage).toMatchObject({ accorde: true });
    const withdrawn = await browser.send("/v1/compte/consentements", { json: { kind: "partage", granted: false } });
    expect(withdrawn.body.profil.consentements.partage).toMatchObject({ accorde: false });
    // Jamais la phrase : le Socle la compose.
    const consent = world.callsTo("contacts").filter((c) => c.path.endsWith("/consents")).at(-1)!;
    expect(consent.body).toEqual({ kind: "partage", granted: false });
  });

  it("refuse un type hors catalogue, une phrase, un booléen douteux, et l'absence de fiche", async () => {
    const browser = world.browser();
    await signedIn(world, browser, EMAIL);
    expect((await browser.send("/v1/compte/consentements", { json: { kind: "partage", granted: true } })).status).toBe(400);
    await browser.send("/v1/compte/profil", { json: IDENTITE });
    for (const body of [{ kind: "sms", granted: true }, { kind: "partage", granted: "oui" }, { kind: "partage" }, null, "texte"]) {
      expect((await browser.send("/v1/compte/consentements", { json: body })).status).toBe(400);
    }
  });
});

describe("états d'erreur des partenaires", () => {
  it("Socle muet pendant la lecture du profil : 503, pas un profil vide", async () => {
    const browser = world.browser();
    await withProfile(world, browser, EMAIL);
    world.socle.scopes.delete("citizen"); // le Socle répond 403 : clé mal réglée
    const reply = await browser.send("/v1/compte/profil");
    expect(reply.status).toBe(503);
    expect(reply.body.error.code).toBe("profil_indisponible");
  });

  it("Iris sans le jeton partagé (secret non posé côté Nora) : « Mes demandes » est fermé, pas ouvert", async () => {
    const closed = await World.create({ NORA_IRIS_TOKEN_SECRET: undefined });
    try {
      const browser = closed.browser();
      await withProfile(closed, browser, EMAIL);
      const reply = await browser.send("/v1/compte/demandes");
      expect(reply.status).toBe(502);
      expect(reply.body.error.code).toBe("suivi_unavailable");
    } finally {
      await closed.close();
    }
  });

  it("GoTrue limite les connexions (429) : panne 503, jamais « mot de passe incorrect »", async () => {
    const browser = world.browser();
    await registerConfirmed(world, browser, EMAIL);
    world.gotrue.tokenStatus = 429;
    const reply = await login(browser, EMAIL);
    expect(reply.status).toBe(503);
    expect(reply.body.error.code).toBe("account_unavailable");
  });

  it("collectivité sans serveur d'envoi : l'inscription dit « indisponible » et ne crée rien", async () => {
    world.socle.smtp.set(SCEAUX.id, null);
    const reply = await world.browser().send("/v1/compte/inscription", { json: { email: EMAIL, cguAccepted: true } });
    expect(reply.status).toBe(503);
    expect(reply.body.error.code).toBe("mail_unavailable");
    expect(world.gotrue.users.size).toBe(0);
  });

  it("base Nora injoignable : « session indisponible » (503), pas un visiteur anonyme", async () => {
    const browser = world.browser();
    await signedIn(world, browser, EMAIL);
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/rest/v1/rpc/")) throw new TypeError("network down");
      return real(input, init);
    });
    const reply = await browser.send("/v1/session");
    expect(reply.status).toBe(503);
    expect(reply.body.error.code).toBe("session_unavailable");
  });

  it("route inconnue : 404 ; méthode non prévue : 405", async () => {
    const browser = world.browser();
    expect((await browser.send("/v1/inconnue")).status).toBe(404);
    expect((await browser.send("/v1/compte/connexion")).status).toBe(405);
    expect((await browser.send("/v1/compte/demandes", { method: "POST", json: {} })).status).toBe(405);
  });
});
