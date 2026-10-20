/**
 * La vue d'une demande suivie : où elle en est, ce que la collectivité a
 * répondu, et les messages reçus.
 *
 * ⚠️ Tout ce qui vient du serveur est du TEXTE : le corps d'un message est
 * rendu en nœud texte, avec `whitespace-pre-line` pour garder les retours à la
 * ligne. Jamais `dangerouslySetInnerHTML` — ce texte est écrit par un agent,
 * mais il traverse un système tiers, et la page porte une session.
 *
 * Titres : un seul `h1` (la demande), des `h2` par bloc, un `h3` par message.
 */
import { type ReactNode, useEffect, useRef } from "react";
import type { SuiviDemande, SuiviPiece } from "@fn/_shared/domain/suivi.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { suiviPieceHref } from "@/services/portal/suiviClient.ts";
import { formatDate, formatDateTime, formatSize, STATUS_KEYS } from "./format.ts";

const H2 = "text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]";

function PieceList({
  pieces,
  label,
  pieceHref,
}: {
  pieces: SuiviPiece[];
  label?: string;
  pieceHref: (pieceId: string) => string;
}) {
  const { lang } = useLanguage();
  if (pieces.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-col gap-1.5">
      {pieces.map((piece) => {
        const size = formatSize(piece.size, lang);
        return (
          <li key={piece.id} className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            {/* Redirection vers une URL signée de 60 s : le cookie part tout seul. */}
            <a
              href={pieceHref(piece.id)}
              className="font-semibold text-[color:var(--brand-primary)] underline hover:no-underline"
            >
              {piece.fileName}
            </a>
            {size !== null && <span className="ml-2 text-[color:var(--pt-muted)]">({size})</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function SuiviView({
  demande,
  focusTitle,
  onQuit,
  pieceHref = suiviPieceHref,
  back,
}: {
  demande: SuiviDemande;
  /** Vient d'ouvrir l'accès : le focus va au titre, pour que le changement d'écran s'annonce. */
  focusTitle: boolean;
  /** « Quitter le suivi » : absent quand la vue sert « Mes demandes » (le compte, lui, reste ouvert). */
  onQuit?: () => void;
  /** Le lien d'une pièce ; par défaut celui de la session invitée du suivi. */
  pieceHref?: (pieceId: string) => string;
  /** Un retour (ex. « Mes demandes »), rendu au-dessus du titre. */
  back?: ReactNode;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);

  // Du plus ancien au plus récent : une conversation se lit dans l'ordre.
  const messages = [...demande.messages].sort(
    (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
  );

  return (
    <div className="flex flex-col gap-8">
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1
          ref={titleRef}
          tabIndex={-1}
          className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)] focus:outline-none"
        >
          {t("suivi.viewTitle", { reference: demande.reference })}
        </h1>
        {onQuit && (
          <button
            type="button"
            onClick={onQuit}
            className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] font-semibold hover:bg-[color:var(--pt-surface)]"
          >
            {t("suivi.quit")}
          </button>
        )}
      </div>

      <section aria-labelledby="suivi-demande" className="flex flex-col gap-4">
        <h2 id="suivi-demande" className={H2}>
          {t("suivi.summary")}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-[length:var(--pt-body)] sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold text-[color:var(--pt-muted)]">{t("suivi.field.reference")}</dt>
          <dd className="font-bold text-[color:var(--pt-ink)]">{demande.reference}</dd>
          <dt className="font-semibold text-[color:var(--pt-muted)]">{t("suivi.field.subject")}</dt>
          <dd className="text-[color:var(--pt-ink)]">{demande.subject || t("suivi.noSubject")}</dd>
          {demande.demarcheName !== null && (
            <>
              <dt className="font-semibold text-[color:var(--pt-muted)]">{t("suivi.field.demarche")}</dt>
              <dd className="text-[color:var(--pt-ink)]">{demande.demarcheName}</dd>
            </>
          )}
          <dt className="font-semibold text-[color:var(--pt-muted)]">{t("suivi.field.status")}</dt>
          <dd className="font-bold text-[color:var(--pt-ink)]">{t(STATUS_KEYS[demande.status])}</dd>
          <dt className="font-semibold text-[color:var(--pt-muted)]">{t("suivi.field.receivedAt")}</dt>
          <dd className="text-[color:var(--pt-ink)]">
            <time dateTime={demande.receivedAt}>{formatDate(demande.receivedAt, lang)}</time>
          </dd>
          <dt className="font-semibold text-[color:var(--pt-muted)]">{t("suivi.field.updatedAt")}</dt>
          <dd className="text-[color:var(--pt-ink)]">
            <time dateTime={demande.updatedAt}>{formatDate(demande.updatedAt, lang)}</time>
          </dd>
        </dl>

        {demande.status === "en_attente" && (
          // Répondre en ligne n'existe pas encore : on renvoie au message, sans promettre mieux.
          <p className="rounded-[var(--pt-radius-sm)] border border-[color:var(--brand-primary)] px-4 py-3 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            {t("suivi.waiting")}
          </p>
        )}
      </section>

      {demande.closureText !== null && demande.closureText.trim() !== "" && (
        <section aria-labelledby="suivi-cloture" className="flex flex-col gap-3">
          <h2 id="suivi-cloture" className={H2}>
            {t("suivi.closure")}
          </h2>
          <p className="whitespace-pre-line text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            {demande.closureText}
          </p>
        </section>
      )}

      {demande.pieces.length > 0 && (
        <section aria-labelledby="suivi-pieces" className="flex flex-col gap-3">
          <h2 id="suivi-pieces" className={H2}>
            {t("suivi.pieces")}
          </h2>
          <PieceList pieces={demande.pieces} pieceHref={pieceHref} />
        </section>
      )}

      <section aria-labelledby="suivi-messages" className="flex flex-col gap-4">
        <h2 id="suivi-messages" className={H2}>
          {t("suivi.messages")}
        </h2>
        {messages.length === 0 ? (
          <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("suivi.noMessages")}</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className="flex flex-col gap-2 rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] p-5"
              >
                <h3 className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
                  {message.subject || t("suivi.noSubject")}
                </h3>
                <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                  <time dateTime={message.sentAt}>{formatDateTime(message.sentAt, lang)}</time>
                </p>
                <p className="whitespace-pre-line text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                  {message.body}
                </p>
                <PieceList pieces={message.pieces} label={t("suivi.messagePieces")} pieceHref={pieceHref} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
