/**
 * Le dépôt (`sendDemande`) face aux réponses de l'espace usager : démarche
 * réservée (`account_required`), défi, réseau, en-tête CSRF.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DemandeSubmission } from "@fn/_shared/domain/demande.ts";
import { sendDemande } from "./portalClient.ts";

const submission: DemandeSubmission = {
  demarcheId: "d1",
  organizationId: null,
  formData: {},
  requester: null,
  submissionId: "sub-1",
  attachments: [],
  consents: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }],
  guestAccess: false,
};

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.stubEnv("VITE_PORTAL_API_URL", "/api");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendDemande — espace usager", () => {
  it("porte l'en-tête du portail (sans lui, le serveur ne rattache pas le dépôt au compte) et n'envoie jamais de fiche", async () => {
    const fetchMock = vi.fn(async () => reply(201, { receipt: { reference: "DEM-2026-000001", status: "a_traiter", created: true } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendDemande(submission);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/demandes");
    expect((init.headers as Record<string, string>)["x-nora-request"]).toBe("1");
    expect(init.body as string).not.toMatch(/socle_contact_id|socleContactId|account/i);
  });

  it("sans configuration de l'adresse de l'API : « non configuré », aucun appel", async () => {
    vi.stubEnv("VITE_PORTAL_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendDemande(submission)).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("réseau coupé : « network » (l'usager peut renvoyer, le même submissionId évite le doublon)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await sendDemande(submission)).toEqual({ ok: false, reason: "network" });
  });

  it("défi manquant ou faux : le même échec réessayable qu'un dépôt qui rate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(428, { error: { code: "challenge_required" } })));
    expect(await sendDemande(submission)).toEqual({ ok: false, reason: "iris_unavailable" });
  });

  it("réponse sans référence lisible : jamais annoncée comme reçue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(201, { receipt: { reference: "" } })));
    expect(await sendDemande(submission)).toEqual({ ok: false, reason: "iris_unavailable" });
  });

  // ANOMALIE A4 (L3c) — portalClient.ts, `KNOWN_FAILURES` (l. 98-112) ne contient pas
  // « account_required ». Le serveur répond bien 401 { error: { code: "account_required" } }
  // à un dépôt refusé sur une démarche réservée, mais `readFailure` ne reconnaît pas ce code et
  // le ramène à « socle_unavailable » : FormulairePage (l. 480) attend `account_required` pour
  // afficher l'encart « Me connecter / Compléter mes informations » — il ne s'affichera jamais,
  // l'usager lira « service momentanément indisponible ». Se produit dès que la garde d'écran est
  // dépassée (session expirée pendant la saisie, profil vidé, ouverture directe du formulaire).
  it.fails("A4 — un dépôt refusé pour « account_required » remonte ce code à l'écran", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { error: { code: "account_required", message: "…" } })));
    expect(await sendDemande(submission)).toEqual({ ok: false, reason: "account_required" });
  });

  it("A4 (contrôle) — le refus est bien un échec, jamais un accusé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { error: { code: "account_required" } })));
    expect((await sendDemande(submission)).ok).toBe(false);
  });
});
