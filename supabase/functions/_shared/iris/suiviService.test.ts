import { describe, expect, it } from "vitest";
import type { IrisClient, IrisReply } from "./irisClient.ts";
import { pieceUrl, readDemande, verifyAccess } from "./suiviService.ts";
import { parseSuiviAccess, suiviStatusOf, toSuiviDemande } from "../domain/suivi.ts";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const PIECE_ID = "22222222-2222-4222-8222-222222222222";

function fakeIris(reply: IrisReply) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: IrisClient = {
    post(path, body) {
      calls.push({ method: "POST", path, body });
      return Promise.resolve(reply);
    },
    get(path) {
      calls.push({ method: "GET", path });
      return Promise.resolve(reply);
    },
    postMultipart: () => Promise.reject(new Error("pas ici")),
  };
  return { client, calls };
}

const VIEW = {
  request: {
    id: REQUEST_ID,
    reference: "DEM-2026-000042",
    subject: "Stationnement gênant",
    procedure_name: "Signaler un problème",
    status: "en_attente",
    received_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-02T08:00:00Z",
    closed_at: null,
    closure_text: null,
    closure_motif: "doublon",
    attachments: [{ id: PIECE_ID, file_name: "photo.jpg", mime_type: "image/jpeg", size: 1000, storage_path: "x" }],
    messages: [
      { id: "m1", subject: "Précision", body: "Pouvez-vous…", sent_at: "2026-10-02T08:00:00Z", sent_by: "agent", attachments: [] },
    ],
  },
};

describe("verifyAccess", () => {
  const access = { reference: "DEM-2026-000042", email: "a@b.fr", code: "ABCD-EFGH-JK" };

  it("rend l'identifiant de la demande", async () => {
    const iris = fakeIris({ kind: "ok", body: { request_id: REQUEST_ID } });
    expect(await verifyAccess(access, iris.client)).toEqual({ ok: true, value: REQUEST_ID });
    expect(iris.calls[0]).toEqual({ method: "POST", path: "/v1/citizen/access", body: access });
  });

  it("un refus d'Iris est un « non » unique ; une panne n'en est pas un", async () => {
    expect(await verifyAccess(access, fakeIris({ kind: "not_found" }).client)).toEqual({ ok: false, reason: "suivi_refused" });
    expect(await verifyAccess(access, fakeIris({ kind: "rejected", status: 400, message: null }).client)).toEqual({
      ok: false,
      reason: "suivi_refused",
    });
    expect(await verifyAccess(access, fakeIris({ kind: "unreachable" }).client)).toEqual({ ok: false, reason: "suivi_unavailable" });
    expect(await verifyAccess(access, fakeIris({ kind: "auth_failed" }).client)).toEqual({ ok: false, reason: "suivi_unavailable" });
    expect(await verifyAccess(access, fakeIris({ kind: "ok", body: { request_id: "pas-un-uuid" } }).client)).toEqual({
      ok: false,
      reason: "suivi_unavailable",
    });
  });
});

describe("readDemande", () => {
  it("ne garde que la vue du portail", async () => {
    const iris = fakeIris({ kind: "ok", body: VIEW });
    const result = await readDemande(REQUEST_ID, iris.client);
    expect(iris.calls[0].path).toBe(`/v1/citizen/requests/${REQUEST_ID}`);
    if (!result.ok) throw new Error("refusé");
    expect(result.value.status).toBe("en_attente");
    const text = JSON.stringify(result.value);
    for (const leak of [REQUEST_ID, "doublon", "agent", "storage_path"]) expect(text).not.toContain(leak);
    expect(result.value.pieces).toEqual([{ id: PIECE_ID, fileName: "photo.jpg", mimeType: "image/jpeg", size: 1000 }]);
  });

  it("n'appelle pas Iris avec un identifiant mal formé", async () => {
    const iris = fakeIris({ kind: "ok", body: VIEW });
    expect(await readDemande("../v1/requests", iris.client)).toEqual({ ok: false, reason: "suivi_refused" });
    expect(iris.calls).toHaveLength(0);
  });
});

describe("pieceUrl", () => {
  it("rend une URL https, rien d'autre", async () => {
    const ok = fakeIris({ kind: "ok", body: { url: "https://x.supabase.co/storage/v1/object/sign/a?token=t", expires_in: 60 } });
    expect((await pieceUrl(REQUEST_ID, PIECE_ID, ok.client)).ok).toBe(true);
    expect(ok.calls[0].path).toBe(`/v1/citizen/requests/${REQUEST_ID}/attachments/${PIECE_ID}`);
    const bad = fakeIris({ kind: "ok", body: { url: "javascript:alert(1)" } });
    expect(await pieceUrl(REQUEST_ID, PIECE_ID, bad.client)).toEqual({ ok: false, reason: "suivi_unavailable" });
  });
});

describe("domaine du suivi", () => {
  it("traduit les statuts d'Iris en statuts lisibles", () => {
    expect(suiviStatusOf("a_traiter")).toBe("envoyee");
    expect(suiviStatusOf("en_instruction")).toBe("en_cours");
    expect(suiviStatusOf("en_attente")).toBe("en_attente");
    expect(suiviStatusOf("resolue_positive")).toBe("traitee");
    expect(suiviStatusOf("resolue_negative")).toBe("traitee");
    expect(suiviStatusOf("annulee")).toBe("annulee");
    expect(suiviStatusOf("archivee")).toBe("archivee");
    expect(suiviStatusOf("inconnu_demain")).toBe("en_cours");
  });

  it("borne la saisie", () => {
    expect(parseSuiviAccess({ reference: " DEM-2026-000042 ", email: "a@b.fr", code: "abcd efgh jk" })).toEqual({
      reference: "DEM-2026-000042",
      email: "a@b.fr",
      code: "abcd efgh jk",
    });
    expect(parseSuiviAccess({ reference: "DEM", email: "pas-une-adresse", code: "x" })).toBeNull();
    expect(parseSuiviAccess({ reference: "x".repeat(41), email: "a@b.fr", code: "x" })).toBeNull();
    expect(parseSuiviAccess(null)).toBeNull();
  });

  it("refuse une vue sans référence", () => {
    expect(toSuiviDemande({ request: { status: "a_traiter" } })).toBeNull();
  });
});
