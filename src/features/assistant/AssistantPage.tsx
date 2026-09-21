/**
 * La page de l'assistant conversationnel — `/assistant`.
 *
 * Réutilise le cadre des autres écrans (`DemarcheShell`, `usePortal`) : même
 * charte, même en-tête, même façon de résoudre la langue servie. Ce composant
 * N'AFFICHE QUE — toute règle (validation, fil, tours, persistance) vit dans
 * `conversation.ts` (pur, testé) et `useAssistantConversation.ts` (orchestre).
 *
 * ⚠️ **Fermé au doute** : `tenant.assistant.enabled` gouverne tout — faux, et
 * la page ne fait AUCUNE requête vers `/v1/assistant*` (voir `domain/assistant.ts`
 * côté fonctions : un Socle d'avant ce contrat, ou une réponse abîmée, ferme).
 *
 * ⚠️ **Pas de bulle flottante** : le fil est en flux normal de page, sans
 * cadre à hauteur fixe ni défilement interne — un zoom à 200 % (RGAA 10.4)
 * doit pouvoir agrandir tout le contenu sans le couper.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { viewOf } from "@fn/_shared/ai/collection.ts";
import { MAX_USER_MESSAGE_CHARS } from "@fn/_shared/domain/assistantTurn.ts";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "@/features/demarche/DemarcheShell.tsx";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { Markdown } from "@/features/portal/Markdown.tsx";
import { usePortal } from "@/features/portal/usePortal.ts";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { localizedPath, servedLanguage, splitScopedPath } from "@/i18n/localizedPath.ts";
import { assistantTitle, errorPageTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import { BUTTON_CLASS, CARD_CLASS, LINK_CLASS } from "./cardStyles.ts";
import {
  ClassicFormLink,
  IdentityCard,
  OrganizationCard,
  PendingFieldCard,
  ReceiptNoteView,
  RecapCard,
  StartedNoteView,
} from "./CollectCards.tsx";
import { mergeTimeline } from "./collect.ts";
import { assistantErrorMessage } from "./errorMessages.ts";
import type { AssistantMessageView } from "./conversation.ts";
import { useAssistantCollect } from "./useAssistantCollect.ts";
import { useAssistantConversation } from "./useAssistantConversation.ts";

/** La mention permanente : obligation de transparence, jamais reléguée au premier message. */
function AssistantNotice() {
  const t = useT();
  const items: Array<"automated" | "sources" | "noPersonalData" | "notStored" | "provider"> = [
    "automated",
    "sources",
    "noPersonalData",
    "notStored",
    "provider",
  ];
  return (
    <div
      className="rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] p-4"
      style={{ background: "var(--pt-surface)" }}
    >
      <p className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
        {t("assistant.notice.lead")}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {items.map((key) => (
          <li key={key} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{t(`assistant.notice.${key}` as const)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Numéros d'urgence — affichée dès qu'un danger est repéré, navigateur ou serveur. */
function EmergencyCard() {
  const t = useT();
  const numbers: Array<"112" | "15" | "17" | "18"> = ["112", "15", "17", "18"];
  return (
    <div role="alert" className="rounded-[var(--pt-radius)] border-2 border-red-600 bg-red-50 p-4">
      <p className="text-[length:var(--pt-body)] font-bold text-red-800">{t("assistant.emergency.title")}</p>
      <p className="mt-1 text-[length:var(--pt-body)] text-red-800">{t("assistant.emergency.detail")}</p>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
        {numbers.map((n) => (
          <li key={n}>
            <a href={`tel:${n}`} className="font-bold text-red-800 underline underline-offset-2">
              {t(`assistant.emergency.${n}` as const)}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Une bulle du fil — texte brut pour l'usager, Markdown pour l'assistant (jamais `innerHTML`). */
function MessageBubble({
  message,
  lang,
  demarches,
  depositEnabled,
  collectBusy,
  onStartCollect,
}: {
  message: AssistantMessageView;
  lang: string;
  demarches: Demarche[];
  /** La collectivité a ouvert le recueil dans la conversation (lot 2). */
  depositEnabled: boolean;
  /** Un recueil est déjà en cours, ou en cours de chargement : le bouton se désactive. */
  collectBusy: boolean;
  onStartCollect: (demarcheId: string) => void;
}) {
  const t = useT();
  const isUser = message.role === "user";
  return (
    <div className={"flex " + (isUser ? "justify-end" : "justify-start")}>
      <div className="flex max-w-[85%] flex-col gap-2 sm:max-w-[70%]">
        <div
          className={
            "rounded-[var(--pt-radius)] px-4 py-3 text-[length:var(--pt-body)] " +
            (isUser
              ? "bg-[color:var(--pt-primary-soft)] text-[color:var(--pt-ink)]"
              : "border border-[color:var(--pt-border)] bg-white text-[color:var(--pt-ink)]")
          }
        >
          <span className="sr-only">{t(isUser ? "assistant.you" : "assistant.assistantName")}</span>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <Markdown source={message.content} />
          )}
        </div>
        {message.suggestions !== undefined && message.suggestions.length > 0 && (
          <ul aria-label={t("assistant.suggestions.groupLabel")} className="flex flex-col gap-2">
            {message.suggestions.map((suggestion) => {
              // Revalidé contre le catalogue publié : un identifiant que le
              // modèle aurait inventé (ou déjà retiré du catalogue depuis) ne
              // doit pas produire un lien mort.
              const known = demarches.some((d) => d.id === suggestion.id);
              if (!known) return null;
              return (
                <li key={suggestion.id} className="flex flex-col items-start gap-2">
                  <Link
                    to={localizedPath(lang, "/demarches/" + encodeURIComponent(suggestion.id))}
                    className="block w-full rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-4 py-3 hover:border-[color:var(--brand-primary)]"
                  >
                    <span className="block text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
                      {suggestion.name}
                    </span>
                    {suggestion.description !== null && (
                      <span className="mt-0.5 block text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                        {suggestion.description}
                      </span>
                    )}
                  </Link>
                  {depositEnabled && (
                    <button
                      type="button"
                      disabled={collectBusy}
                      onClick={() => onStartCollect(suggestion.id)}
                      className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-3 py-1.5 text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-ink)] hover:border-[color:var(--brand-primary)] hover:text-[color:var(--brand-primary)] disabled:opacity-60"
                    >
                      {t("assistant.collect.start")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function AssistantConversation({
  demarches,
  lang,
  focusDemarcheId,
  depositEnabled,
}: {
  demarches: Demarche[];
  lang: string;
  focusDemarcheId: string | null;
  /** La collectivité a ouvert le recueil dans la conversation (lot 2). */
  depositEnabled: boolean;
}) {
  const t = useT();
  const tn = useTn();
  const {
    state,
    stillWaiting,
    problem,
    clearProblem,
    textareaRef,
    newConversationButtonRef,
    sendMessage,
    retry,
    newConversation,
    collectionReply,
  } = useAssistantConversation(focusDemarcheId, lang);
  const collect = useAssistantCollect({ lang, depositEnabled, collectionReply });
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const hintId = useId();
  const counterId = useId();
  const problemId = useId();
  // Le premier contrôle de la carte active reçoit le focus À SON APPARITION
  // (fiche de mission, RGAA 10.7) — jamais la zone de saisie. La « signature »
  // ne change QUE quand la carte affichée change réellement (nouveau champ,
  // nouvelle étape) : répondre deux fois de suite au MÊME champ « conversation »
  // (le modèle n'a rien retenu) ne doit pas arracher le focus du clavier.
  const cardRef = useRef<HTMLDivElement>(null);
  const activePendingFieldId =
    collect.session !== null && collect.step === "fields"
      ? (viewOf(collect.session.demarche.form, collect.session.collection).pending?.id ?? null)
      : null;
  const cardSignature =
    collect.session === null ? "" : collect.session.demarche.id + ":" + collect.step + ":" + (activePendingFieldId ?? "");
  useEffect(() => {
    if (cardSignature === "") return;
    const focusable = cardRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [cardSignature]);

  function submit(event?: { preventDefault(): void }) {
    event?.preventDefault();
    if (sendMessage(draft, collect.turnCollectionPayload)) setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Une touche Entrée qui valide une composition (IME — chinois, entre
    // autres langues couvertes ici) ne doit pas envoyer le message en cours
    // de saisie.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  }

  function startCollect(demarcheId: string): void {
    void collect.start(demarcheId, state.messages.length);
  }

  function endConversation(): void {
    newConversation();
    collect.reset();
  }

  const describedBy = [
    hintId,
    counterId,
    problem !== null ? problemId : null,
  ]
    .filter((id) => id !== null)
    .join(" ");

  // Le focus des démarches suggérées vient du serveur ; celle « dont on vient »
  // n'est offerte en repli que si elle existe bien au catalogue publié — sinon
  // ce serait un lien vers une page qui ne s'ouvrira pas.
  const focusDemarche =
    focusDemarcheId === null ? null : demarches.find((d) => d.id === focusDemarcheId) ?? null;

  const timeline = mergeTimeline(state.messages, collect.notes);
  const collectBusy = collect.loading || collect.session !== null;

  return (
    <>
      <nav className="mb-6">
        <Link to={localizedPath(lang, "/")} className={LINK_CLASS}>
          {t("assistant.allDemarches")}
        </Link>
      </nav>

      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
        {t("assistant.title")}
      </h1>
      <p className="mt-2 max-w-[62ch] text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
        {t("assistant.lead")}
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <AssistantNotice />

        {state.emergency && <EmergencyCard />}

        {state.reopened && (
          <p className={CARD_CLASS + " text-[length:var(--pt-small)] text-[color:var(--pt-muted)]"}>
            {t("assistant.reopened")}
          </p>
        )}

        <div
          role="log"
          aria-live="polite"
          aria-label={t("assistant.log.label")}
          aria-busy={state.status === "sending"}
          className="flex flex-col gap-3"
        >
          {timeline.length === 0 ? (
            <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("assistant.empty")}</p>
          ) : (
            timeline.map((entry) =>
              entry.kind === "message" ? (
                <MessageBubble
                  key={entry.message.id}
                  message={entry.message}
                  lang={lang}
                  demarches={demarches}
                  depositEnabled={depositEnabled}
                  collectBusy={collectBusy}
                  onStartCollect={startCollect}
                />
              ) : entry.note.kind === "started" ? (
                <StartedNoteView key={entry.note.id} note={entry.note} />
              ) : (
                <ReceiptNoteView
                  key={entry.note.id}
                  receipt={entry.note.receipt}
                  demarcheName={entry.note.demarcheName}
                />
              ),
            )
          )}
        </div>

        {/* Région d'état SÉPARÉE du fil : c'est elle qui annonce l'attente,
            jamais le fil lui-même (RGAA 4.1 — un seul message à la fois). */}
        <p role="status" aria-live="polite" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {state.status === "sending" ? t(stillWaiting ? "assistant.status.stillWaiting" : "assistant.status.waiting") : ""}
        </p>

        {collect.loading && (
          <p role="status" aria-live="polite" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
            {t("assistant.collect.loading")}
          </p>
        )}

        {collect.loadError !== null && (
          <div role="alert" className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3">
            <p className="text-[length:var(--pt-body)] text-red-800">
              {t(collect.loadError === "no_form" ? "assistant.collect.noForm" : "assistant.collect.loadFailed")}
            </p>
          </div>
        )}

        {collect.purgedCount !== null && (
          <p role="status" aria-live="polite" className="text-[length:var(--pt-body)] text-amber-800">
            {tn("assistant.collect.purgeNotice", collect.purgedCount)}
          </p>
        )}

        {collect.session !== null && (
          <div ref={cardRef} className="flex flex-col gap-3">
            {collect.step === "fields" && (
              <PendingFieldCard session={collect.session} onAnswer={collect.answerField} onSkip={collect.skipField} />
            )}
            {collect.step === "organization" && (
              <OrganizationCard
                session={collect.session}
                onChoose={collect.chooseOrganization}
                onConfirm={() => {
                  if (collect.session === null || collect.session.organizationId === null) return false;
                  collect.confirmOrganization();
                  return true;
                }}
              />
            )}
            {collect.step === "identity" && (
              <IdentityCard
                session={collect.session}
                requesterErrors={collect.requesterErrors}
                onAudienceChange={collect.setAudience}
                onFieldChange={collect.setRequesterValue}
                onConfirm={collect.confirmIdentity}
              />
            )}
            {collect.step === "recap" && (
              <RecapCard
                session={collect.session}
                submitting={collect.submitting}
                submitFailureMessage={
                  collect.submitFailure !== null ? errorMessageFor(collect.submitFailure, lang) : null
                }
                onModifyField={collect.reopenField}
                onModifyOrganization={collect.reopenOrganization}
                onModifyIdentity={collect.reopenIdentity}
                onSubmit={() => void collect.submit(state.messages.length)}
              />
            )}
            <ClassicFormLink session={collect.session} />
          </div>
        )}

        {/* ⚠️ Pas quand `status === "ended"` : la carte juste en dessous porte
            déjà le même message (« conversation_ended »), avec le bon geste
            (« Nouvelle conversation ») — un doublon dirait deux fois la même
            chose, sans bouton utile ici. */}
        {state.failure !== null && state.status !== "ended" && (
          <div role="alert" className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3">
            <p className="font-semibold text-red-800">{assistantErrorMessage(state.failure, lang).title}</p>
            <p className="mt-1 text-[length:var(--pt-body)] text-red-800">
              {assistantErrorMessage(state.failure, lang).detail}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {/* Un échec pendant un recueil propose D'ABORD le repli garanti. */}
              {collect.session !== null && <ClassicFormLink session={collect.session} />}
              {assistantErrorMessage(state.failure, lang).retryable && (
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-white px-4 py-2 text-[length:var(--pt-body)] font-semibold text-red-800 hover:bg-red-100"
                >
                  {t("page.retry")}
                </button>
              )}
            </div>
          </div>
        )}

        {state.status === "ended" ? (
          <div className={CARD_CLASS}>
            <p className="font-semibold text-[color:var(--pt-ink)]">
              {assistantErrorMessage({ reason: "conversation_ended" }, lang).title}
            </p>
            <p className="mt-1 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
              {assistantErrorMessage({ reason: "conversation_ended" }, lang).detail}
            </p>
            <button
              ref={newConversationButtonRef}
              type="button"
              onClick={endConversation}
              className={BUTTON_CLASS + " mt-3"}
            >
              {t("assistant.newConversation")}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
              {t("assistant.form.label")}
            </label>
            <textarea
              ref={textareaRef}
              id={inputId}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (problem !== null) clearProblem();
              }}
              onKeyDown={onKeyDown}
              placeholder={t("assistant.form.placeholder")}
              maxLength={MAX_USER_MESSAGE_CHARS}
              rows={3}
              aria-describedby={describedBy === "" ? undefined : describedBy}
              aria-invalid={problem !== null}
              className={
                "w-full rounded-[var(--pt-radius-sm)] border bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] " +
                "placeholder:text-[color:var(--pt-muted)] focus:outline-none focus:ring-2 " +
                (problem !== null
                  ? "border-red-500 focus:ring-red-500/30"
                  : "border-[color:var(--pt-field-border)] focus:border-[color:var(--brand-primary)] focus:ring-[color:var(--brand-primary)]/30")
              }
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p id={hintId} className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                {t("assistant.form.hint")}
              </p>
              {/* Discret à dessein (« compteur de caractères discret ») :
                  `aria-hidden` l'écarte de la lecture au fil du texte, mais un
                  élément référencé par `aria-describedby` reste lu quand le
                  champ reçoit le focus — le calcul du nom/description ignore
                  `aria-hidden` pour ses propres cibles (accname). Visible pour
                  tout le monde, juste pas redit à chaque passage. */}
              <p id={counterId} aria-hidden="true" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                {t("assistant.form.counter", { count: draft.length, max: MAX_USER_MESSAGE_CHARS })}
              </p>
            </div>
            {problem !== null && (
              <p id={problemId} role="alert" className="text-[length:var(--pt-body)] text-red-600">
                {t(problem === "empty" ? "assistant.form.empty" : "assistant.form.tooLong", {
                  max: MAX_USER_MESSAGE_CHARS,
                })}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-4">
              <button type="submit" disabled={state.status === "sending"} className={BUTTON_CLASS}>
                {t(state.status === "sending" ? "assistant.form.sending" : "assistant.form.send")}
              </button>
              {state.ticket !== null && (
                <button
                  type="button"
                  onClick={endConversation}
                  className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
                >
                  {t("assistant.newConversation")}
                </button>
              )}
              {state.ticket !== null && state.turnsLeft <= 3 && (
                <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                  {tn("assistant.turnsLeft", state.turnsLeft)}
                </p>
              )}
            </div>
          </form>
        )}

        {focusDemarche !== null && (
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to={localizedPath(lang, "/demarches/" + encodeURIComponent(focusDemarche.id))}
              className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
            >
              {t("demarche.back")}
            </Link>
            {depositEnabled && (
              <button
                type="button"
                disabled={collectBusy}
                onClick={() => startCollect(focusDemarche.id)}
                className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline disabled:opacity-60"
              >
                {t("assistant.collect.start")}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function AssistantDisabled({ lang }: { lang: string }) {
  const t = useT();
  return (
    <>
      <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">
        {t("assistant.disabled.title")}
      </h1>
      <p className="mt-3 text-[color:var(--pt-muted)]">{t("assistant.disabled.detail")}</p>
      <Link to={localizedPath(lang, "/")} className={LINK_CLASS + " mt-6 inline-flex"}>
        {t("demarche.backHome")}
      </Link>
    </>
  );
}

export function AssistantPage() {
  const [searchParams] = useSearchParams();
  // ⚠️ Non validé ici : un identifiant invalide ou périmé s'efface tout seul,
  // faute d'être trouvé dans `demarches` (le catalogue publié) — voir
  // `AssistantConversation`. Le serveur, de son côté, revalide aussi le sien
  // (`UUID_RE`, catalogue) avant de le lire.
  const focusDemarcheId = searchParams.get("demarche");
  const location = useLocation();
  const { organisme } = splitScopedPath(location.pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const { state, retry } = usePortal(lang);

  // Le serveur a tranché la langue : l'adresse s'y aligne, mais seulement sur
  // une réponse à jour (voir `PortalPage`, même motif).
  const served = servedLanguage(state.status === "ready" ? state : null, lang);
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  // Le titre de l'onglet (RGAA 8.6), posé avant tout retour anticipé.
  useDocumentTitle(
    state.status === "error"
      ? errorPageTitle(lang, errorMessageFor(state.reason, lang).title)
      : state.status !== "ready"
        ? t("page.title")
        : assistantTitle(lang, state.tenant.name),
  );

  // ⚠️ LA COLLECTIVITÉ ENTIÈRE, JAMAIS UN ORGANISME — même raison
  // qu'`AccessibilitePage` : l'assistant répond sur tout le catalogue publié,
  // pas sur celui d'un seul organisme, et n'a donc pas de page « à lui » sous
  // un périmètre. `/mairie-de-cahors/assistant` ramène à `/assistant`, en
  // conservant `?demarche=…` et le reste de la requête.
  if (organisme !== null) {
    return <Navigate to={localizedPath(lang, "/assistant") + location.search} replace />;
  }

  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        <Link to={localizedPath(lang, "/")} className={LINK_CLASS}>
          {t("demarche.backHome")}
        </Link>
      </DemarcheError>
    );
  }

  const { tenant, villes, demarches, branding } = state;

  return (
    <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
    >
      {tenant.assistant.enabled ? (
        <AssistantConversation
          demarches={demarches}
          lang={lang}
          focusDemarcheId={focusDemarcheId}
          depositEnabled={tenant.assistant.depositEnabled}
        />
      ) : (
        <AssistantDisabled lang={lang} />
      )}
    </DemarcheShell>
  );
}
