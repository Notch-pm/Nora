/**
 * ANTI-FUITE — règles non négociables de `02-espace-usager.md` §3.3 :
 * aucune fuite entre comptes citoyens, ni entre villes, ni vers des données
 * non prévues côté usager.
 *
 * Jeux de données à deux comptes dans une ville (Alice, Bob) et un compte dans
 * une seconde (Antony). Les données INTERNES (motif de clôture, notes, agents,
 * pièces d'instruction) portent des phrases-sentinelles : si l'une d'elles
 * apparaît dans une réponse, le test échoue — quelle que soit la route.
 *
 * Le faux Iris peut être « hostile » : il ajoute des champs internes à ses
 * réponses, pour vérifier que Nora ne dépend pas de la seule retenue d'Iris.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANTONY, IDENTITE, login, PASSWORD, PROC_LIBRE, registerConfirmed, SCEAUX, withProfile, World, type Reply } from "./harness/world.ts";

vi.mock("../account/mail/transport.ts", async () => {
  const { mailbox } = await import("./harness/mailbox.ts");
  return {
    sendAccountMessage: async (config: { host: string }, to: string, message: { subject: string; text: string }) => {
      mailbox.push({ to, subject: message.subject, text: message.text, smtpHost: config.host });
    },
  };
});

/** Ce qui ne doit JAMAIS sortir vers un usager. */
const SENTINELLES = [
  "MOTIF INTERNE",
  "NOTE INTERNE",
  "Agent Martin Dupont",
  "storage_path",
  "closure_motif",
  "internal_notes",
  "request_messages",
  "assigned_to",
  "instruction_interne",
  "org/x/y.pdf",
];

let world: World;
const replies: Reply[] = [];

beforeEach(async () => {
  replies.length = 0;
  world = await World.create();
  world.iris.leakExtras = true; // Iris « hostile » : ajoute ses champs internes
});
afterEach(async () => {
  await world.close();
});

/** Chaque réponse du test est relue : aucune sentinelle, aucun secret, aucun jeton. */
afterEach(() => {
  const secrets = [world.env.SOCLE_API_KEY, world.env.IRIS_API_KEY, world.env.SUPABASE_SERVICE_ROLE_KEY, world.env.NORA_AUTH_SECRET, world.env.NORA_IRIS_TOKEN_SECRET, world.env.NORA_PROXY_SECRET];
  expect(world.allReplies.length).toBeGreaterThan(0);
  for (const reply of world.allReplies) {
    const text = JSON.stringify(reply.body) + JSON.stringify([...reply.headers]);
    for (const s of SENTINELLES) expect(text, `sentinelle « ${s} » dans une réponse`).not.toContain(s);
    for (const s of secrets) expect(text, "secret d'exploitation dans une réponse").not.toContain(s!);
  }
});

async function twoCitizens() {
  const alice = world.browser(SCEAUX, "198.51.100.1");
  const bob = world.browser(SCEAUX, "198.51.100.2");
  const aliceContact = await withProfile(world, alice, "alice@example.org", { ...IDENTITE, prenom: "Alice", nom: "Alpha" });
  const bobContact = await withProfile(world, bob, "bob@example.org", { ...IDENTITE, prenom: "Bob", nom: "Beta" });
  const aliceReq = world.iris.addRequest({ tenantId: SCEAUX.id, contactId: aliceContact, subject: "Demande d'Alice" });
  const bobReq = world.iris.addRequest({ tenantId: SCEAUX.id, contactId: bobContact, subject: "Demande de Bob" });
  return { alice, bob, aliceContact, bobContact, aliceReq, bobReq };
}

describe("deux comptes d'une même ville", () => {
  it("la liste de chacun ne contient que SES demandes", async () => {
    const { alice, bob, aliceReq, bobReq } = await twoCitizens();
    const a = await alice.send("/v1/compte/demandes");
    const b = await bob.send("/v1/compte/demandes");
    expect(a.body.demandes.map((d: { id: string }) => d.id)).toEqual([aliceReq.id]);
    expect(b.body.demandes.map((d: { id: string }) => d.id)).toEqual([bobReq.id]);
    expect(JSON.stringify(a.body)).not.toContain("Demande de Bob");
  });

  it("IDOR : l'identifiant de la demande d'un autre rend le même 404 qu'un identifiant inventé", async () => {
    const { alice, bobReq } = await twoCitizens();
    const forged = await alice.send(`/v1/compte/demandes/${bobReq.id}`);
    const invented = await alice.send(`/v1/compte/demandes/${crypto.randomUUID()}`);
    expect(forged.status).toBe(404);
    expect(forged.status).toBe(invented.status);
    expect(forged.body).toEqual(invented.body);
    expect(forged.body.error.code).toBe("suivi_refused");
    // Même forme d'en-têtes : rien ne distingue « existe chez un autre » de « n'existe pas ».
    expect(forged.headers.get("cache-control")).toBe(invented.headers.get("cache-control"));
  });

  it("IDOR sur les pièces : ni celles d'un autre, ni celles d'instruction de SA demande", async () => {
    const { alice, aliceReq, bobReq } = await twoCitizens();
    const bobFile = { id: crypto.randomUUID(), fileName: "bob.pdf", kind: "demande" as const };
    bobReq.attachments.push(bobFile);
    const internal = { id: crypto.randomUUID(), fileName: "avis-interne.pdf", kind: "instruction_interne" as const };
    const own = { id: crypto.randomUUID(), fileName: "mon-justificatif.pdf", kind: "demande" as const };
    aliceReq.attachments.push(internal, own);

    expect((await alice.send(`/v1/compte/demandes/${bobReq.id}/pieces/${bobFile.id}`)).status).toBe(404);
    // La pièce de Bob demandée sous la demande d'Alice : introuvable aussi.
    expect((await alice.send(`/v1/compte/demandes/${aliceReq.id}/pieces/${bobFile.id}`)).status).toBe(404);
    expect((await alice.send(`/v1/compte/demandes/${aliceReq.id}/pieces/${internal.id}`)).status).toBe(404);

    const view = await alice.send(`/v1/compte/demandes/${aliceReq.id}`);
    expect(view.body.demande.pieces.map((p: { fileName: string }) => p.fileName)).toEqual(["mon-justificatif.pdf"]);
    // La sienne : redirection vers une URL signée de courte durée, jamais le chemin de stockage.
    const download = await alice.send(`/v1/compte/demandes/${aliceReq.id}/pieces/${own.id}`);
    expect(download.status).toBe(302);
    expect(download.headers.get("location")).toMatch(/^https:\/\//);
    expect(download.headers.get("cache-control")).toBe("no-store");
  });

  it("aucun identifiant de fiche ou de compte fourni par le navigateur n'est suivi (paramètres, en-têtes, jeton)", async () => {
    const { alice, bobContact, bobReq } = await twoCitizens();
    const forgedToken = "eyJ2IjoxfQ.AAAA";
    const tries = [
      `/v1/compte/demandes?contact=${bobContact}`,
      `/v1/compte/demandes?socle_contact_id=${bobContact}`,
      `/v1/compte/demandes?account=${crypto.randomUUID()}&tenant=${ANTONY.id}`,
      `/v1/compte/demandes?avant=${bobReq.receivedAt}`,
    ];
    for (const path of tries) {
      const reply = await alice.send(path, {
        headers: { "x-citizen-token": forgedToken, "x-socle-contact-id": bobContact, "x-nora-host": ANTONY.hostname, "x-organization-id": ANTONY.id },
      });
      if (reply.status === 200) {
        expect(reply.body.demandes.every((d: { id: string }) => d.id !== bobReq.id)).toBe(true);
        expect(JSON.stringify(reply.body)).not.toContain("Demande de Bob");
      }
    }
    // Le jeton court que lit Iris est celui que SIGNE Nora, lié à la fiche d'Alice : il ne reprend rien du navigateur.
    const seen = world.iris.tokensSeen.filter((t): t is string => t !== null);
    expect(seen.length).toBeGreaterThan(0);
    for (const token of seen) {
      expect(token).not.toBe(forgedToken);
      const payload = JSON.parse(atob(token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")));
      expect(payload.sub).not.toContain(bobContact);
      expect(payload.t).toBe(SCEAUX.id);
      expect(payload.e).toBe("alice@example.org");
      expect(payload.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(120);
    }
  });

  it("une demande masquée (issue de Clara, ou soustraite par un agent) n'apparaît ni en liste ni en détail", async () => {
    const { alice, aliceContact } = await twoCitizens();
    const masked = world.iris.addRequest({ tenantId: SCEAUX.id, contactId: aliceContact, source: "clara", citizenVisible: false, subject: "Courrier relayé par Clara" });
    const list = await alice.send("/v1/compte/demandes");
    expect(list.body.demandes.map((d: { id: string }) => d.id)).not.toContain(masked.id);
    const detail = await alice.send(`/v1/compte/demandes/${masked.id}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe("suivi_refused");
    // Un agent la rend visible : elle apparaît.
    masked.citizenVisible = true;
    expect((await alice.send(`/v1/compte/demandes/${masked.id}`)).status).toBe(200);
  });

  it("seuls les messages adressés à l'adresse du compte sont lus ; jamais l'envoi destiné à un tiers", async () => {
    const { alice, aliceReq } = await twoCitizens();
    aliceReq.emails.push(
      { id: crypto.randomUUID(), to: "alice@example.org", subject: "Pour Alice", body: "Bonjour Alice", sentAt: new Date().toISOString() },
      { id: crypto.randomUUID(), to: "tiers@example.org", subject: "Pour un tiers", body: "Message destiné à un tiers", sentAt: new Date().toISOString() },
    );
    const view = await alice.send(`/v1/compte/demandes/${aliceReq.id}`);
    expect(view.body.demande.messages.map((m: { subject: string }) => m.subject)).toEqual(["Pour Alice"]);
  });

  it("vue et liste en liste blanche, même face à un Iris qui sert des champs en trop", async () => {
    const { alice, aliceReq } = await twoCitizens();
    aliceReq.closedAt = new Date().toISOString();
    aliceReq.closureText = "Votre demande est traitée.";
    const list = await alice.send("/v1/compte/demandes");
    expect(Object.keys(list.body.demandes[0]).sort()).toEqual(["closedAt", "demarcheName", "id", "receivedAt", "reference", "status", "subject", "updatedAt"]);
    const view = await alice.send(`/v1/compte/demandes/${aliceReq.id}`);
    expect(Object.keys(view.body.demande).sort()).toEqual(["closedAt", "closureText", "demarcheName", "messages", "pieces", "receivedAt", "reference", "status", "subject", "updatedAt"]);
    expect(view.body.demande.closureText).toBe("Votre demande est traitée.");
    // (la vérification des sentinelles se fait sur chaque réponse, en afterEach)
  });

  it("le profil d'un compte ne montre jamais la fiche d'un autre, ni les notes internes de la sienne", async () => {
    const { alice, bob } = await twoCitizens();
    const a = await alice.send("/v1/compte/profil?account=ignored&contact=ignored");
    const b = await bob.send("/v1/compte/profil");
    expect(a.body.profil).toMatchObject({ prenom: "Alice", courriel: "alice@example.org" });
    expect(b.body.profil).toMatchObject({ prenom: "Bob", courriel: "bob@example.org" });
    expect(Object.keys(a.body.profil).sort()).toEqual(
      ["adresse1", "adresse2", "civilite", "codePostal", "consentements", "courriel", "dateNaissance", "fixe", "mobile", "nom", "nomUsage", "prenom", "ville"],
    );
  });

  it("le Socle n'est jamais appelé avec l'identifiant de compte d'un autre", async () => {
    const { alice } = await twoCitizens();
    await alice.send("/v1/compte/profil");
    await alice.send("/v1/compte/profil", { json: { mobile: "0612345678" } });
    await alice.send("/v1/compte/consentements", { json: { kind: "partage", granted: true } });
    const [aliceAccount] = await world.sql<{ id: string }>("select id from citizen_accounts a where a.email_hash = $1", [await sha("email:alice@example.org")]);
    const ids = new Set(world.callsTo("contacts").map((c) => c.path.match(/contacts\/([0-9a-f-]{36})/)![1]));
    // Les appels des deux inscriptions (Alice et Bob) précèdent : on ne regarde que ceux d'après.
    const afterSetup = world.callsTo("contacts").slice(-3);
    for (const call of afterSetup) expect(call.path).toContain(aliceAccount.id);
    expect(ids.size).toBe(2);
  });

  it("liens et courriels : le lien de mot de passe oublié d'Alice n'est jamais lisible par la demande de Bob", async () => {
    const { bob } = await twoCitizens();
    const before = world.mails.length;
    await bob.send("/v1/compte/mot-de-passe-oublie", { json: { email: "alice@example.org" } });
    await world.flush();
    const sent = world.mails.slice(before);
    // Le lien part chez Alice, pas chez celui qui le demande, et la réponse HTTP n'en porte rien.
    expect(sent.every((m) => m.to === "alice@example.org")).toBe(true);
  });
});

describe("deux collectivités", () => {
  async function aliceInBothCities() {
    const sceaux = world.browser(SCEAUX, "198.51.100.1");
    const contactS = await withProfile(world, sceaux, "alice@example.org", { ...IDENTITE, prenom: "Alice", nom: "Alpha" });
    const antony = world.browser(ANTONY, "198.51.100.1");
    // Même compte global, nouvel espace : connexion à Antony, profil propre.
    expect((await login(antony, "alice@example.org")).status).toBe(200);
    expect((await antony.send("/v1/compte/profil", { json: { ...IDENTITE, ville: "Antony", codePostal: "92160", prenom: "Alice", nom: "Alpha" } })).status).toBe(200);
    const [row] = await world.sql<{ socle_contact_id: string }>("select socle_contact_id from citizen_spaces where tenant_id = $1", [ANTONY.id]);
    return { sceaux, antony, contactS, contactA: row.socle_contact_id };
  }

  it("un même courriel : deux espaces, deux fiches ; chaque ville ne voit que ses demandes", async () => {
    const { sceaux, antony, contactS, contactA } = await aliceInBothCities();
    expect(contactS).not.toBe(contactA);
    const rS = world.iris.addRequest({ tenantId: SCEAUX.id, contactId: contactS, subject: "Dossier Sceaux" });
    const rA = world.iris.addRequest({ tenantId: ANTONY.id, contactId: contactA, subject: "Dossier Antony" });
    expect((await sceaux.send("/v1/compte/demandes")).body.demandes.map((d: { id: string }) => d.id)).toEqual([rS.id]);
    expect((await antony.send("/v1/compte/demandes")).body.demandes.map((d: { id: string }) => d.id)).toEqual([rA.id]);
    // La demande de Sceaux, demandée sur le domaine d'Antony : introuvable.
    expect((await antony.send(`/v1/compte/demandes/${rS.id}`)).status).toBe(404);
    expect((await sceaux.send(`/v1/compte/demandes/${rA.id}`)).status).toBe(404);
  });

  it("une session de Sceaux rejouée sur le domaine d'Antony n'ouvre rien, et reste valable à Sceaux", async () => {
    const { sceaux } = await aliceInBothCities();
    const stolen = world.browser(ANTONY, "203.0.113.200");
    stolen.sessionCookie = sceaux.sessionCookie;
    for (const path of ["/v1/session", "/v1/compte", "/v1/compte/profil", "/v1/compte/demandes"]) {
      const reply = await stolen.send(path);
      if (path === "/v1/session") expect(reply.body).toEqual({ authenticated: false });
      else expect(reply.status).toBe(401);
    }
    const mismatch = await world.sql<{ n: number }>("select count(*)::int n from citizen_auth_events where event = 'session_tenant_mismatch'");
    expect(mismatch[0].n).toBeGreaterThan(0);
    // La session légitime n'a pas été close par la tentative.
    expect((await sceaux.send("/v1/session")).body.authenticated).toBe(true);
  });

  it("le compte d'une ville ne reçoit aucun lien de l'autre : pas d'espace, pas de courriel", async () => {
    const sceaux = world.browser(SCEAUX, "198.51.100.1");
    await registerConfirmed(world, sceaux, "alice@example.org");
    const before = world.mails.length;
    // Antony ne connaît pas encore ce compte (aucun espace) : le « mot de passe oublié » n'envoie rien.
    const antony = world.browser(ANTONY, "198.51.100.9");
    const reply = await antony.send("/v1/compte/mot-de-passe-oublie", { json: { email: "alice@example.org" } });
    expect(reply.status).toBe(200);
    await world.flush();
    expect(world.mails.slice(before).filter((m) => m.smtpHost.includes("antony"))).toEqual([]);
  });

  it("la démarche d'une ville ne se dépose pas depuis une autre (identifiant forgé) et le domaine fait la collectivité", async () => {
    world.socle.procedures.get(ANTONY.id)!.push({ id: "p-antony-only", name: "Démarche d'Antony seul", fieldKey: "message" });
    const sceaux = world.browser(SCEAUX, "198.51.100.1");
    const reply = await sceaux.send("/v1/demandes", {
      json: { demarcheId: "p-antony-only", submissionId: crypto.randomUUID(), formData: {}, consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }] },
    });
    expect(reply.status).toBe(404);
    expect(world.iris.ingested).toHaveLength(0);
    // L'organisation d'une autre ville dans le corps : refusée.
    const forged = await sceaux.send("/v1/demandes", {
      json: { demarcheId: PROC_LIBRE.id, organizationId: ANTONY.id, submissionId: crypto.randomUUID(), formData: {}, consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }] },
    });
    expect(forged.status).toBe(400);
  });
});

describe("accès invité (courriel + référence + code)", () => {
  async function deposeAvecSuivi(email = "invite@example.org") {
    const browser = world.browser(SCEAUX, "198.51.100.60");
    const reply = await browser.send("/v1/demandes", {
      json: {
        demarcheId: PROC_LIBRE.id,
        submissionId: crypto.randomUUID(),
        formData: { message: "x" },
        requester: { courriel: email },
        consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }],
        guestAccess: true,
      },
    });
    return { reference: reply.body.receipt.reference as string, code: reply.body.receipt.accessCode as string, email };
  }

  it("tous les refus ont le même corps : référence inconnue, mauvaise adresse, mauvais code, autre ville", async () => {
    const { reference, code, email } = await deposeAvecSuivi();
    const attempts: Record<string, unknown>[] = [
      { reference: "DEM-2026-999999", email, code },
      { reference, email: "autre@example.org", code },
      { reference, email, code: "ZZZZ-ZZZZ-ZZ" },
      { reference: "", email, code },
      { reference, email: "sans-arobase", code },
    ];
    const bodies: unknown[] = [];
    for (const [i, json] of attempts.entries()) {
      const reply = await world.browser(SCEAUX, `198.51.100.${70 + i}`).send("/v1/suivi", { json });
      expect(reply.status, JSON.stringify(json)).toBe(404);
      bodies.push(reply.body);
    }
    const antony = await world.browser(ANTONY, "198.51.100.80").send("/v1/suivi", { json: { reference, email, code } });
    expect(antony.status).toBe(404);
    bodies.push(antony.body);
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it("la session invitée ne lit que SA demande, ne passe pas pour un compte, et un compte ne passe pas pour un invité", async () => {
    const { reference, code, email } = await deposeAvecSuivi();
    const { aliceReq, alice } = await twoCitizens();
    const guest = world.browser(SCEAUX, "198.51.100.61");
    expect((await guest.send("/v1/suivi", { json: { reference, email, code } })).status).toBe(200);
    const mine = await guest.send("/v1/suivi/demande");
    expect(mine.body.demande.reference).toBe(reference);
    // La session invitée n'ouvre aucune route de compte.
    for (const path of ["/v1/compte", "/v1/compte/profil", "/v1/compte/demandes", `/v1/compte/demandes/${aliceReq.id}`]) {
      expect((await guest.send(path)).status, path).toBe(401);
    }
    expect((await guest.send("/v1/compte/profil", { json: IDENTITE })).status).toBe(401);
    // Le jeton Iris d'une session invitée porte `request:`, jamais `contact:`.
    const payloads = world.iris.tokensSeen.filter((t): t is string => !!t).map((t) => JSON.parse(atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).sub as string);
    expect(payloads.at(-1)).toMatch(/^request:/);

    // Et réciproquement : un compte connecté ne lit pas de demande par /v1/suivi.
    expect((await alice.send("/v1/suivi/demande")).status).toBe(401);
  });

  it("une demande sans accès invité n'est pas lisible par /suivi, même avec la bonne adresse", async () => {
    const browser = world.browser(SCEAUX, "198.51.100.62");
    const reply = await browser.send("/v1/demandes", {
      json: { demarcheId: PROC_LIBRE.id, submissionId: crypto.randomUUID(), formData: {}, requester: { courriel: "sans@example.org" }, consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }] },
    });
    const attempt = await browser.send("/v1/suivi", { json: { reference: reply.body.receipt.reference, email: "sans@example.org", code: "ABCD-EFGH-JK" } });
    expect(attempt.status).toBe(404);
  });

  it("jamais de motif de clôture, de note ni d'agent dans la vue invitée (Iris hostile)", async () => {
    const { reference, code, email } = await deposeAvecSuivi();
    const guest = world.browser(SCEAUX, "198.51.100.63");
    await guest.send("/v1/suivi", { json: { reference, email, code } });
    const view = await guest.send("/v1/suivi/demande");
    expect(view.status).toBe(200);
    expect(Object.keys(view.body.demande).sort()).toEqual(["closedAt", "closureText", "demarcheName", "messages", "pieces", "receivedAt", "reference", "status", "subject", "updatedAt"]);
  });
});

describe("secrets et identifiants dans les réponses", () => {
  it("aucune réponse de session, de compte ou de profil ne porte d'identifiant de compte ou d'espace", async () => {
    const { alice } = await twoCitizens();
    const ids = (await world.sql<{ id: string }>("select id from citizen_accounts union select id from citizen_spaces")).map((r) => r.id);
    for (const path of ["/v1/session", "/v1/compte", "/v1/compte/profil", "/v1/compte/demandes"]) {
      const text = JSON.stringify((await alice.send(path)).body);
      for (const id of ids) expect(text, path).not.toContain(id);
    }
  });

  it("les réponses personnelles ne sont jamais mises en cache, et le Worker ne rend ni CORS ni cookie étranger", async () => {
    const { alice } = await twoCitizens();
    for (const path of ["/v1/session", "/v1/compte", "/v1/compte/profil", "/v1/compte/demandes"]) {
      const reply = await alice.send(path);
      expect(reply.headers.get("cache-control"), path).toMatch(/no-store/);
      expect(reply.headers.get("access-control-allow-origin"), path).toBeNull();
      expect(reply.headers.get("access-control-allow-credentials"), path).toBeNull();
    }
  });

  it("jamais Access-Control-Allow-Credentials, même en appel direct (le cookie ne voyage pas entre sites)", async () => {
    const reply = await world.direct("/v1/session");
    expect(reply.headers.get("access-control-allow-credentials")).toBeNull();
    // Hors relais, personne n'est connecté, quoi que porte la requête.
    const alice = world.browser();
    await withProfile(world, alice, "carol@example.org");
    const direct = await world.direct("/v1/compte", { headers: { cookie: `__Host-nora_sid=${alice.sessionCookie}`, origin: "https://sceaux.edilumen.fr" } });
    expect(direct.status).toBe(401);
    expect(PASSWORD.length).toBeGreaterThan(11);
  });
});

async function sha(input: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
