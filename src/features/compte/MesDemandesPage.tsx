/**
 * « Mes demandes » — `/compte/demandes` (liste) et `/compte/demandes/:id` (détail).
 *
 * Les demandes rattachées à la fiche du compte, quel que soit le canal du
 * dépôt. Tout vient du serveur : l'écran n'a ni règle d'accès ni statut calculé.
 * Sans session de compte (`session_required`) il renvoie à la connexion ; un
 * profil pas encore rempli (`profilRequis`) n'a aucune demande à montrer — on
 * invite à compléter « Mes informations » plutôt que d'afficher une liste vide.
 *
 * Le détail réutilise la vue de `/suivi` (`SuiviView`), sans « Quitter le suivi »
 * (le compte reste ouvert) et avec un retour vers la liste.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type { SuiviDemande } from "@fn/_shared/domain/suivi.ts";
import { suiviFailureKey, suiviFailureRetryable } from "@/features/suivi/failureMessage.ts";
import { formatDate, STATUS_KEYS } from "@/features/suivi/format.ts";
import { SuiviView } from "@/features/suivi/SuiviView.tsx";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import {
  type DemandeResume,
  fetchMaDemande,
  fetchMesDemandes,
  maDemandePieceHref,
} from "@/services/portal/mesDemandesClient.ts";
import { maDemandeKey, takeEarly } from "@/services/portal/earlyFetch.ts";
import type { SuiviClientFailure } from "@/services/portal/suiviClient.ts";
import { AccountFrame, LINK_CLASS, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import { SECONDARY_BUTTON } from "./form.tsx";
import { forgetSessionKind } from "./sessionKind.ts";

const ALERT =
  "rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800";

/** Session perdue : on l'oublie et on renvoie à la connexion (même issue que `/compte`). */
function ToLogin() {
  const { lang } = useLanguage();
  forgetSessionKind();
  return <Navigate to={localizedPath(lang, "/compte/connexion")} replace />;
}

function FailureView({ reason, onRetry }: { reason: SuiviClientFailure; onRetry: () => void }) {
  const t = useT();
  return (
    <>
      <div role="alert" className={ALERT + " mt-6"}>
        {t(suiviFailureKey(reason))}
      </div>
      {suiviFailureRetryable(reason) && (
        <button type="button" onClick={onRetry} className={SECONDARY_BUTTON + " mt-4"}>
          {t("page.retry")}
        </button>
      )}
    </>
  );
}

// ── La liste ─────────────────────────────────────────────────────────────────

type ListState =
  | { status: "loading" }
  | { status: "ready"; demandes: DemandeResume[]; suivante: string | null; profilRequis: boolean }
  | { status: "error"; reason: SuiviClientFailure };

export function MesDemandesPage() {
  return <AccountFrame>{() => <ListScreen />}</AccountFrame>;
}

function ListScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [more, setMore] = useState<{ pending: boolean; failure: SuiviClientFailure | null }>({ pending: false, failure: null });
  // La première demande ajoutée par « Afficher plus » : le focus y va, pour qu'on lise la suite sans repartir du haut.
  const [focusId, setFocusId] = useState<string | null>(null);

  useScreenTitle(t("compte.demandes.link"));

  useEffect(() => {
    let current = true;
    takeEarly("mesDemandes", () => fetchMesDemandes()).then((result) => {
      if (!current) return;
      setState(result.ok ? { status: "ready", ...result.value } : { status: "error", reason: result.reason });
    });
    return () => {
      current = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (focusId !== null) document.getElementById("demande-" + focusId)?.focus();
  }, [focusId]);

  const loadMore = useCallback(async () => {
    if (state.status !== "ready" || state.suivante === null || more.pending) return;
    setMore({ pending: true, failure: null });
    const result = await fetchMesDemandes(state.suivante);
    if (!result.ok) {
      setMore({ pending: false, failure: result.reason });
      return;
    }
    const known = new Set(state.demandes.map((d) => d.id));
    const added = result.value.demandes.filter((d) => !known.has(d.id));
    setState({ ...state, demandes: [...state.demandes, ...added], suivante: result.value.suivante });
    setMore({ pending: false, failure: null });
    setFocusId(added[0]?.id ?? null);
  }, [state, more.pending]);

  if (state.status === "error" && state.reason === "session_required") return <ToLogin />;
  if (more.failure === "session_required") return <ToLogin />;

  const back = (
    <nav className="mb-4">
      <Link to={localizedPath(lang, "/compte")} className={LINK_CLASS}>
        {t("header.account")}
      </Link>
    </nav>
  );

  if (state.status === "loading") {
    return (
      <>
        {back}
        <StepTitle>{t("compte.demandes.link")}</StepTitle>
        <p role="status" className="mt-6 text-[color:var(--pt-muted)]">
          {t("page.loading")}
        </p>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        {back}
        <StepTitle>{t("compte.demandes.link")}</StepTitle>
        <FailureView
          reason={state.reason}
          onRetry={() => {
            setState({ status: "loading" });
            setAttempt((n) => n + 1);
          }}
        />
      </>
    );
  }

  return (
    <>
      {back}
      <StepTitle>{t("compte.demandes.link")}</StepTitle>

      {state.profilRequis ? (
        <div className="mt-6 flex flex-col gap-3">
          <p className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">{t("compte.demandes.profilRequis")}</p>
          <div>
            <Link to={localizedPath(lang, "/compte")} className={LINK_CLASS}>
              {t("compte.demandes.profilLink")}
            </Link>
          </div>
        </div>
      ) : state.demandes.length === 0 ? (
        <p className="mt-6 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.demandes.empty")}</p>
      ) : (
        <>
          <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.demandes.intro")}</p>
          <ul aria-label={t("compte.demandes.listLabel")} className="mt-6 flex flex-col gap-4">
            {state.demandes.map((demande) => (
              <li
                key={demande.id}
                className="flex flex-col gap-2 rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] p-5"
              >
                <Link
                  id={"demande-" + demande.id}
                  to={localizedPath(lang, "/compte/demandes/" + encodeURIComponent(demande.id))}
                  className={LINK_CLASS + " break-all text-[length:var(--pt-h2)]"}
                >
                  {demande.reference}
                </Link>
                <p className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                  {demande.subject || demande.demarcheName || t("suivi.noSubject")}
                </p>
                {demande.subject !== "" && demande.demarcheName !== null && (
                  <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">{demande.demarcheName}</p>
                )}
                <dl className="grid gap-x-6 gap-y-1 text-[length:var(--pt-small)] sm:grid-cols-[max-content_1fr]">
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
              </li>
            ))}
          </ul>

          {more.failure !== null && (
            <div role="alert" className={ALERT + " mt-4"}>
              {t(suiviFailureKey(more.failure))}
            </div>
          )}
          {state.suivante !== null && (
            <div className="mt-6">
              <button type="button" onClick={loadMore} disabled={more.pending} aria-busy={more.pending} className={SECONDARY_BUTTON}>
                {t(more.pending ? "page.loading" : "compte.demandes.more")}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Le détail ────────────────────────────────────────────────────────────────

type DetailState =
  | { status: "loading" }
  | { status: "ready"; demande: SuiviDemande }
  | { status: "error"; reason: SuiviClientFailure };

export function MaDemandePage() {
  return <AccountFrame>{() => <DetailScreen />}</AccountFrame>;
}

function DetailScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const { id = "" } = useParams();
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useScreenTitle(
    state.status === "ready" ? t("suivi.viewTitle", { reference: state.demande.reference }) : t("compte.demandes.link"),
  );

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    takeEarly(maDemandeKey(id), () => fetchMaDemande(id)).then((result) => {
      if (!current) return;
      setState(result.ok ? { status: "ready", demande: result.value } : { status: "error", reason: result.reason });
    });
    return () => {
      current = false;
    };
  }, [id, attempt]);

  if (state.status === "error" && state.reason === "session_required") return <ToLogin />;

  const list = localizedPath(lang, "/compte/demandes");
  const back = (
    <nav className="mb-4">
      <Link to={list} className={LINK_CLASS}>
        {t("compte.demandes.back")}
      </Link>
    </nav>
  );

  if (state.status === "loading") {
    return (
      <>
        {back}
        <StepTitle>{t("compte.demandes.link")}</StepTitle>
        <p role="status" className="mt-6 text-[color:var(--pt-muted)]">
          {t("page.loading")}
        </p>
      </>
    );
  }

  if (state.status === "error") {
    return (
      <>
        {back}
        <StepTitle>{t("compte.demandes.link")}</StepTitle>
        <FailureView reason={state.reason} onRetry={() => setAttempt((n) => n + 1)} />
      </>
    );
  }

  return (
    <SuiviView
      demande={state.demande}
      focusTitle
      back={back}
      pieceHref={(pieceId) => maDemandePieceHref(id, pieceId)}
    />
  );
}
