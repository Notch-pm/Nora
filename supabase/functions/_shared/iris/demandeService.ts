/**
 * Dépôt d'une demande dans Iris.
 *
 * Le portail ne traite pas les demandes : il les remet au système qui les
 * instruit. Iris n'a **aucune logique propre à un émetteur** — un portail
 * citoyen y est une *source enregistrée*, au même titre qu'un connecteur
 * courrier. Ce fichier est le seul du portail à connaître la forme de son
 * enveloppe d'ingestion ; il traduit depuis `domain/demande`.
 *
 * Trois garanties tenues ici, et nulle part ailleurs :
 *
 *  1. **La collectivité vient du serveur.** `socle_root_organization_id` est le
 *     tenant résolu depuis l'`Origin`, jamais une valeur envoyée par le
 *     navigateur. Iris le revérifie d'ailleurs contre le périmètre de la clé.
 *  2. **La démarche a été revérifiée publiée** par l'appelant avant l'envoi.
 *     Sans cela, le portail deviendrait un moyen de déposer sur une démarche
 *     en brouillon ou fermée.
 *  3. **Le rejeu est inoffensif.** `external_id` et `idempotency_key` portent
 *     le même identifiant, tiré une fois par le navigateur : Iris rend alors
 *     la demande existante (200, `created: false`) au lieu d'en créer une
 *     seconde. Le double-clic et le renvoi après coupure sont couverts par le
 *     contrat, pas par un verrou côté portail.
 *
 * Les clés de l'identité déclarée sont celles du paramétrage du Socle
 * (`courriel`, `nom_usuel`, `siret`…) : Iris les lit telles quelles pour
 * rapprocher l'usager du référentiel, ou créer sa fiche. Le portail n'a donc
 * aucune table de correspondance — en écrire une créerait une troisième
 * vérité, qui divergerait au premier champ ajouté.
 */
import type { DemandeReceipt, DemandeSubmission } from "../domain/demande.ts";
import type { PortalFailure } from "../domain/failure.ts";
import type { IrisClient } from "./irisClient.ts";

export type DemandeResult =
  | { ok: true; receipt: DemandeReceipt }
  | { ok: false; reason: PortalFailure };

/** Longueur maximale d'un `subject` chez Iris. */
const SUBJECT_MAX = 500;

export interface SubmitDemandeInput {
  /** Le code de la source enregistrée chez Iris (ex. `portail-citoyen`). */
  sourceSystem: string;
  /** La collectivité, résolue côté serveur depuis le domaine visité. */
  tenantId: string;
  /** L'intitulé de la démarche — ce qu'un agent lira comme objet. */
  demarcheName: string;
  submission: DemandeSubmission;
}

/**
 * L'accusé, lu dans la réponse d'Iris. Une réponse sans référence n'en est pas
 * un : mieux vaut le dire que d'afficher une demande sans numéro, que l'usager
 * ne pourrait jamais retrouver.
 */
function toReceipt(body: unknown): DemandeReceipt | null {
  if (typeof body !== "object" || body === null) return null;
  const envelope = body as Record<string, unknown>;
  const request = envelope.request;
  if (typeof request !== "object" || request === null) return null;
  const row = request as Record<string, unknown>;
  const reference = typeof row.reference === "string" ? row.reference.trim() : "";
  if (reference === "") return null;
  return {
    reference,
    status: typeof row.status === "string" ? row.status : "a_traiter",
    // Absent = créée : c'est le cas nominal du 201, où Iris ne le répète pas.
    created: envelope.created !== false,
  };
}

export async function submitDemande(
  input: SubmitDemandeInput,
  iris: IrisClient,
): Promise<DemandeResult> {
  const { submission } = input;

  const envelope: Record<string, unknown> = {
    source_system: input.sourceSystem,
    external_id: submission.submissionId,
    idempotency_key: submission.submissionId,
    socle_root_organization_id: input.tenantId,
    socle_procedure_id: submission.demarcheId,
    subject: input.demarcheName.slice(0, SUBJECT_MAX),
    // Une identité vide n'est pas acceptée par Iris, et c'est justement le
    // point : l'anonymat doit être DIT, pas déduit d'un oubli. Le portail le
    // dit quand la collectivité n'a ouvert aucun public de requérant.
    requester:
      submission.requester === null || Object.keys(submission.requester).length === 0
        ? { anonymous: true }
        : submission.requester,
    form_data: submission.formData,
    context: { channel: "portail" },
  };
  // La whitelist d'Iris refuse toute clé inconnue : on n'envoie une
  // organisation destinataire que si l'usager en a choisi une.
  if (submission.organizationId !== null) {
    envelope.socle_organization_id = submission.organizationId;
  }

  const reply = await iris.post("/v1/requests", envelope);
  switch (reply.kind) {
    case "auth_failed":
      return { ok: false, reason: "iris_misconfigured" };
    case "rejected":
      // Le détail va au journal, pas à l'usager : il désigne une erreur de
      // paramétrage ou de contrat, sur laquelle il ne peut rien.
      console.error("portal-api : dépôt refusé par Iris —", reply.message ?? "sans message");
      return { ok: false, reason: "submission_rejected" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "iris_unavailable" };
  }

  const receipt = toReceipt(reply.body);
  if (receipt === null) {
    console.error("portal-api : réponse d'Iris sans référence de demande.");
    return { ok: false, reason: "iris_unavailable" };
  }
  return { ok: true, receipt };
}
