/**
 * Dépôt d'une pièce justificative dans Iris — AVANT la demande.
 *
 * Contrat d'ingestion 2.0.0 : les fichiers se DÉPOSENT (`POST /v1/uploads`,
 * multipart) et la demande les RÉFÉRENCE ensuite par `upload_id`. Iris
 * vérifie lui-même le contenu réel (signature binaire contre une liste fermée
 * de formats), l'extension et la taille, calcule l'empreinte, et garde le
 * fichier vingt-quatre heures en attente d'une demande. Le portail ne stocke
 * donc RIEN : il relaie les octets et retient un identifiant.
 *
 * Ce module traduit la réponse d'Iris en ce que l'écran sait dire à l'usager
 * — « trop gros », « format refusé » — ou au journal.
 */
import type { IrisClient } from "./irisClient.ts";

export type PieceFailure =
  /** Au-delà de la taille qu'Iris accepte. */
  | "piece_too_large"
  /** Format hors de la liste fermée, ou extension incohérente avec le contenu. */
  | "piece_unsupported"
  /** Refusé pour une autre raison (nom de fichier, enveloppe) — au journal. */
  | "piece_rejected"
  /** Le quota de dépôts de la clé du portail est atteint : réessayer plus tard. */
  | "too_many_uploads"
  /** Iris injoignable ou réponse illisible. */
  | "iris_unavailable"
  /** La clé du portail est refusée par Iris. */
  | "iris_misconfigured";

export interface PieceReceipt {
  uploadId: string;
  fileName: string;
  /** Type DÉTECTÉ par Iris, pas celui annoncé par le navigateur. */
  mimeType: string;
  sizeBytes: number;
}

export type PieceResult =
  | { ok: true; piece: PieceReceipt }
  | { ok: false; reason: PieceFailure };

export function httpStatusForPieceFailure(reason: PieceFailure): number {
  switch (reason) {
    case "piece_too_large": return 413;
    case "piece_unsupported": return 415;
    case "piece_rejected": return 422;
    case "too_many_uploads": return 429;
    case "iris_unavailable":
    case "iris_misconfigured": return 502;
  }
}

/** Le reçu d'Iris ; sans identifiant, ce n'en est pas un. */
export function toPieceReceipt(body: unknown): PieceReceipt | null {
  if (typeof body !== "object" || body === null) return null;
  const upload = (body as Record<string, unknown>).upload;
  if (typeof upload !== "object" || upload === null) return null;
  const row = upload as Record<string, unknown>;
  const uploadId = typeof row.upload_id === "string" ? row.upload_id.trim() : "";
  if (uploadId === "") return null;
  return {
    uploadId,
    fileName: typeof row.file_name === "string" ? row.file_name : "",
    mimeType: typeof row.mime_type === "string" ? row.mime_type : "",
    sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : 0,
  };
}

export async function uploadPiece(
  input: { file: Blob; fileName: string },
  iris: IrisClient,
): Promise<PieceResult> {
  const reply = await iris.postMultipart("/v1/uploads", input.file, input.fileName);
  switch (reply.kind) {
    case "auth_failed":
      return { ok: false, reason: "iris_misconfigured" };
    case "rejected":
      if (reply.status === 413) return { ok: false, reason: "piece_too_large" };
      if (reply.status === 415 || reply.status === 422) return { ok: false, reason: "piece_unsupported" };
      if (reply.status === 429) return { ok: false, reason: "too_many_uploads" };
      console.error("portal-api : pièce refusée par Iris —", reply.message ?? "sans message");
      return { ok: false, reason: "piece_rejected" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "iris_unavailable" };
  }
  const piece = toPieceReceipt(reply.body);
  if (piece === null) {
    console.error("portal-api : réponse d'Iris sans identifiant de pièce.");
    return { ok: false, reason: "iris_unavailable" };
  }
  return { ok: true, piece };
}
