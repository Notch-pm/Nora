/**
 * La page d'une démarche : ce qu'elle est, avant de la remplir.
 *
 * L'usager lit d'abord, s'engage ensuite — c'est le geste des portails de
 * service public, et il évite d'ouvrir un mur de champs à quelqu'un qui ne
 * sait pas encore ce qu'on va lui demander. « Commencer la démarche » mène au
 * formulaire, qui a alors l'écran pour lui seul.
 *
 * Ce que la collectivité a écrit POUR L'USAGER (contrat 1.24.0) s'y lit dans
 * l'ordre où il se pose ses questions : de quoi s'agit-il (descriptif), est-ce
 * pour moi (public concerné), que dois-je préparer (pièces) — et la FAQ en
 * dernier, pour qui a encore un doute.
 *
 * DEUX COLONNES sur un grand écran : ce contenu, en cartes, et « L'essentiel »
 * à côté — le bouton, les deux durées, les organismes. Le bouton y reste à
 * portée pendant la lecture, sans retarder qui sait déjà ce qu'il vient faire.
 * ⚠️ Dans le DOM, l'essentiel suit l'en-tête de la page et précède le contenu :
 * sur un téléphone, où tout s'empile, c'est là qu'il doit tomber — et c'est
 * aussi l'ordre de lecture d'un lecteur d'écran (RGAA 10.3). La grille le
 * replace à droite.
 *
 * ⚠️ **RIEN D'ÉCRIT, RIEN D'AFFICHÉ** : chaque section n'apparaît que si la
 * collectivité l'a remplie. Aucun texte n'est composé à sa place.
 *
 * ⚠️ **CES TEXTES NE SONT PAS TRADUITS** au Socle : servie dans une autre
 * langue, la page traduit ses titres, et marque le texte de la collectivité
 * `lang="fr"` (RGAA 8.7) pour qu'un lecteur d'écran le prononce correctement.
 */
import { useEffect, useId, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { PortalTheme } from "@fn/_shared/domain/theme.ts";
import type { UserFaqEntry } from "@fn/_shared/domain/userCommunication.ts";
import { AskAboutDemarche } from "@/features/assistant/AssistantBubble.tsx";
import { MAX_ORGANIZATION_CHIPS } from "@/features/portal/composition.ts";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { Markdown } from "@/features/portal/Markdown.tsx";
import { AUDIENCE_KEY } from "@/features/portal/sections/AudienceFilter.tsx";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "./DemarcheShell.tsx";
import { piecesPresentation } from "./pieces.ts";
import { responseDelayText } from "./responseDelay.ts";
import { useDemarche } from "./useDemarche.ts";
import { useLanguage, useT, useTn } from "@/i18n/LanguageLayout.tsx";
import {
  organismePath,
  PIVOT_LANGUAGE,
  servedLanguage,
  splitScopedPath,
} from "@/i18n/localizedPath.ts";
import { demarcheTitle, errorPageTitle } from "@/i18n/pageTitle.ts";
import { useDocumentTitle } from "@/i18n/useDocumentTitle.ts";

const CARD_CLASS =
  "rounded-[var(--pt-radius)] border border-[color:var(--pt-border)] bg-white p-[var(--pt-pad)] shadow-[var(--pt-shadow)]";
const SECTION_TITLE_CLASS = "text-[length:var(--pt-h2)] font-bold tracking-tight text-[color:var(--pt-ink)]";
const BODY_CLASS = "text-[length:var(--pt-body)] leading-relaxed text-[color:var(--pt-ink)]";
const NOTE_CLASS = "text-[length:var(--pt-small)] text-[color:var(--pt-muted)]";

// ── Les pictogrammes ────────────────────────────────────────────────────────
//
// Tous DÉCORATIFS (`aria-hidden`) : chacun double un libellé écrit, qui seul
// porte le sens. D'où aucune exigence de contraste sur eux (RGAA 3.3 ne vise
// que les éléments graphiques porteurs d'information).

function Icon({ children, size = 20, className = "" }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={"shrink-0 " + className}
    >
      {children}
    </svg>
  );
}

const CLOCK = (
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>
);
const CALENDAR = (
  <>
    <path d="M16 2v4" />
    <path d="M8 2v4" />
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M3 10h18" />
  </>
);
const BUILDING = (
  <>
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path d="M10 6h4" />
    <path d="M10 10h4" />
    <path d="M10 14h4" />
    <path d="M6 22h12" />
  </>
);
const FILE = (
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v5h6" />
  </>
);
const UPLOAD = (
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </>
);
const ARROW = (
  <>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </>
);

// ── Les morceaux de la page ─────────────────────────────────────────────────

function BackToHome() {
  const { lang } = useLanguage();
  const t = useT();
  // Sous un organisme, « revenir à l'accueil » c'est revenir à SA page : c'est
  // la liste d'où l'usager vient, et celle qui porte le lien vers les autres
  // organismes. Le renvoyer à l'accueil de la collectivité lui ferait perdre
  // le périmètre sans l'avoir demandé.
  const { organisme } = splitScopedPath(useLocation().pathname);
  return (
    <Link
      to={organismePath(lang, organisme, "/")}
      className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
    >
      {t("demarche.backHome")}
    </Link>
  );
}

/**
 * Le fil d'Ariane : l'accueil, l'organisme quand on vient de sa page, puis la
 * démarche. Il remplace le « Retour à l'accueil » — il y mène aussi, et dit en
 * plus où l'on est.
 *
 * ⚠️ Sous un organisme, le chemin passe par SA page : c'est de là que l'usager
 * vient (voir `BackToHome`). Si son nom manque — un slug que le détail ne
 * rattache à aucun organisme —, l'accueil y mène directement plutôt que
 * d'afficher un slug brut.
 */
function Breadcrumb({
  current,
  organisme,
  organismeName,
}: {
  current: string;
  organisme: string | null;
  organismeName: string | null;
}) {
  const { lang } = useLanguage();
  const t = useT();
  const linkClass = "underline decoration-1 underline-offset-4 hover:text-[color:var(--pt-ink)]";
  const separator = (
    <span aria-hidden="true" className="opacity-60">
      /
    </span>
  );
  return (
    <nav aria-label={t("demarche.breadcrumb")} className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        <li>
          <Link
            to={organismePath(lang, organismeName === null ? organisme : null, "/")}
            className={linkClass}
          >
            {t("header.home")}
          </Link>
        </li>
        {organisme !== null && organismeName !== null && (
          <li className="flex items-center gap-2">
            {separator}
            <Link to={organismePath(lang, organisme, "/")} className={linkClass}>
              {organismeName}
            </Link>
          </li>
        )}
        <li className="flex min-w-0 items-center gap-2">
          {separator}
          <span aria-current="page" className="font-semibold text-[color:var(--pt-ink)]">
            {current}
          </span>
        </li>
      </ol>
    </nav>
  );
}

/**
 * Le bouton vers le formulaire. Deux exemplaires sur la page — dans
 * l'essentiel, et au bas du contenu —, tous deux au même libellé : ils mènent
 * au même endroit (RGAA 6.1).
 *
 * L'encre est `--pt-on-primary`, choisie par contraste avec la couleur de la
 * collectivité : un blanc fixe ne se lirait pas sur une charte claire.
 */
function StartLink({ to, block = false }: { to: string; block?: boolean }) {
  const t = useT();
  return (
    <Link
      to={to}
      className={
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--pt-radius-sm)] bg-[color:var(--pt-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-[color:var(--pt-on-primary)] shadow-[var(--pt-shadow)] transition-shadow hover:underline hover:underline-offset-4 hover:shadow-md " +
        (block ? "w-full" : "")
      }
    >
      <span>{t("demarche.start")}</span>
      <Icon size={18} className="rtl:rotate-180">
        {ARROW}
      </Icon>
    </Link>
  );
}

/** Une ligne de l'essentiel : un pictogramme, une étiquette, une valeur. */
function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  // ⚠️ Le pictogramme est DANS le `dt` : un `div` de `dl` ne peut porter que
  // des `dt` et des `dd`. Il est sorti du flux pour prendre la marge.
  return (
    <div className="relative ps-8">
      <dt className="text-[length:var(--pt-small)] font-bold text-[color:var(--pt-muted)]">
        <span className="absolute start-0 top-0.5 text-[color:var(--pt-primary)]">
          <Icon>{icon}</Icon>
        </span>
        {label}
      </dt>
      <dd className="mt-0.5 text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">{children}</dd>
    </div>
  );
}

/**
 * Une question de la FAQ, repliable.
 *
 * ⚠️ LA QUESTION RESTE UN TITRE : le bouton est DANS le `h3`, pas l'inverse,
 * pour qu'un lecteur d'écran continue de passer d'une question à l'autre par
 * les titres. `<details>` a été écarté pour cette raison : le rôle de bouton de
 * son `summary` efface le titre qu'on y mettrait, selon les lecteurs.
 */
function FaqItem({ entry, defaultOpen }: { entry: UserFaqEntry; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const answerId = useId();
  return (
    <div className="border-b border-[color:var(--pt-border)]">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={answerId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-4 py-4 text-start text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)] hover:underline hover:underline-offset-4"
        >
          <span>{entry.question}</span>
          <Icon size={18}>
            <line x1="5" y1="12" x2="19" y2="12" />
            {!open && <line x1="12" y1="5" x2="12" y2="19" />}
          </Icon>
        </button>
      </h3>
      <div id={answerId} hidden={!open}>
        <p className={"max-w-[68ch] whitespace-pre-line pb-5 " + BODY_CLASS}>{entry.answer}</p>
      </div>
    </div>
  );
}

/**
 * Où l'essentiel s'accroche en défilant : sous l'en-tête quand il est fixe, et
 * l'en-tête centré (logo, puis menu) est plus haut que l'en-tête en ligne.
 */
function stickyTop(theme: PortalTheme): number {
  if (theme.header.sticky === false) return 32;
  return theme.header.logo === "center" ? 140 : 96;
}

// ── La page ─────────────────────────────────────────────────────────────────

export function DemarchePage() {
  const { demarcheId = "" } = useParams();
  // ⚠️ Le périmètre se lit dans l'ADRESSE, pas dans un paramètre de route : la
  // même adresse peut porter une langue, un organisme, ou les deux, et seule
  // `splitScopedPath` sait les distinguer (voir `App.tsx`).
  const { organisme } = splitScopedPath(useLocation().pathname);
  const { lang, serve } = useLanguage();
  const t = useT();
  const tn = useTn();
  const { state, retry } = useDemarche(demarcheId, lang, organisme);
  const essentialsId = useId();

  // Le serveur a tranché la langue : l'adresse s'y aligne (voir `PortalPage`).
  // ⚠️ ON N'ALIGNE L'ADRESSE QUE SUR UNE RÉPONSE À JOUR. Un état « prêt » qui
  // répond à la langue précédente est périmé le temps d'un rendu : s'en servir
  // renverrait le visiteur à la langue qu'il vient de quitter — et ferait
  // recharger la page sans que l'adresse change.
  const served = servedLanguage(
    state.status === "ready" ? { requested: state.requested, lang: state.snapshot.lang } : null,
    lang,
  );
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  // Le titre de l'onglet (RGAA 8.6), posé avant tout retour anticipé : les
  // hooks doivent s'exécuter dans le même ordre à chaque rendu.
  useDocumentTitle(
    state.status === "error"
      ? errorPageTitle(lang, errorMessageFor(state.reason, lang).title)
      : state.status !== "ready"
        ? t("page.title")
        : demarcheTitle(state.snapshot.demarche.name, state.snapshot.tenant.name),
  );

  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        <BackToHome />
      </DemarcheError>
    );
  }

  const { tenant, villes, demarche, branding, tenantBranding } = state.snapshot;
  const { responseDelay, audienceNote, announcedPieces, faq } = demarche.userCommunication;
  const pieces = piecesPresentation(announcedPieces, demarche.form);
  // La langue du texte de la collectivité, quand ce n'est pas celle de la
  // page : `userCommunication` n'est jamais traduit (voir l'en-tête).
  const collectiviteLang = state.snapshot.lang !== PIVOT_LANGUAGE ? PIVOT_LANGUAGE : undefined;

  const wanted = organisme?.toLowerCase() ?? null;
  const organismeName =
    wanted === null
      ? null
      : ([...demarche.organizations, ...villes].find((org) => org.slug?.toLowerCase() === wanted)?.name ?? null);

  const formPath = organismePath(
    lang,
    organisme,
    "/demarches/" + encodeURIComponent(demarche.id) + "/formulaire",
  );

  // Le descriptif n'est répété que s'il apporte autre chose que le résumé de
  // l'en-tête.
  const showDescription =
    demarche.userDescription !== null && demarche.userDescription !== demarche.description;
  const showAudience = audienceNote !== null || demarche.audiences.length > 0;
  const hasContent = showDescription || showAudience || pieces.kind !== "none" || faq.length > 0;
  // ⚠️ Au-delà de trois organismes, l'essentiel ne suit plus le défilement :
  // plus haut que l'écran, il aurait son bas coupé, bouton compris peut-être.
  const stickyAside = demarche.organizations.length <= MAX_ORGANIZATION_CHIPS;

  return (
    <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      tenantBranding={tenantBranding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
      layout="wide"
    >
      <Breadcrumb current={demarche.name} organisme={organisme} organismeName={organismeName} />

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <header className="flex flex-col items-start gap-3 lg:col-start-1 lg:row-start-1">
          {demarche.category !== null && (
            // L'intitulé à l'encre, la couleur de la collectivité en pastille :
            // son vert sur sa propre teinte perdrait le contraste AA.
            <span className="inline-flex items-center gap-2 rounded-full bg-[color:var(--pt-primary-soft)] px-3 py-1 text-[length:var(--pt-small)] font-bold text-[color:var(--pt-ink)]">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[color:var(--pt-primary)]" />
              {demarche.category.name}
            </span>
          )}
          <h1 className="text-balance text-[length:var(--pt-h1)] font-extrabold leading-tight tracking-tight text-[color:var(--pt-ink)] sm:text-[length:calc(var(--pt-h1)*1.15)]">
            {demarche.name}
          </h1>
          {demarche.description !== null && (
            <p className="max-w-[62ch] text-pretty text-[length:var(--pt-h2)] leading-snug text-[color:var(--pt-muted)]">
              {demarche.description}
            </p>
          )}
        </header>

        <aside
          aria-labelledby={essentialsId}
          className={
            "lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start " + (stickyAside ? "lg:sticky" : "")
          }
          style={{ top: stickyTop(tenant.theme) }}
        >
          <div className={CARD_CLASS + " flex flex-col gap-5"}>
            <h2 id={essentialsId} className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
              {t("demarche.essentials")}
            </h2>
            {demarche.form === null ? (
              // Une démarche sans formulaire n'est pas une erreur : elle est
              // publiée, sa saisie n'est simplement pas encore paramétrée. Le
              // dire vaut mieux qu'un bouton qui mène à une page vide.
              <p className="rounded-[var(--pt-radius-sm)] border border-dashed border-[color:var(--pt-field-border)] px-4 py-4 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
                {t("demarche.notOnline")}
              </p>
            ) : (
              <StartLink to={formPath} block />
            )}

            {/* Ouvre la BULLE avec cette démarche en contexte — sans quitter
                la page qu'on est en train de lire. */}
            <AskAboutDemarche demarcheId={demarche.id} />

            {(demarche.estimatedMinutes !== null ||
              responseDelay !== null ||
              demarche.organizations.length > 0) && (
              <dl className="flex flex-col gap-4 border-t border-[color:var(--pt-border)] pt-5">
                {/* ⚠️ Deux durées l'une sous l'autre, qui ne se déduisent pas
                    l'une de l'autre : remplir le formulaire (minutes), obtenir
                    une réponse (l'unité de la collectivité). Chaque étiquette
                    nomme la sienne. */}
                {demarche.estimatedMinutes !== null && (
                  <Fact icon={CLOCK} label={t("demarche.fillDuration")}>
                    {t("card.duration", { n: demarche.estimatedMinutes })}
                  </Fact>
                )}
                {responseDelay !== null && (
                  <Fact icon={CALENDAR} label={t("demarche.responseDelay")}>
                    {responseDelayText(lang, responseDelay)}
                  </Fact>
                )}
                {demarche.organizations.length > 0 && (
                  <Fact icon={BUILDING} label={tn("demarche.organizations", demarche.organizations.length)}>
                    {demarche.organizations.length === 1 ? (
                      demarche.organizations[0].name
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {demarche.organizations.map((org) => (
                          <li key={org.id}>{org.name}</li>
                        ))}
                      </ul>
                    )}
                  </Fact>
                )}
              </dl>
            )}
          </div>
        </aside>

        {hasContent && (
          <div className="flex flex-col gap-5 lg:col-start-1 lg:row-start-2">
            {/* Le descriptif est du MARKDOWN (contrat 1.24.0) : rendu en
                éléments, jamais injecté. */}
            {showDescription && (
              <section className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>{t("demarche.description")}</h2>
                <Markdown source={demarche.userDescription!} />
              </section>
            )}

            {/* ⚠️ La note est une phrase à LIRE, pas un filtre : les publics
                admis restent `audiences`, qui font foi en cas de
                contradiction — d'où leurs pastilles, sous la phrase. */}
            {showAudience && (
              <section className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>{t("demarche.audienceNote")}</h2>
                {audienceNote !== null && (
                  <p lang={collectiviteLang} className={"mt-3 " + BODY_CLASS}>
                    {audienceNote}
                  </p>
                )}
                {demarche.audiences.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {demarche.audiences.map((audience) => (
                      <li
                        key={audience}
                        className="rounded-full bg-[color:var(--pt-surface)] px-3 py-1 text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-ink)]"
                      >
                        {t(AUDIENCE_KEY[audience])}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {pieces.kind !== "none" && (
              <section className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>{t("demarche.attachments")}</h2>
                <ul lang={collectiviteLang} className="mt-4 flex flex-col gap-2.5">
                  {pieces.kind === "announced"
                    ? pieces.announced.map((piece, index) => (
                        <PieceItem key={index} label={piece.label} detail={piece.description} />
                      ))
                    : pieces.online.map((field) => (
                        <PieceItem
                          key={field.id}
                          label={field.label}
                          detail={
                            field.acceptedFormats.length > 0
                              ? field.acceptedFormats.map((f) => f.toUpperCase()).join(", ")
                              : null
                          }
                        />
                      ))}
                </ul>
                {/* Ce que le formulaire fera téléverser, nommé À PART : fondu
                    dans la liste, il ferait demander deux fois la même pièce ;
                    omis, il cacherait une pièce exigée au dépôt. */}
                {pieces.kind === "announced" && pieces.online.length > 0 && (
                  <p className={"mt-4 flex gap-2 " + NOTE_CLASS}>
                    <Icon size={16} className="mt-px">
                      {UPLOAD}
                    </Icon>
                    <span>
                      {t("demarche.attachmentsOnline")}{" "}
                      <span lang={collectiviteLang} className="font-semibold text-[color:var(--pt-ink)]">
                        {pieces.online.map((field) => field.label).join(" · ")}
                      </span>
                    </span>
                  </p>
                )}
                {pieces.kind === "form" && (
                  <p className={"mt-4 flex gap-2 " + NOTE_CLASS}>
                    <Icon size={16} className="mt-px">
                      {UPLOAD}
                    </Icon>
                    <span>{t("demarche.attachmentsInForm")}</span>
                  </p>
                )}
              </section>
            )}

            {/* La FAQ USAGER — jamais celle de l'agent, qui ne quitte pas le
                Socle. En dernier : elle répond à qui hésite encore. La
                première réponse est ouverte, pour montrer que les autres
                s'ouvrent. */}
            {faq.length > 0 && (
              <section className={CARD_CLASS}>
                <h2 className={SECTION_TITLE_CLASS}>{t("demarche.faq")}</h2>
                <div lang={collectiviteLang} className="mt-3 border-t border-[color:var(--pt-border)]">
                  {faq.map((entry, index) => (
                    <FaqItem key={index} entry={entry} defaultOpen={index === 0} />
                  ))}
                </div>
              </section>
            )}

            {/* Le second bouton, pour qui a tout lu : sans lui, il faudrait
                remonter le chercher. Absent quand la page n'a rien d'autre
                à lire — il doublerait celui de l'essentiel, juste au-dessus. */}
            {demarche.form !== null && (
              <section
                className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--pt-radius)] border p-[var(--pt-pad)]"
                style={{
                  background: "var(--pt-primary-soft)",
                  borderColor: "color-mix(in srgb, var(--pt-primary) 30%, transparent)",
                }}
              >
                <div>
                  <h2 className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
                    {t("demarche.readyTitle")}
                  </h2>
                  {demarche.estimatedMinutes !== null && (
                    <p className={"mt-1 " + NOTE_CLASS}>{t("card.duration", { n: demarche.estimatedMinutes })}</p>
                  )}
                </div>
                <StartLink to={formPath} />
              </section>
            )}
          </div>
        )}
      </div>
    </DemarcheShell>
  );
}

/** Une pièce : son intitulé, et sa précision (ou ses formats) dessous. */
function PieceItem({ label, detail }: { label: string; detail: string | null }) {
  return (
    <li className="flex gap-3 rounded-[var(--pt-radius-sm)] bg-[color:var(--pt-surface)] px-4 py-3">
      <span className="mt-0.5 text-[color:var(--pt-primary)]">
        <Icon size={18}>{FILE}</Icon>
      </span>
      <span>
        <span className="block text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">{label}</span>
        {detail !== null && <span className={"mt-0.5 block " + NOTE_CLASS}>{detail}</span>}
      </span>
    </li>
  );
}
