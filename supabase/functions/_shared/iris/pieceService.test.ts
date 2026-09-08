import { describe, expect, it } from "vitest";
import { httpStatusForPieceFailure, toPieceReceipt, uploadPiece } from "./pieceService.ts";
import type { IrisClient, IrisReply } from "./irisClient.ts";

const RECEIVED = {
  upload: {
    upload_id: "33333333-3333-4333-8333-333333333333",
    file_name: "cni.pdf",
    mime_type: "application/pdf",
    size_bytes: 1234,
    checksum: "abc",
    expires_at: "2026-09-09T10:00:00Z",
  },
};

function fakeIris(reply: IrisReply) {
  const calls: { path: string; fileName: string; size: number }[] = [];
  const client: IrisClient = {
    post: () => Promise.reject(new Error("pas ici")),
    postMultipart(path, file, fileName) {
      calls.push({ path, fileName, size: file.size });
      return Promise.resolve(reply);
    },
  };
  return { client, calls };
}

const FILE = new Blob(["%PDF-1.7"], { type: "application/pdf" });

describe("uploadPiece", () => {
  it("dépose sur /v1/uploads avec le nom d'origine et rend le reçu", async () => {
    const iris = fakeIris({ kind: "ok", body: RECEIVED });
    const result = await uploadPiece({ file: FILE, fileName: "cni.pdf" }, iris.client);
    expect(result).toEqual({
      ok: true,
      piece: { uploadId: "33333333-3333-4333-8333-333333333333", fileName: "cni.pdf", mimeType: "application/pdf", sizeBytes: 1234 },
    });
    expect(iris.calls).toEqual([{ path: "/v1/uploads", fileName: "cni.pdf", size: 8 }]);
  });

  it("traduit chaque refus d'Iris en ce que l'écran sait dire", async () => {
    const cases: [number, string][] = [
      [413, "piece_too_large"],
      [415, "piece_unsupported"],
      [422, "piece_unsupported"],
      [429, "too_many_uploads"],
      [400, "piece_rejected"],
    ];
    for (const [status, reason] of cases) {
      const iris = fakeIris({ kind: "rejected", status, message: "x" });
      expect(await uploadPiece({ file: FILE, fileName: "a.pdf" }, iris.client)).toEqual({ ok: false, reason });
    }
    expect(await uploadPiece({ file: FILE, fileName: "a.pdf" }, fakeIris({ kind: "auth_failed" }).client))
      .toEqual({ ok: false, reason: "iris_misconfigured" });
    expect(await uploadPiece({ file: FILE, fileName: "a.pdf" }, fakeIris({ kind: "unreachable" }).client))
      .toEqual({ ok: false, reason: "iris_unavailable" });
  });

  it("une réponse sans identifiant n'est pas un reçu", async () => {
    expect(toPieceReceipt({ upload: { file_name: "x" } })).toBeNull();
    expect(toPieceReceipt(null)).toBeNull();
    const iris = fakeIris({ kind: "ok", body: { upload: {} } });
    expect(await uploadPiece({ file: FILE, fileName: "a.pdf" }, iris.client)).toEqual({ ok: false, reason: "iris_unavailable" });
  });

  it("porte un statut HTTP par refus", () => {
    expect(httpStatusForPieceFailure("piece_too_large")).toBe(413);
    expect(httpStatusForPieceFailure("piece_unsupported")).toBe(415);
    expect(httpStatusForPieceFailure("too_many_uploads")).toBe(429);
    expect(httpStatusForPieceFailure("iris_unavailable")).toBe(502);
  });
});
