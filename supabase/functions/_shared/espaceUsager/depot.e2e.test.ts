/**
 * Le dépôt (`POST /v1/demandes`) et la concurrence côté compte : ce que le
 * serveur laisse passer vers Iris (liste blanche des réponses, de l'identité et
 * des pièces), les consentements, et les rafales (inscriptions, connexions).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANTONY, PASSWORD, PROC_LIBRE, registerConfirmed, SCEAUX, signedIn, withProfile, World } from "./harness/world.ts";

vi.mock("../account/mail/transport.ts", async () => {
  const { mailbox } = await import("./harness/mailbox.ts");
  return {
    sendAccountMessage: async (config: { host: string }, to: string, message: { subject: string; text: string }) => {
      mailbox.push({ to, subject: message.subject, text: message.text, smtpHost: config.host });
    },
  };
});

let world: World;
let n = 0;
const freshIp = () => `198.51.${100 + Math.floor(n / 250)}.${(n++ % 250) + 1}`;

beforeEach(async () => {
  world = await World.create();
});
afterEach(async () => {
  await world.close();
});

const CONSENTS = [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }];
const body = (extra: Record<string, unknown> = {}) => ({ demarcheId: PROC_LIBRE.id, submissionId: crypto.randomUUID(), formData: {}, consents: CONSENTS, ...extra });
const deposit = (extra: Record<string, unknown> = {}, host = SCEAUX) => world.browser(host, freshIp()).send("/v1/demandes", { json: body(extra) });
const lastEnvelope = () => world.iris.ingested.at(-1) as Record<string, any>;

describe("dépôt : ce qui part vers Iris", () => {
  it("ne garde que les réponses que le formulaire déclare, et les clés d'identité du catalogue", async () => {
    const reply = await deposit({
      formData: { message: "Bonjour", inventee: "x", __proto__: { admin: true }, constructor: "y" },
      requester: { courriel: "a@example.org", nom_usuel: "Durand", role: "admin", is_agent: "true", contact_type: "personne", vide: " ", nombre: 5 },
    });
    expect(reply.status).toBe(201);
    expect(lastEnvelope().form_data).toEqual({ message: "Bonjour" });
    expect(lastEnvelope().requester).toEqual({ courriel: "a@example.org", nom_usuel: "Durand", contact_type: "personne" });
  });

  it("jamais de champ réservé d'Iris venu du navigateur : fiche, source, collectivité, clé d'idempotence", async () => {
    await deposit({
      socle_contact_id: "00000000-0000-4000-8000-000000000000",
      socle_root_organization_id: ANTONY.id,
      source_system: "clara",
      tenantId: ANTONY.id,
      idempotency_key: "forgee",
      external_id: "forge",
    });
    const e = lastEnvelope();
    expect(e.socle_root_organization_id).toBe(SCEAUX.id);
    expect(e.source_system).toBe("portail-citoyen");
    expect(e.socle_contact_id).toBeUndefined();
    expect(e.external_id).toBe(e.idempotency_key);
    expect(e.external_id).not.toBe("forge");
  });

  it("consentements : obligatoires, catalogue fermé, le traitement accordé — sinon rien ne part", async () => {
    const bad: unknown[] = [
      undefined,
      [],
      [{ kind: "traitement", granted: false }, { kind: "partage", granted: true }],
      [{ kind: "traitement", granted: true }, { kind: "sms", granted: true }],
      [{ kind: "traitement", granted: true, statement: "J'accepte tout" }],
      [{ kind: "traitement", granted: true }, { kind: "traitement", granted: true }],
      "oui",
    ];
    for (const consents of bad) {
      const reply = await deposit({ consents });
      expect(reply.status, JSON.stringify(consents)).toBe(400);
    }
    expect(world.iris.ingested).toHaveLength(0);
  });

  it("enveloppe mal formée : 400 sans appel à Iris", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    for (const raw of ["{", "[]", "null", "42"]) {
      expect((await browser.send("/v1/demandes", { body: raw, headers: { "content-type": "application/json" } })).status, raw).toBe(400);
    }
    for (const extra of [{ demarcheId: "" }, { submissionId: "" }, { submissionId: "x".repeat(201) }, { formData: [] }, { requester: [] }, { attachments: "x" }]) {
      expect((await deposit(extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect(world.iris.ingested).toHaveLength(0);
  });

  it("suivi en ligne : l'adresse est obligatoire ; sans la case, aucun code n'est demandé", async () => {
    expect((await deposit({ guestAccess: true })).status).toBe(400);
    expect((await deposit({ guestAccess: true, requester: { courriel: "pas-une-adresse" } })).status).toBe(400);
    const ok = await deposit({ guestAccess: true, requester: { courriel: "a@example.org" } });
    expect(ok.status).toBe(201);
    expect(lastEnvelope().guest_access).toEqual({ tracking_url: "https://sceaux.edilumen.fr/suivi" });
    await deposit({ requester: { courriel: "a@example.org" } });
    expect(lastEnvelope().guest_access).toBeUndefined();
  });

  it("pièces : seules celles d'un champ « pièce » déclaré, une fois chacune ; ici le formulaire n'en déclare aucune", async () => {
    await deposit({
      attachments: [
        { uploadId: "u1", fieldKey: "message" },
        { uploadId: "u2", fieldKey: "inconnu" },
        { uploadId: "u1", fieldKey: "message" },
        "x",
        null,
        { uploadId: "", fieldKey: "message" },
        { uploadId: "u".repeat(65), fieldKey: "message" },
      ],
    });
    expect(lastEnvelope().attachments).toBeUndefined();
  });

  it("organisme destinataire : seulement un organisme qui propose la démarche", async () => {
    expect((await deposit({ organizationId: ANTONY.id })).status).toBe(400);
    expect((await deposit({ organizationId: "n-importe-quoi" })).status).toBe(400);
    expect((await deposit({ organizationId: SCEAUX.id })).status).toBe(201);
    expect(lastEnvelope().socle_organization_id).toBe(SCEAUX.id);
  });

  it("démarche inconnue ou d'une autre collectivité : 404, rien n'est déposé", async () => {
    expect((await deposit({ demarcheId: "inexistante" })).status).toBe(404);
    expect(world.iris.ingested).toHaveLength(0);
  });

  it("Iris refuse ou tombe : « indisponible » ou « refusée », jamais un accusé inventé", async () => {
    world.iris.tenantSources.clear(); // Iris répond 403 : source fermée pour la collectivité
    const reply = await deposit();
    expect(reply.status).toBeGreaterThanOrEqual(500);
    expect(reply.body.receipt).toBeUndefined();
    expect(reply.body.error.code).toBe("iris_misconfigured");
  });

  it("le dépôt rattaché ne part que pour la fiche CONFIRMÉE : Socle muet au moment du dépôt → dépôt sans rattachement, jamais une erreur", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await withProfile(world, browser, "camille@example.org");
    world.socle.scopes.delete("citizen");
    const reply = await browser.send("/v1/demandes", { json: body() });
    expect(reply.status).toBe(201);
    expect(lastEnvelope().socle_contact_id).toBeUndefined();
  });
});

describe("pièces avant le dépôt", () => {
  const upload = (browser = world.browser(SCEAUX, freshIp()), name = "justificatif.pdf", size = 100, extra: Record<string, string> = {}) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(size)], name, { type: "application/pdf" }));
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return browser.send("/v1/demandes/pieces", { body: form });
  };

  it("une pièce part à Iris, qui rend seulement un identifiant", async () => {
    const reply = await upload();
    expect(reply.status).toBe(201);
    expect(Object.keys(reply.body.piece).sort()).toEqual(["fileName", "mimeType", "sizeBytes", "uploadId"]);
    expect(world.iris.uploads).toEqual([{ name: "justificatif.pdf", size: 100 }]);
  });

  it("fichier absent, vide ou au nom absurde : 400, rien n'atteint Iris", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    expect((await browser.send("/v1/demandes/pieces", { body: new FormData() })).status).toBe(400);
    expect((await upload(browser, "vide.pdf", 0)).status).toBe(400);
    expect((await upload(browser, "x".repeat(256) + ".pdf")).status).toBe(400);
    expect(world.iris.uploads).toHaveLength(0);
  });

  it("frein de 20 pièces par minute et par visiteur", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await upload(browser)).status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses[20]).toBe(429);
    expect((await upload()).status).toBe(201); // un autre visiteur n'est pas freiné
  });
});

describe("rafales", () => {
  it("dix inscriptions simultanées de la même adresse : un seul compte, au plus 5 courriels, aucune erreur de serveur", async () => {
    const replies = await Promise.all(
      Array.from({ length: 10 }, () => world.browser(SCEAUX, freshIp()).send("/v1/compte/inscription", { json: { email: "rafale@example.org", cguAccepted: true } })),
    );
    await world.flush();
    expect(replies.every((r) => r.status < 500)).toBe(true);
    expect(world.gotrue.users.size).toBe(1);
    expect((await world.sql("select count(*)::int n from citizen_accounts"))[0]).toEqual({ n: 1 });
    expect(world.mailsTo("rafale@example.org").length).toBeLessThanOrEqual(5);
    expect(replies.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(5);
  });

  it("dix connexions simultanées du même compte : dix sessions distinctes, toutes valables", async () => {
    await registerConfirmed(world, world.browser(SCEAUX, freshIp()), "camille@example.org");
    const browsers = Array.from({ length: 10 }, () => world.browser(SCEAUX, freshIp()));
    const replies = await Promise.all(browsers.map((b) => b.send("/v1/compte/connexion", { json: { email: "camille@example.org", password: PASSWORD } })));
    expect(replies.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(new Set(browsers.map((b) => b.sessionCookie)).size).toBe(10);
    for (const b of browsers) expect((await b.send("/v1/session")).body.authenticated).toBe(true);
  });

  it("rafale de lectures sur « Mes demandes » : aucune ne voit les données d'un autre compte", async () => {
    const [a, b] = [world.browser(SCEAUX, freshIp()), world.browser(SCEAUX, freshIp())];
    const ca = await withProfile(world, a, "a@example.org", { civilite: "madame", prenom: "Alice", nom: "A", adresse1: "1 rue A", codePostal: "92330", ville: "Sceaux" });
    const cb = await withProfile(world, b, "b@example.org", { civilite: "monsieur", prenom: "Bob", nom: "B", adresse1: "1 rue B", codePostal: "92330", ville: "Sceaux" });
    world.iris.addRequest({ tenantId: SCEAUX.id, contactId: ca, subject: "DOSSIER-ALICE" });
    world.iris.addRequest({ tenantId: SCEAUX.id, contactId: cb, subject: "DOSSIER-BOB" });
    const replies = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? a : b).send("/v1/compte/demandes")));
    replies.forEach((r, i) => {
      const text = JSON.stringify(r.body);
      expect(text).toContain(i % 2 === 0 ? "DOSSIER-ALICE" : "DOSSIER-BOB");
      expect(text).not.toContain(i % 2 === 0 ? "DOSSIER-BOB" : "DOSSIER-ALICE");
    });
  });

  it("une session existante qui se reconnecte pendant qu'elle lit : la lecture ne voit jamais la session d'un autre", async () => {
    const a = world.browser(SCEAUX, freshIp());
    await signedIn(world, a, "a@example.org");
    const stale = a.sessionCookie;
    const results = await Promise.all([
      a.send("/v1/compte"),
      a.send("/v1/compte/connexion", { json: { email: "a@example.org", password: PASSWORD } }),
      a.send("/v1/compte"),
    ]);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(a.sessionCookie).not.toBe(stale);
  });
});
