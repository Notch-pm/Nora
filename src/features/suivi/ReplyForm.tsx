/**
 * « Répondre » — l'usager écrit à la collectivité depuis sa demande (L4b),
 * qu'il la suive avec un code d'accès ou depuis son compte.
 *
 * Les pièces partent d'abord, une à une, par le même chemin qu'au dépôt
 * (`/v1/demandes/pieces` → zone d'attente d'Iris, 24 h) ; le message ne porte
 * ensuite que leurs identifiants. Iris rattache tout en une fois, et revérifie
 * que la demande est bien celle du lecteur.
 *
 * Accessibilité : un vrai `<form>`, une étiquette par champ, l'erreur reliée
 * au champ et annoncée (`role="alert"`), le succès annoncé (`role="status"`).
 */
import { useRef, useState } from "react";
import { SUIVI_MESSAGE_MAX_CHARS, SUIVI_MESSAGE_MAX_PIECES, type SuiviReply } from "@fn/_shared/domain/suivi.ts";
import type { PieceReceipt } from "@fn/_shared/iris/pieceService.ts";
import { PIECE_FAILURE_KEYS } from "@/features/demarche/FormFields.tsx";
import { inputClass, invalidClass } from "@/features/demarche/RequesterSection.tsx";
import { useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import { uploadPiece } from "@/services/portal/portalClient.ts";
import type { SuiviClientFailure } from "@/services/portal/suiviClient.ts";
import { suiviFailureKey } from "./failureMessage.ts";

/** Les formats acceptés en réponse (choix PO, L4) — Iris revérifie le contenu réel. */
const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

export function ReplyForm({ onSend }: { onSend: (reply: SuiviReply) => Promise<SuiviClientFailure | null> }) {
  const t = useT();
  const [texte, setTexte] = useState("");
  const [pieces, setPieces] = useState<PieceReceipt[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setSent(false);
    setUploading(true);
    for (const file of Array.from(files)) {
      if (pieces.length >= SUIVI_MESSAGE_MAX_PIECES) {
        setError("suivi.reply.tooManyPieces");
        break;
      }
      const uploaded = await uploadPiece(file);
      if (!uploaded.ok) {
        setError(PIECE_FAILURE_KEYS[uploaded.reason]);
        break;
      }
      setPieces((previous) => [...previous, uploaded.piece].slice(0, SUIVI_MESSAGE_MAX_PIECES));
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || uploading) return;
    setSent(false);
    if (texte.trim() === "") {
      setError("suivi.reply.required");
      textRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    const failure = await onSend({ texte: texte.trim(), pieces: pieces.map((p) => p.uploadId) });
    setSending(false);
    if (failure !== null) {
      setError(suiviFailureKey(failure));
      return;
    }
    setTexte("");
    setPieces([]);
    setSent(true);
  };

  const errorId = "reponse-erreur";
  return (
    <section aria-labelledby="suivi-repondre" className="flex flex-col gap-3">
      <h2 id="suivi-repondre" className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">
        {t("suivi.reply.title")}
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="reponse-texte" className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
            {t("suivi.reply.label")}
          </label>
          <textarea
            ref={textRef}
            id="reponse-texte"
            rows={5}
            maxLength={SUIVI_MESSAGE_MAX_CHARS}
            value={texte}
            onChange={(event) => {
              setTexte(event.target.value);
              if (error === "suivi.reply.required") setError(null);
            }}
            className={inputClass + (error === "suivi.reply.required" ? " " + invalidClass : "")}
            aria-invalid={error === "suivi.reply.required"}
            aria-describedby={error !== null ? errorId : "reponse-aide"}
          />
          <p id="reponse-aide" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
            {t("suivi.reply.help", { max: SUIVI_MESSAGE_MAX_CHARS })}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="reponse-pieces" className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
            {t("suivi.reply.pieces", { max: SUIVI_MESSAGE_MAX_PIECES })}
          </label>
          <input
            ref={fileRef}
            id="reponse-pieces"
            type="file"
            multiple
            accept={ACCEPT}
            disabled={uploading || pieces.length >= SUIVI_MESSAGE_MAX_PIECES}
            onChange={(event) => void addFiles(event.target.files)}
            className="text-[length:var(--pt-body)]"
          />
          {uploading && (
            <p role="status" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
              {t("suivi.reply.uploading")}
            </p>
          )}
          {pieces.length > 0 && (
            <ul aria-label={t("suivi.reply.attached")} className="flex flex-col gap-1">
              {pieces.map((piece) => (
                <li key={piece.uploadId} className="flex items-center gap-3 text-[length:var(--pt-body)]">
                  <span>{piece.fileName}</span>
                  <button
                    type="button"
                    onClick={() => setPieces((previous) => previous.filter((p) => p.uploadId !== piece.uploadId))}
                    className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] underline"
                  >
                    {t("suivi.reply.remove", { name: piece.fileName })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error !== null && (
          <p id={errorId} role="alert" className="text-[length:var(--pt-body)] text-red-700">
            {t(error)}
          </p>
        )}
        {sent && (
          <p role="status" className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            {t("suivi.reply.sent")}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={sending || uploading}
            className="rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90 disabled:opacity-60"
          >
            {t(sending ? "suivi.reply.sending" : "suivi.reply.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}
