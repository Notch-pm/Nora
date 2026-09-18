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
 * pour moi (public concerné), que dois-je préparer (pièces), puis le bouton —
 * et la FAQ après lui, pour qui a encore un doute.
 *
 * ⚠️ **RIEN D'ÉCRIT, RIEN D'AFFICHÉ** : chaque section n'apparaît que si la
 * collectivité l'a remplie. Aucun texte n'est composé à sa place.
 *
 * ⚠️ **CES TEXTES NE SONT PAS TRADUITS** au Socle : servie dans une autre
 * langue, la page traduit ses titres, et marque le texte de la collectivité
 * `lang="fr"` (RGAA 8.7) pour qu'un lecteur d'écran le prononce correctement.
 */
import { useEffect } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { errorMessageFor } from "@/features/portal/errorMessages.ts";
import { Markdown } from "@/features/portal/Markdown.tsx";
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

const SECTION_TITLE_CLASS = "text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]";
const FACT_LABEL_CLASS =
  "text-[length:var(--pt-small)] font-bold uppercase tracking-wide text-[color:var(--pt-muted)]";


function BackToHome({ subtle = false }: { subtle?: boolean }) {
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
      className={
        subtle
          ? "text-[length:var(--pt-body)] font-semibold text-[color:var(--brand-primary)] hover:underline"
          : "rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] px-4 py-2 text-[length:var(--pt-body)] hover:bg-[color:var(--pt-surface)]"
      }
    >
      {t("demarche.backHome")}
    </Link>
  );
}

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

  return (
    <DemarcheShell
      tenantName={tenant.name}
      branding={branding}
      tenantBranding={tenantBranding}
      theme={tenant.theme}
      languages={tenant.languages}
      villes={villes}
    >
      <nav className="mb-6">
        <BackToHome subtle />
      </nav>

      <header className="flex flex-col gap-3">
        {demarche.category !== null && (
          <span className="w-fit rounded-full bg-[color:var(--pt-surface)] px-2.5 py-1 text-[length:var(--pt-small)] font-bold uppercase tracking-wide text-[color:var(--pt-muted)]">
            {demarche.category.name}
          </span>
        )}
        <h1 className="text-[length:var(--pt-h1)] font-extrabold tracking-tight text-[color:var(--pt-ink)]">{demarche.name}</h1>
        {demarche.description !== null && (
          <p className="text-[length:var(--pt-h2)] text-[color:var(--pt-muted)]">{demarche.description}</p>
        )}
      </header>

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y border-[color:var(--pt-border)] py-4">
        {/* ⚠️ Deux durées côte à côte, qui ne se déduisent pas l'une de
            l'autre : remplir le formulaire (minutes), obtenir une réponse
            (l'unité de la collectivité). Chaque étiquette nomme la sienne. */}
        {demarche.estimatedMinutes !== null && (
          <div>
            <dt className={FACT_LABEL_CLASS}>{t("demarche.fillDuration")}</dt>
            <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
              {t("card.duration", { n: demarche.estimatedMinutes })}
            </dd>
          </div>
        )}
        {responseDelay !== null && (
          <div>
            <dt className={FACT_LABEL_CLASS}>{t("demarche.responseDelay")}</dt>
            <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
              {responseDelayText(lang, responseDelay)}
            </dd>
          </div>
        )}
        {demarche.organizations.length > 0 && (
          <div>
            <dt className={FACT_LABEL_CLASS}>
              {tn("demarche.organizations", demarche.organizations.length)}
            </dt>
            <dd className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
              {demarche.organizations.map((org) => org.name).join(" · ")}
            </dd>
          </div>
        )}
      </dl>

      {/* Le descriptif est du MARKDOWN (contrat 1.24.0) : rendu en éléments,
          jamais injecté. Il n'est répété que s'il apporte autre chose que le
          résumé de l'en-tête. */}
      {demarche.userDescription !== null && demarche.userDescription !== demarche.description && (
        <div className="mt-3">
          <Markdown source={demarche.userDescription} />
        </div>
      )}

      {/* ⚠️ Une phrase à LIRE, pas un filtre : les publics admis restent
          `audiences`, qui font foi en cas de contradiction. */}
      {audienceNote !== null && (
        <section className="mt-8">
          <h2 className={SECTION_TITLE_CLASS}>{t("demarche.audienceNote")}</h2>
          <p lang={collectiviteLang} className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
            {audienceNote}
          </p>
        </section>
      )}

      {pieces.kind !== "none" && (
        <section className="mt-8">
          <h2 className={SECTION_TITLE_CLASS}>{t("demarche.attachments")}</h2>
          {pieces.kind === "announced" ? (
            <>
              <ul lang={collectiviteLang} className="mt-3 flex flex-col gap-2">
                {pieces.announced.map((piece, index) => (
                  <li key={index} className="flex gap-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                    <span aria-hidden="true" className="text-[color:var(--pt-muted)]">
                      •
                    </span>
                    <span>
                      {piece.label}
                      {piece.description !== null && (
                        <span className="block text-[color:var(--pt-muted)]">{piece.description}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {/* Ce que le formulaire fera téléverser, nommé À PART : fondu
                  dans la liste, il ferait demander deux fois la même pièce ;
                  omis, il cacherait une pièce exigée au dépôt. */}
              {pieces.online.length > 0 && (
                <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
                  {t("demarche.attachmentsOnline")}{" "}
                  <span lang={collectiviteLang}>{pieces.online.map((field) => field.label).join(" · ")}</span>
                </p>
              )}
            </>
          ) : (
            <>
              <ul lang={collectiviteLang} className="mt-3 flex flex-col gap-2">
                {pieces.online.map((field) => (
                  <li key={field.id} className="flex gap-2 text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                    <span aria-hidden="true" className="text-[color:var(--pt-muted)]">
                      •
                    </span>
                    <span>
                      {field.label}
                      {field.acceptedFormats.length > 0 && (
                        <span className="text-[color:var(--pt-muted)]">
                          {" "}
                          ({field.acceptedFormats.map((f) => f.toUpperCase()).join(", ")})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("demarche.attachmentsInForm")}</p>
            </>
          )}
        </section>
      )}

      <div className="mt-10">
        {demarche.form === null ? (
          // Une démarche sans formulaire n'est pas une erreur : elle est
          // publiée, sa saisie n'est simplement pas encore paramétrée. Le dire
          // vaut mieux qu'un bouton qui mène à une page vide.
          <p className="rounded-[var(--pt-radius-sm)] border border-dashed border-[color:var(--pt-border)] px-4 py-5 text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
            {t("demarche.notOnline")}
          </p>
        ) : (
          <Link
            to={organismePath(
              lang,
              organisme,
              "/demarches/" + encodeURIComponent(demarche.id) + "/formulaire",
            )}
            className="inline-flex rounded-[var(--pt-radius-sm)] bg-[color:var(--brand-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-white hover:opacity-90"
          >
            {t("demarche.start")}
          </Link>
        )}
      </div>

      {/* La FAQ USAGER — jamais celle de l'agent, qui ne quitte pas le Socle.
          Après le bouton : elle répond à qui hésite encore, sans retarder qui
          sait déjà. Les questions sont des titres, pour qu'un lecteur d'écran
          passe de l'une à l'autre. */}
      {faq.length > 0 && (
        <section className="mt-12">
          <h2 className={SECTION_TITLE_CLASS}>{t("demarche.faq")}</h2>
          <div lang={collectiviteLang}>
            {faq.map((entry, index) => (
              <div key={index} className="mt-5">
                <h3 className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">{entry.question}</h3>
                <p className="mt-1 whitespace-pre-line text-[length:var(--pt-body)] leading-relaxed text-[color:var(--pt-ink)]">
                  {entry.answer}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </DemarcheShell>
  );
}
