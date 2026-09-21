/**
 * La colonne DROITE du co-pilote : le formulaire officiel, en entier.
 *
 * ⚠️ **C'EST LE FORMULAIRE, SANS RÉDUCTION** — mêmes champs, mêmes règles de
 * visibilité et de validation, même dépôt (`collect.submit()`, la seule route
 * qui existe : `POST /v1/demandes`, avec sa porte anti-robot et son accusé).
 * L'assistant n'ajoute que trois choses, et rien d'autre : les badges d'origine
 * des valeurs, le halo sur la question du moment, et le lien de sortie.
 *
 * ⚠️ **POURQUOI LE FORMULAIRE EST PERMANENT.** Le recueil se faisait en cartes
 * insérées dans le fil, une question à la fois : la carte disparaissait au
 * message suivant, et l'usager ne voyait jamais ce qu'il était en train de
 * construire. Ici l'objet est là, entier, du début à la fin — on peut abandonner
 * la conversation et finir à la main sans rien perdre.
 *
 * ⚠️ **DEUX CHEMINS POUR CHAQUE CHAMP**, et c'est le point : répondre dans la
 * conversation (le texte part au modèle) ou saisir directement ici (`answerField`,
 * aucun appel au guichet IA). Le second est toujours disponible, ce qui fait de
 * ce panneau une réduction de ce qui transite, pas l'inverse.
 */
import { useEffect, useRef, useState } from "react";
import { viewOf } from "@fn/_shared/ai/collection.ts";
import { isSection } from "@fn/_shared/domain/formSchema.ts";
import {
  isFieldRequired,
  validateForm,
  visibleNodes,
  type FieldErrors,
} from "@fn/_shared/domain/formulaire.ts";
import { requesterFieldsFor, enabledAudiences, type Audience } from "@fn/_shared/domain/requesterConfig.ts";
import { FormFieldControl } from "@/features/demarche/FormFields.tsx";
import { RequesterSection } from "@/features/demarche/RequesterSection.tsx";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import { errorText } from "@/i18n/t.ts";
import { assistantWrites, progressOf, type CollectSession } from "./collect.ts";
import { ClassicFormLink } from "./CollectCards.tsx";
import { OriginBadge, OriginNote, type FieldMark } from "./FieldOrigin.tsx";
import { SECONDARY_BUTTON_CLASS } from "./cardStyles.ts";
import type { UseAssistantCollect } from "./useAssistantCollect.ts";

/** Le bloc mis en avant autour de la question du moment. */
function PendingWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[var(--pt-radius-sm)] border p-4"
      style={{ background: "var(--pt-primary-soft)", borderColor: "var(--pt-primary)" }}
    >
      {children}
    </div>
  );
}

export function CoPilotPanel({
  session,
  collect,
}: {
  session: CollectSession;
  collect: UseAssistantCollect;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const tn = useTn();
  const [blocked, setBlocked] = useState<"organization" | null>(null);

  const { form, requester, organizations, name } = session.demarche;
  const { values, origins, touched } = session.collection;
  const nodes = visibleNodes(form, values);
  const progress = progressOf(session);
  // ⚠️ UN SEUL champ porte le halo, par construction : `viewOf` rend LE prochain.
  const pendingFieldId = viewOf(form, session.collection).pending?.id ?? null;

  const audiences = enabledAudiences(requester);
  const currentAudience: Audience | null = session.audience ?? audiences[0] ?? null;
  const requesterFields =
    currentAudience === null ? [] : requesterFieldsFor(requester, currentAudience);

  // Les erreurs ne s'affichent qu'après une tentative d'envoi — un formulaire
  // qui se plaint pendant qu'on le remplit est le défaut le plus agaçant qui
  // soit. `validateForm` reste la même règle que le formulaire classique.
  const [showErrors, setShowErrors] = useState(false);
  const errors: FieldErrors = showErrors ? validateForm(form, values) : {};

  const mustChooseOrganization = organizations.length > 1;

  function markOf(fieldId: string): FieldMark | null {
    if (fieldId === pendingFieldId) return "pending";
    // ⚠️ Un champ corrigé à la main perd son badge : `answerField` a effacé son
    // origine, et `touched` le met hors d'atteinte de l'assistant. Le test ici
    // n'est qu'une ceinture — l'origine a déjà disparu.
    if (touched.includes(fieldId)) return null;
    return origins[fieldId]?.origin ?? null;
  }

  function review(): void {
    setShowErrors(true);
    const outcome = collect.confirmAll();
    setBlocked(outcome === "organization" ? "organization" : null);
  }

  /**
   * L'annonce vocale de chaque écriture de l'assistant (RGAA — voir
   * `assistantWrites`). On ne dit que ce qui vient d'APPARAÎTRE : `announcedRef`
   * retient ce qui a déjà été lu, sinon la région relirait toute la liste à
   * chaque salve.
   */
  const [announcement, setAnnouncement] = useState("");
  const announcedRef = useRef<Set<string>>(new Set());
  const written = assistantWrites(session);
  const writtenKey = written.map((entry) => entry.id + "=" + entry.value).join("|");
  useEffect(() => {
    const fresh = written.filter((entry) => !announcedRef.current.has(entry.id + "=" + entry.value));
    if (fresh.length === 0) return;
    for (const entry of fresh) announcedRef.current.add(entry.id + "=" + entry.value);
    setAnnouncement(
      fresh.map((entry) => t("assistant.copilot.written", { label: entry.label, value: entry.value })).join(" "),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `writtenKey` résume `written`
  }, [writtenKey]);

  return (
    <section
      aria-label={name}
      className="flex flex-col rounded-[var(--pt-radius)] border border-[color:var(--pt-border)]"
      style={{ background: "var(--pt-surface)" }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-[color:var(--pt-border)] bg-white p-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">{name}</h2>
          <p className="mt-0.5 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
            {t("assistant.copilot.progress", { done: progress.done, total: progress.total })}
          </p>
        </div>
        {/* La barre double le texte ci-dessus : décorative, donc masquée. */}
        <div
          aria-hidden="true"
          className="h-2 w-28 overflow-hidden rounded-full"
          style={{ background: "var(--pt-border)" }}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: progress.total === 0 ? "0%" : `${Math.round((progress.done / progress.total) * 100)}%`,
              background: "var(--pt-primary)",
            }}
          />
        </div>
      </header>

      {/* ⚠️ Région d'état à part, et VISUELLEMENT MASQUÉE : ce qu'elle annonce
          se voit déjà — la valeur est dans le champ, son origine dans le badge.
          Elle n'existe que pour qui ne voit pas le formulaire se remplir. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-col gap-5 p-4">
        {mustChooseOrganization && (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="copilote-organisme"
              className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]"
            >
              {t("form.organization")}
              <span className="ml-1 text-red-600" aria-hidden="true">
                *
              </span>
            </label>
            <select
              id="copilote-organisme"
              value={session.organizationId ?? ""}
              aria-invalid={blocked === "organization"}
              onChange={(event) => {
                collect.chooseOrganization(event.target.value);
                setBlocked(null);
              }}
              className={
                "w-full rounded-[var(--pt-radius-sm)] border bg-white px-3 py-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)] focus:outline-none focus:ring-2 " +
                (blocked === "organization"
                  ? "border-red-500 focus:ring-red-500/30"
                  : "border-[color:var(--pt-field-border)] focus:border-[color:var(--brand-primary)] focus:ring-[color:var(--brand-primary)]/30")
              }
            >
              <option value="">{t("form.choose")}</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            {blocked === "organization" && (
              <p role="alert" className="text-[length:var(--pt-body)] text-red-600">
                {t("form.chooseOrganization")}
              </p>
            )}
          </div>
        )}

        {nodes.map((node) => {
          const fields = isSection(node) ? node.fields : [node];
          const body = fields.map((field) => {
            const mark = markOf(field.id);
            const record = origins[field.id];
            const note =
              mark === "pending" ? (
                t("assistant.origin.pendingNote")
              ) : record === undefined || touched.includes(field.id) ? null : (
                <OriginNote record={record} />
              );
            const control = (
              <FormFieldControl
                key={field.id}
                field={field}
                value={values[field.id]}
                onChange={(value) => collect.answerField(field.id, value)}
                required={isFieldRequired(field, values)}
                error={errorText(lang, errors[field.id])}
                demarcheId={session.demarche.id}
                badge={mark === null ? null : <OriginBadge mark={mark} />}
                note={note}
              />
            );
            return mark === "pending" ? (
              <PendingWrapper key={field.id}>{control}</PendingWrapper>
            ) : (
              control
            );
          });
          return isSection(node) ? (
            <section key={node.id} className="flex flex-col gap-4">
              <div>
                <h3 className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">{node.title}</h3>
                {node.description !== undefined && (
                  <p className="mt-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
                    {node.description}
                  </p>
                )}
              </div>
              {body}
            </section>
          ) : (
            <div key={node.id} className="flex flex-col gap-4">
              {body}
            </div>
          );
        })}

        {currentAudience !== null && (
          <div className="flex flex-col gap-2">
            {/* ⚠️ La promesse, écrite là où elle se vérifie : l'assistant ne
                préremplit JAMAIS l'identité ni les coordonnées (liste blanche
                `aiFillable` côté serveur — voir `collection.ts`). */}
            <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
              {t("assistant.copilot.neverPrefilled")}
            </p>
            <RequesterSection
              audiences={audiences}
              audience={currentAudience}
              onAudienceChange={collect.setAudience}
              fields={requesterFields}
              values={session.requesterValues}
              onChange={collect.setRequesterValue}
              errors={collect.requesterErrors}
            />
          </div>
        )}
      </div>

      <footer className="mt-auto flex flex-wrap items-center gap-3 border-t border-[color:var(--pt-border)] bg-white p-4">
        <button
          type="button"
          onClick={review}
          disabled={progress.remainingRequired > 0}
          className={
            "rounded-[var(--pt-radius-sm)] px-5 py-3 text-[length:var(--pt-body)] font-bold " +
            (progress.remainingRequired > 0
              ? "cursor-not-allowed bg-[color:var(--pt-border)] text-[color:var(--pt-muted)]"
              : "bg-[color:var(--brand-primary)] text-white hover:opacity-90")
          }
        >
          {t("assistant.copilot.review")}
        </button>
        <p className="flex-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {progress.remainingRequired > 0
            ? tn("assistant.copilot.remaining", progress.remainingRequired)
            : t("form.requiredNote")}
        </p>
        {/* ⚠️ L'ÉCHAPPATOIRE, TOUJOURS OFFERTE : l'assistant ne doit jamais
            être un passage forcé. Elle ouvre le formulaire classique en pleine
            largeur, déjà rempli — l'usager ne perd pas une réponse. */}
        <ClassicFormLink
          session={session}
          label={t("assistant.copilot.leave")}
          className={SECONDARY_BUTTON_CLASS}
        />
      </footer>
    </section>
  );
}
