/**
 * Robustesse du routeur de portal-api face à des entrées hostiles ou absurdes :
 * identifiants forgés, encodages invalides, méthodes inattendues, dates
 * impossibles. Aucune ne doit produire autre chose qu'un refus propre.
 *
 * Les anomalies A1 à A3 constatées le 2026-10-20 sont corrigées : leurs tests
 * gardent la trace du défaut et empêchent son retour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITE, PROC_LIBRE, SCEAUX, withProfile, World } from "./harness/world.ts";
import { parseIdentite } from "../domain/profil.ts";

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
const freshIp = () => `198.51.100.${(n++ % 250) + 1}`;

beforeEach(async () => {
  world = await World.create();
});
afterEach(async () => {
  await world.close();
});

describe("identifiants forgés dans l'URL", () => {
  const FORGED = [
    "/v1/compte/demandes/not-a-uuid",
    "/v1/compte/demandes/" + "-".repeat(36),
    "/v1/compte/demandes/" + "0".repeat(36),
    "/v1/compte/demandes/00000000-0000-0000-0000-000000000000/pieces/00000000-0000-0000-0000-000000000000",
    "/v1/compte/demandes/..%2f..%2f..%2frest%2fv1%2fusers",
    "/v1/compte/demandes/" + crypto.randomUUID().toUpperCase(),
    "/v1/compte/demandes/" + crypto.randomUUID() + "/pieces/../" + crypto.randomUUID(),
    "/v1/compte/demandes/" + crypto.randomUUID() + "%00",
    "/v1/suivi/demande/pieces/xyz",
  ];

  it.each(FORGED)("%s : jamais un 200, jamais un 5xx", async (path) => {
    const browser = world.browser(SCEAUX, freshIp());
    await withProfile(world, browser, "camille@example.org");
    const reply = await browser.send(path);
    expect(reply.status).toBeGreaterThanOrEqual(400);
    expect(reply.status).toBeLessThan(500);
  });

  it("curseur de pagination : seules les formes d'Iris passent (pas d'injection)", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await withProfile(world, browser, "camille@example.org");
    for (const avant of ["x", "2026-01-01T00:00:00Z' or 1=1--", "2026-01-01T00:00:00Z_not-a-uuid", "../../etc/passwd", "%00"]) {
      const reply = await browser.send(`/v1/compte/demandes?avant=${encodeURIComponent(avant)}`);
      expect(reply.status, avant).toBe(400);
    }
    expect((await browser.send("/v1/compte/demandes?avant=2026-01-01T00:00:00.000Z_" + crypto.randomUUID())).status).toBe(200);
  });
});

describe("méthodes et routes inattendues", () => {
  it.each([
    ["PUT", "/v1/compte/profil"],
    ["DELETE", "/v1/compte/profil"],
    ["PATCH", "/v1/compte"],
    ["DELETE", "/v1/session"],
    ["PUT", "/v1/suivi"],
    ["GET", "/v1/compte/consentements"],
    ["GET", "/v1/compte/totp/activation"],
  ])("%s %s : 405, rien n'est exécuté", async (method, path) => {
    const reply = await world.browser(SCEAUX, freshIp()).send(path, { method, json: method === "GET" ? undefined : {} });
    expect(reply.status).toBe(405);
  });

  it("OPTIONS répond 204 sans jamais autoriser les cookies", async () => {
    const reply = await world.direct("/v1/compte", { method: "OPTIONS" });
    expect(reply.status).toBe(204);
    expect(reply.headers.get("access-control-allow-credentials")).toBeNull();
    expect(reply.headers.get("access-control-allow-headers")).not.toMatch(/x-nora-request|cookie/i);
  });

  it("un secret manquant côté serveur se dit « non configuré » sans nommer le secret", async () => {
    const bare = await World.create({ NORA_AUTH_SECRET: undefined });
    try {
      const reply = await bare.browser(SCEAUX, freshIp()).send("/v1/compte/inscription", { json: { email: "a@example.org", cguAccepted: true } });
      expect(reply.status).toBe(503);
      expect(JSON.stringify(reply.body)).not.toMatch(/NORA_AUTH_SECRET|SUPABASE/);
    } finally {
      await bare.close();
    }
  });

  it("domaine inconnu : « aucune collectivité », pas de session, pas de compte", async () => {
    const reply = await world.browser({ hostname: "inconnu.edilumen.fr" }, freshIp()).send("/v1/session");
    expect(reply.status).toBe(404);
    const signup = await world.browser({ hostname: "inconnu.edilumen.fr" }, freshIp()).send("/v1/compte/inscription", { json: { email: "a@example.org", cguAccepted: true } });
    expect(signup.status).toBe(404);
    expect(world.gotrue.users.size).toBe(0);
  });
});

describe("anomalies constatées le 2026-10-20, corrigées", () => {
  // A1 (corrigée) (mineure) — portal-api/index.ts, route GET /v1/demarches/{id} :
  // `decodeURIComponent` sans garde. Un pourcentage mal formé lève URIError,
  // non rattrapée : la fonction répond 500 au lieu du 404 des autres identifiants.
  it("A1 — GET /v1/demarches/%E0%A4%A (encodage invalide) rend un 404 propre, pas une exception", async () => {
    const reply = await world.browser(SCEAUX, freshIp()).send("/v1/demarches/%E0%A4%A");
    expect(reply.status).toBe(404);
  });

  // A2 (corrigée) (mineure) — domain/profil.ts `parseIdentite` et contacts-api
  // `parseCitizenIdentity` : la date de naissance n'est vérifiée que par la
  // forme AAAA-MM-JJ. « 1990-02-31 » ou « 2026-13-45 » traverse, puis le
  // `::date` du rattachement SQL échoue (22008) → le Socle répond 500 et Nora
  // « service indisponible » au lieu d'une erreur de saisie sur le champ.
  it("A2 — une date de naissance impossible est refusée à la saisie (champ dateNaissance)", () => {
    for (const dateNaissance of ["1990-02-31", "2026-13-45", "0000-00-00"]) {
      const parsed = parseIdentite({ ...IDENTITE, dateNaissance });
      expect(parsed.ok, dateNaissance).toBe(false);
    }
  });

  it("A2 (contrôle) — une date réelle passe", () => {
    expect(parseIdentite({ ...IDENTITE, dateNaissance: "1990-02-28" }).ok).toBe(true);
  });

  // A3 (corrigée) (connue, relecture L3c M1) — le `requester` d'un dépôt connecté
  // est transmis tel que saisi : l'adresse déclarée n'est pas recomposée depuis
  // le compte. L'usager connecté peut faire écrire Iris (accusé, code) à une
  // adresse qui n'est pas la sienne. Pas de fuite entre comptes, mais un relais
  // de courriel. Attendu après correction : le courriel du dépôt connecté est
  // celui du compte.
  it("A3 — un dépôt connecté déclare l'adresse du COMPTE, pas celle du corps (M1)", async () => {
    const browser = world.browser(SCEAUX, freshIp());
    await withProfile(world, browser, "camille@example.org");
    await browser.send("/v1/demandes", {
      json: {
        demarcheId: PROC_LIBRE.id,
        submissionId: crypto.randomUUID(),
        formData: {},
        requester: { courriel: "victime@example.org" },
        consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }],
        guestAccess: true,
      },
    });
    const sent = world.iris.ingested.at(-1)!.requester as Record<string, string>;
    expect(sent.courriel).toBe("camille@example.org");
  });
});
