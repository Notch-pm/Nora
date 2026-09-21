/**
 * LE FIL de l'assistant — le même, qu'il soit dans la bulle flottante ou sur
 * la page `/assistant`. C'est le seul endroit où vit la conversation ; les
 * deux cadres qui l'accueillent ne font que l'entourer.
 *
 * Ce composant N'AFFICHE QUE — toute règle (validation, fil, tours,
 * persistance) vit dans `conversation.ts` et `collect.ts` (purs, testés) et
 * dans les deux hooks qui les orchestrent. Le fil et le recueil étant gardés en
 * `sessionStorage`, passer de la bulle à la page ne perd rien.
 *
 * `variant` ne décide QUE de la mise en page : `page` s'étale, `panel` se
 * resserre. Aucune règle n'en dépend.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { viewOf } from "@fn/_shared/ai/collection.ts";
import { MAX_USER_MESSAGE_CHARS } from "@fn/_shared/domain/assistantTurn.ts";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { Markdown } from "@/features/portal/Markdown.tsx";
import { useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import { BUTTON_CLASS, CARD_CLASS } from "./cardStyles.ts";
import {
  ClassicFormLink,
  IdentityCard,
  OrganizationCard,
  PendingFieldCard,
  ReceiptNoteView,
  RecapCard,
  StartedNoteView,
} from "./CollectCards.tsx";
import { mergeTimeline, type CollectStep } from "./collect.ts";
import type { AssistantMessageView } from "./conversation.ts";
import { assistantErrorMessage } from "./errorMessages.ts";
import { useAssistantCollect } from "./useAssistantCollect.ts";
import { useAssistantConversation } from "./useAssistantConversation.ts";

/**
 * La mention permanente : obligation de transparence, jamais reléguée au
 * premier message.
 *
 * ⚠️ Dans le panneau, elle est REPLIÉE — sa ligne d'amorce reste visible, les
 * cinq points s'ouvrent d'un geste. Dépliée, elle occupait tout le panneau et
 * poussait la conversation hors de vue : une mention qu'il faut faire défiler
 * pour atteindre ce qu'elle annonce n'informe personne. Sur la page, où la
 * place ne manque pas, elle reste ouverte.
 */
export function AssistantNotice({ variant }: { variant: "panel" | "page" }) {
  const t = useT();
  const items: Array<"automated" | "sources" | "noPersonalData" | "notStored" | "provider"> = [
    "automated",
    "sources",
    "noPersonalData",
    "notStored",
    "provider",
  ];
  return (
    <details
      open={variant === "page"}
      className="rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] p-4"
      style={{ background: "var(--pt-surface)" }}
    >
      <summary className="cursor-pointer text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
        {t("assistant.notice.lead")}
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {items.map((key) => (
          <li key={key} className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{t(`assistant.notice.${key}` as const)}</span>
          </li>
        ))}
      </ul>
    </details>
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
/**
 * La bulle d'attente — trois points, à la place où la réponse va paraître.
 *
 * Le guichet IA refuse le flux : aucun affichage progressif n'est possible, et
 * l'usager attend la réponse ENTIÈRE. On ne peut pas raccourcir cette attente
 * par le texte qui arrive, seulement par ce qu'on montre pendant.
 *
 * ⚠️ `aria-hidden` : l'annonce reste dans la région `role="status"`, et elle
 * seule (RGAA 4.1 — un seul message à la fois). Cette bulle est un signe pour
 * l'œil, pas un message. L'animation se coupe sous `prefers-reduced-motion`.
 */
function WaitingBubble() {
  return (
    <div aria-hidden="true" className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] bg-white px-4 py-3">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            style={{ animationDelay: `${delay}ms` }}
            className="h-2 w-2 rounded-full bg-[color:var(--pt-muted)] motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

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

export function AssistantThread({
  demarches,
  lang,
  focusDemarcheId,
  depositEnabled,
  variant,
  onStepChange,
}: {
  demarches: Demarche[];
  lang: string;
  focusDemarcheId: string | null;
  /** La collectivité a ouvert le recueil dans la conversation (lot 2). */
  depositEnabled: boolean;
  /** Ne décide QUE de la mise en page — jamais d'une règle. */
  variant: "panel" | "page";
  /** Pour que la bulle sache s'élargir : le récapitulatif et l'identité ne tiennent pas en étroit. */
  onStepChange?: (step: CollectStep | null) => void;
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
    asking,
    collectOffer,
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
  //
  // ⚠️ Sauf quand la question se répond EN PARLANT — le cas courant depuis que
  // le modèle mène la conversation. Le focus ne part au contrôle que s'il y en
  // a un à remplir (un calendrier, un dépôt de fichier) ; sinon il reste dans
  // la zone de saisie, là où on attend justement la réponse.
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldView =
    collect.session !== null && collect.step === "fields"
      ? viewOf(collect.session.demarche.form, collect.session.collection, asking)
      : null;
  const cardSignature =
    collect.session === null
      ? ""
      : collect.step !== "fields"
        ? collect.session.demarche.id + ":" + collect.step
        : fieldView !== null && fieldView.controls.length > 0
          ? collect.session.demarche.id + ":fields:" + fieldView.controls[0].id
          : "";
  useEffect(() => {
    if (cardSignature === "") return;
    const focusable = cardRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [cardSignature]);

  // Le cadre suit l'étape : un récapitulatif ou une carte d'identité ne tient
  // pas dans un panneau étroit, et c'est à lui de s'élargir — pas au fil de se
  // recroqueviller.
  const step = collect.step;
  useEffect(() => {
    onStepChange?.(step);
  }, [step, onStepChange]);

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

  /**
   * Ouvre un recueil — ET fait parler l'assistant.
   *
   * ⚠️ Ouvrir ne coûtait aucun appel au modèle : c'est une action purement
   * locale. Conséquence, l'usager cliquait « Remplir cette démarche ici » et
   * l'assistant se TAISAIT : une note, une liste de champs, et à lui d'écrire
   * le premier sans savoir quoi. On lui demandait de converser avec quelqu'un
   * qui n'avait rien dit.
   *
   * Le tour qui suit coûte un appel par ouverture. C'est assumé : c'est le prix
   * d'un accueil et d'une première question, et sans eux il n'y a pas de
   * conversation du tout.
   *
   * Le message envoyé dit ce que le clic VEUT DIRE, dans les mots de l'usager.
   * Ce n'est pas un faux tour glissé dans le fil : c'est sa demande, écrite
   * pour lui parce qu'il l'a exprimée d'un bouton plutôt qu'au clavier.
   */
  async function startCollect(demarcheId: string): Promise<void> {
    const opened = await collect.start(demarcheId, state.messages.length);
    if (opened === null) return;
    sendMessage(t("assistant.collect.openingSaid", { name: opened.name }), opened.payload);
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

  // `null` hors du remplissage des champs : la ligne d'état retombe alors sur
  // l'attente seule.
  //
  // ⚠️ On compte ce qui BLOQUE, pas ce qui traîne. « Encore 3 informations à
  // préciser » alors que les trois étaient facultatives — et que le modèle
  // venait d'annoncer que tout était là — donnait un compteur qui contredisait
  // l'assistant sans rien dire de ce qu'il fallait faire.
  const remaining =
    collect.session !== null && collect.step === "fields" && fieldView !== null && fieldView.remainingRequired.length > 0
      ? fieldView.remainingRequired
      : null;

  return (
    <div className="flex flex-col gap-4">
        <AssistantNotice variant={variant} />

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
                  onStartCollect={(id) => void startCollect(id)}
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
          {state.status === "sending" && <WaitingBubble />}
        </div>

        {/* ⚠️ L'assistant a PROPOSÉ de remplir — il n'a rien ouvert. C'est ce
            bouton, et lui seul, qui démarre : un recueil qui se lancerait tout
            seul embarquerait dans un formulaire celui qui voulait juste poser
            une question. */}
        {collectOffer !== null && collect.session === null && depositEnabled && (
          <button
            type="button"
            disabled={collectBusy}
            onClick={() => void startCollect(collectOffer.id)}
            className={BUTTON_CLASS + " w-fit"}
          >
            {t("assistant.collect.offerAccept")}
          </button>
        )}

        {/* Région d'état SÉPARÉE du fil : c'est elle qui annonce l'attente,
            jamais le fil lui-même (RGAA 4.1 — un seul message à la fois).
            ⚠️ Elle porte AUSSI l'avancement du recueil, qui vivait dans la
            carte du champ : sans cela, un usager de lecteur d'écran perdrait
            tout repère depuis que l'écran ne pose plus les questions. Un seul
            message à la fois — l'attente l'emporte, puis l'avancement.
            ⚠️ Et l'avancement NOMME ce qui reste. C'est l'écran qui le fait,
            pas le modèle : une liste de libellés ne coûte aucun jeton (donc
            aucune seconde d'attente de plus), ne se trompe jamais et ne
            s'oublie pas d'un tour à l'autre. */}
        <p role="status" aria-live="polite" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {state.status === "sending"
            ? t(stillWaiting ? "assistant.status.stillWaiting" : "assistant.status.waiting")
            : remaining === null
              ? ""
              : tn("assistant.collect.remaining", remaining.length)}
        </p>

        {/* ⚠️ La liste des champs restants est REPLIÉE, et HORS de la région
            d'état. Dépliée, elle affichait « Numéro, BTQ, Voie, Complément
            d'adresse, Code postal » entre chaque question : le formulaire
            reparaissait sous une autre forme, et son jargon avec lui.
            Hors de la région : le compte est annoncé tout seul au lecteur
            d'écran, et le détail reste atteignable d'un geste — sans qu'ouvrir
            le repli déclenche une annonce de neuf libellés. */}
        {remaining !== null && state.status !== "sending" && (
          <details className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
            <summary className="cursor-pointer">{t("assistant.collect.remainingSee")}</summary>
            <ul className="mt-1 flex flex-col gap-0.5 ps-4">
              {remaining.map((field) => (
                <li key={field.id} className="list-disc">
                  {field.label}
                </li>
              ))}
            </ul>
          </details>
        )}

        {collect.loading && (
          <p role="status" aria-live="polite" className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
            {t("assistant.collect.loading")}
          </p>
        )}

        {/* ⚠️ Le message dit « Réessayez » : il faut donc quelque chose à
            presser. Sans ce bouton, le seul recours était de retrouver le
            bouton d'origine — qui a pu défiler hors de vue entre-temps. */}
        {collect.loadError !== null && (
          <div role="alert" className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3">
            <p className="text-[length:var(--pt-body)] text-red-800">
              {t(collect.loadError === "no_form" ? "assistant.collect.noForm" : "assistant.collect.loadFailed")}
            </p>
            {collect.retryStart !== null && (
              <button
                type="button"
                disabled={collect.loading}
                onClick={collect.retryStart}
                className={BUTTON_CLASS + " mt-3 w-fit"}
              >
                {t("assistant.collect.retry")}
              </button>
            )}
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
              <PendingFieldCard
                session={collect.session}
                asking={asking}
                onAnswer={collect.answerField}
                onSkip={collect.skipField}
              />
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
                dense={variant === "panel"}
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
              {collect.session !== null
                ? t("assistant.collect.endedPrefill")
                : assistantErrorMessage({ reason: "conversation_ended" }, lang).detail}
            </p>
            {/* ⚠️ EN PLEIN RECUEIL, le formulaire prérempli devient le geste
                PRINCIPAL. La zone de saisie vient de disparaître : sans cela,
                l'usager resterait bloqué avec tout ce qu'il a déjà raconté.
                « Nouvelle conversation » passe derrière — elle efface le
                recueil (`collect.reset()`), c'est le pire geste ici. */}
            {collect.session !== null ? (
              <div className="mt-3 flex flex-col items-start gap-3">
                <ClassicFormLink session={collect.session} prominent />
                <button
                  ref={newConversationButtonRef}
                  type="button"
                  onClick={endConversation}
                  className="text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-muted)] hover:underline"
                >
                  {t("assistant.newConversation")}
                </button>
              </div>
            ) : (
              <button
                ref={newConversationButtonRef}
                type="button"
                onClick={endConversation}
                className={BUTTON_CLASS + " mt-3"}
              >
                {t("assistant.newConversation")}
              </button>
            )}
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
            {/* Dans la bulle, l'usager EST déjà sur la démarche : un lien qui
                l'y renvoie ne mène nulle part. */}
            {variant === "page" && (
              <Link
                to={localizedPath(lang, "/demarches/" + encodeURIComponent(focusDemarche.id))}
                className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
              >
                {t("demarche.back")}
              </Link>
            )}
            {depositEnabled && (
              <button
                type="button"
                disabled={collectBusy}
                onClick={() => void startCollect(focusDemarche.id)}
                className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline disabled:opacity-60"
              >
                {t("assistant.collect.start")}
              </button>
            )}
          </div>
        )}
    </div>
  );
}
