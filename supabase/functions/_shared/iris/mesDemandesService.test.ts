import { describe, expect, it, vi } from "vitest";
import type { IrisClient, IrisReply } from "./irisClient.ts";
import { listMesDemandes } from "./mesDemandesService.ts";

const CONTACT = "cccccccc-0000-4000-8000-000000000001";
const REQ = "11111111-1111-4111-8111-111111111111";
const HEADERS = { "X-Citizen-Token": "jeton" };

function iris(reply: IrisReply) {
  const get = vi.fn(async () => reply);
  const client = { get, post: vi.fn(), postMultipart: vi.fn() } as unknown as IrisClient;
  return { client, get };
}

const row = (extra: Record<string, unknown> = {}) => ({
  id: REQ,
  reference: "DEM-2026-000001",
  subject: "Voirie",
  procedure_name: "Signaler",
  status: "a_traiter",
  received_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
  closed_at: null,
  ...extra,
});

describe("listMesDemandes", () => {
  it("demande la fiche du serveur, 20 par page, avec le jeton court — et rien d'autre", async () => {
    const { client, get } = iris({ kind: "ok", body: { requests: [row()], next_before: null } });
    const result = await listMesDemandes(CONTACT, client, HEADERS, null);
    expect(get).toHaveBeenCalledWith(`/v1/citizen/contacts/${CONTACT}/requests?limit=20`, HEADERS);
    expect(result).toEqual({
      ok: true,
      value: {
        suivante: null,
        demandes: [
          { id: REQ, reference: "DEM-2026-000001", subject: "Voirie", demarcheName: "Signaler", status: "envoyee", receivedAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T09:00:00Z", closedAt: null },
        ],
      },
    });
  });

  it("liste blanche : un champ interne servi par erreur ne ressort pas", async () => {
    const { client } = iris({ kind: "ok", body: { requests: [row({ closure_motif: "MOTIF", assigned_to: "Agent", internal_notes: ["x"], socle_contact_id: CONTACT })], next_before: null } });
    const result = await listMesDemandes(CONTACT, client, HEADERS, null);
    expect(JSON.stringify(result)).not.toMatch(/MOTIF|Agent|internal_notes|socle_contact_id|closure/);
  });

  it("une ligne illisible (identifiant non UUID, statut absent, dates manquantes) est écartée, pas rendue à moitié", async () => {
    const { client } = iris({
      ok: undefined,
      kind: "ok",
      body: {
        requests: [row(), row({ id: "pas-un-uuid" }), row({ status: undefined }), row({ received_at: undefined }), null, "x", row({ reference: 5 })],
        next_before: null,
      },
    } as unknown as IrisReply);
    const result = await listMesDemandes(CONTACT, client, HEADERS, null);
    expect(result.ok && result.value.demandes).toHaveLength(1);
  });

  it("le curseur n'est jamais interprété : seules les formes d'Iris partent, le reste est un « bad_request » sans appel", async () => {
    const { client, get } = iris({ kind: "ok", body: { requests: [], next_before: "2026-10-01T08:00:00Z_" + REQ } });
    const good = await listMesDemandes(CONTACT, client, HEADERS, "2026-10-01T08:00:00.000Z_" + REQ);
    expect(good.ok).toBe(true);
    expect(get).toHaveBeenCalledWith(expect.stringContaining("before=2026-10-01T08%3A00%3A00.000Z_" + REQ), HEADERS);
    get.mockClear();
    for (const bad of ["x", "'; drop table requests;--", "2026-10-01T08:00:00Z&limit=999", "2026-10-01T08:00:00Z_../..", "a".repeat(80)]) {
      expect(await listMesDemandes(CONTACT, client, HEADERS, bad)).toEqual({ ok: false, reason: "bad_request" });
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("l'identifiant de fiche doit être un UUID : jamais un chemin construit avec autre chose", async () => {
    const { client, get } = iris({ kind: "ok", body: { requests: [] } });
    for (const bad of ["../../x", `${CONTACT}/../${CONTACT}`, "", "x?y=1"]) {
      expect(await listMesDemandes(bad, client, HEADERS, null)).toEqual({ ok: false, reason: "suivi_refused" });
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("404 d'Iris : refus unique ; toute autre panne : indisponible (jamais un refus, jamais une liste vide)", async () => {
    expect(await listMesDemandes(CONTACT, iris({ kind: "not_found" }).client, HEADERS, null)).toEqual({ ok: false, reason: "suivi_refused" });
    for (const kind of ["unreachable", "unexpected", "auth_failed"] as const) {
      expect(await listMesDemandes(CONTACT, iris({ kind }).client, HEADERS, null)).toEqual({ ok: false, reason: "suivi_unavailable" });
    }
    expect(await listMesDemandes(CONTACT, iris({ kind: "rejected", status: 400, message: "x" }).client, HEADERS, null)).toEqual({ ok: false, reason: "suivi_unavailable" });
  });

  it("réponse 200 sans tableau : indisponible, pas une liste vide trompeuse", async () => {
    for (const body of [null, {}, { requests: "x" }, []]) {
      expect(await listMesDemandes(CONTACT, iris({ kind: "ok", body }).client, HEADERS, null)).toEqual({ ok: false, reason: "suivi_unavailable" });
    }
  });

  it("le curseur suivant est transmis tel que le sert Iris", async () => {
    const { client } = iris({ kind: "ok", body: { requests: [row()], next_before: "2026-09-01T00:00:00Z_" + REQ } });
    const result = await listMesDemandes(CONTACT, client, HEADERS, null);
    expect(result.ok && result.value.suivante).toBe("2026-09-01T00:00:00Z_" + REQ);
  });
});
