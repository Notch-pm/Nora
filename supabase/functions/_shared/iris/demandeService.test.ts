import { describe, expect, it } from "vitest";
import { submitDemande, type SubmitDemandeInput } from "./demandeService.ts";
import type { IrisClient, IrisReply } from "./irisClient.ts";

const CREATED = {
  created: true,
  request: { id: "uuid", reference: "DEM-2026-000123", status: "a_traiter", version: 1 },
};

/** Un Iris simulé : on retient l'enveloppe reçue, on rend ce qu'on veut. */
function fakeIris(reply: IrisReply = { kind: "ok", body: CREATED }) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const client: IrisClient = {
    post(path, body) {
      calls.push({ path, body: body as Record<string, unknown> });
      return Promise.resolve(reply);
    },
    postMultipart: () => Promise.reject(new Error("pas ici")),
  };
  return { client, calls };
}

const INPUT: SubmitDemandeInput = {
  sourceSystem: "portail-citoyen",
  tenantId: "accm-uuid",
  demarcheName: "Signaler un problème de voirie",
  submission: {
    demarcheId: "proc-1",
    organizationId: "arles-uuid",
    formData: { motif: "voirie" },
    requester: { contact_type: "personne", courriel: "a@b.fr" },
    submissionId: "dep-1",
    attachments: [],
    consents: [
      { kind: "traitement", granted: true },
      { kind: "partage", granted: false },
    ],
  },
};

describe("submitDemande — l'enveloppe d'ingestion", () => {
  it("compose l'enveloppe attendue par Iris", async () => {
    const iris = fakeIris();
    const result = await submitDemande(INPUT, iris.client);

    expect(result).toEqual({
      ok: true,
      receipt: { reference: "DEM-2026-000123", status: "a_traiter", created: true },
    });
    expect(iris.calls[0].path).toBe("/v1/requests");
    expect(iris.calls[0].body).toEqual({
      source_system: "portail-citoyen",
      external_id: "dep-1",
      idempotency_key: "dep-1",
      socle_root_organization_id: "accm-uuid",
      socle_organization_id: "arles-uuid",
      socle_procedure_id: "proc-1",
      subject: "Signaler un problème de voirie",
      requester: { contact_type: "personne", courriel: "a@b.fr" },
      form_data: { motif: "voirie" },
      consents: [
        { kind: "traitement", granted: true },
        { kind: "partage", granted: false },
      ],
      context: { channel: "portail" },
    });
  });

  it("n'envoie des consentements que la réponse — jamais un libellé, qu'Iris refuserait", async () => {
    const iris = fakeIris();
    await submitDemande(
      {
        ...INPUT,
        submission: {
          ...INPUT.submission,
          consents: [{ kind: "traitement", granted: true, statement: "J'accepte…" } as never],
        },
      },
      iris.client,
    );
    expect(iris.calls[0].body.consents).toEqual([{ kind: "traitement", granted: true }]);
  });

  it("référence les pièces déjà déposées par upload_id, et rien de plus", async () => {
    const iris = fakeIris();
    await submitDemande(
      {
        ...INPUT,
        submission: {
          ...INPUT.submission,
          attachments: [{ uploadId: "up-1", fieldKey: "justificatif" }, { uploadId: "up-2", fieldKey: "photo" }],
        },
      },
      iris.client,
    );
    expect(iris.calls[0].body.attachments).toEqual([
      { upload_id: "up-1", form_field_key: "justificatif" },
      { upload_id: "up-2", form_field_key: "photo" },
    ]);
    // Sans pièce, la clé est absente : la whitelist d'Iris n'a rien à refuser.
    const sans = fakeIris();
    await submitDemande(INPUT, sans.client);
    expect(sans.calls[0].body).not.toHaveProperty("attachments");
  });

  it("porte le MÊME identifiant en external_id et en idempotency_key", async () => {
    // C'est ce qui rend le double-clic et le renvoi après coupure inoffensifs :
    // Iris rend alors la demande existante au lieu d'en créer une seconde.
    const iris = fakeIris();
    await submitDemande(INPUT, iris.client);
    const body = iris.calls[0].body;
    expect(body.external_id).toBe(body.idempotency_key);
  });

  it("n'envoie pas d'organisation destinataire quand aucune n'est choisie", async () => {
    // La whitelist d'Iris refuse toute clé inconnue, et une clé nulle ne vaut
    // pas « pas de valeur ».
    const iris = fakeIris();
    await submitDemande(
      { ...INPUT, submission: { ...INPUT.submission, organizationId: null } },
      iris.client,
    );
    expect(iris.calls[0].body).not.toHaveProperty("socle_organization_id");
  });

  it("dit l'anonymat plutôt que de laisser une identité vide", async () => {
    // Iris refuse une enveloppe sans identité. Sans public ouvert par la
    // collectivité, l'anonymat est un choix — il doit être écrit, pas déduit.
    const iris = fakeIris();
    await submitDemande(
      { ...INPUT, submission: { ...INPUT.submission, requester: null } },
      iris.client,
    );
    expect(iris.calls[0].body.requester).toEqual({ anonymous: true });

    const vide = fakeIris();
    await submitDemande(
      { ...INPUT, submission: { ...INPUT.submission, requester: {} } },
      vide.client,
    );
    expect(vide.calls[0].body.requester).toEqual({ anonymous: true });
  });

  it("tronque un intitulé trop long plutôt que de faire refuser l'enveloppe", async () => {
    const iris = fakeIris();
    await submitDemande({ ...INPUT, demarcheName: "x".repeat(600) }, iris.client);
    expect(String(iris.calls[0].body.subject)).toHaveLength(500);
  });
});

describe("submitDemande — ce qui revient", () => {
  it("rend le même accusé pour un rejeu : la demande existait déjà", async () => {
    const iris = fakeIris({
      kind: "ok",
      body: { created: false, request: { reference: "DEM-2026-000123", status: "en_instruction" } },
    });
    const result = await submitDemande(INPUT, iris.client);
    expect(result).toEqual({
      ok: true,
      receipt: { reference: "DEM-2026-000123", status: "en_instruction", created: false },
    });
  });

  it("traduit chaque échec d'Iris en un échec du portail", async () => {
    const cases = [
      [{ kind: "auth_failed" } as IrisReply, "iris_misconfigured"],
      [{ kind: "rejected", message: "Clés inconnues." } as IrisReply, "submission_rejected"],
      [{ kind: "unreachable" } as IrisReply, "iris_unavailable"],
      [{ kind: "unexpected" } as IrisReply, "iris_unavailable"],
    ] as const;
    for (const [reply, reason] of cases) {
      const result = await submitDemande(INPUT, fakeIris(reply).client);
      expect(result).toEqual({ ok: false, reason });
    }
  });

  it("refuse d'annoncer reçue une demande sans référence à noter", async () => {
    const iris = fakeIris({ kind: "ok", body: { created: true, request: { id: "uuid" } } });
    expect(await submitDemande(INPUT, iris.client)).toEqual({
      ok: false,
      reason: "iris_unavailable",
    });
  });
});
