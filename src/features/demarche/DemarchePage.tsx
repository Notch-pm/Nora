/**
 * La page d'une démarche : ce qu'elle est, avant de la remplir.
 *
 * L'usager lit d'abord, s'engage ensuite — c'est le geste des portails de
 * service public, et il évite d'ouvrir un mur de champs à quelqu'un qui ne
 * sait pas encore ce qu'on va lui demander. « Commencer la démarche » mène au
 * formulaire, qui a alors l'écran pour lui seul.
 *
 * Les pièces attendues sont déduites du formulaire lui-même (ses champs
 * « pièce justificative ») : la collectivité les a paramétrées une fois, elles
 * n'ont pas à être ressaisies ailleurs pour être annoncées ici.
 */
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { allFields } from "@fn/_shared/domain/formSchema.ts";
import { DemarcheError, DemarcheLoading, DemarcheShell } from "./DemarcheShell.tsx";
import { useDemarche } from "./useDemarche.ts";
import { useLanguage } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";


function BackToHome({ subtle = false }: { subtle?: boolean }) {
  const { lang } = useLanguage();
  return (
    <Link
      to={localizedPath(lang, "/")}
      className={
        subtle
          ? "text-sm font-semibold text-[color:var(--brand-primary)] hover:underline"
          : "rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50"
      }
    >
      Retour à l'accueil
    </Link>
  );
}

export function DemarchePage() {
  const { demarcheId = "" } = useParams();
  const { lang, serve } = useLanguage();
  const { state, retry } = useDemarche(demarcheId, lang);

  // Le serveur a tranché la langue : l'adresse s'y aligne (voir `PortalPage`).
  const served = state.status === "ready" ? state.snapshot.lang : null;
  useEffect(() => {
    if (served !== null) serve(served);
  }, [served, serve]);

  if (state.status === "loading") return <DemarcheLoading />;
  if (state.status === "error") {
    return (
      <DemarcheError reason={state.reason} onRetry={retry}>
        <BackToHome />
      </DemarcheError>
    );
  }

  const { tenant, demarche, branding } = state.snapshot;
  const attachments =
    demarche.form === null
      ? []
      : allFields(demarche.form).filter((field) => field.type === "attachment");

  return (
    <DemarcheShell tenantName={tenant.name} branding={branding} languages={tenant.languages}>
      <nav className="mb-6">
        <BackToHome subtle />
      </nav>

      <header className="flex flex-col gap-3">
        {demarche.category !== null && (
          <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">
            {demarche.category.name}
          </span>
        )}
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{demarche.name}</h1>
        {demarche.description !== null && (
          <p className="text-lg text-slate-600">{demarche.description}</p>
        )}
      </header>

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-y border-slate-200 py-4">
        {demarche.estimatedMinutes !== null && (
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">Durée</dt>
            <dd className="text-sm text-slate-800">Environ {demarche.estimatedMinutes} minutes</dd>
          </div>
        )}
        {demarche.organizations.length > 0 && (
          <div>
            <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">
              {demarche.organizations.length > 1 ? "Organismes" : "Organisme"}
            </dt>
            <dd className="text-sm text-slate-800">
              {demarche.organizations.map((org) => org.name).join(" · ")}
            </dd>
          </div>
        )}
      </dl>

      {/* Le descriptif usager est saisi en texte libre au Socle : les sauts de
          ligne de son auteur sont conservés, c'est sa seule mise en forme.
          Il n'est répété que s'il apporte autre chose que le résumé — sans
          résumé, `description` EST déjà ce descriptif. */}
      {demarche.userDescription !== null && demarche.userDescription !== demarche.description && (
        <p className="mt-6 whitespace-pre-line text-slate-700">{demarche.userDescription}</p>
      )}

      {attachments.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-bold text-slate-900">Pièces à fournir</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {attachments.map((field) => (
              <li key={field.id} className="flex gap-2 text-sm text-slate-700">
                <span aria-hidden="true" className="text-slate-400">
                  •
                </span>
                <span>
                  {field.label}
                  {field.type === "attachment" && field.acceptedFormats.length > 0 && (
                    <span className="text-slate-500">
                      {" "}
                      ({field.acceptedFormats.map((f) => f.toUpperCase()).join(", ")})
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-500">
            Le dépôt des pièces n'est pas encore ouvert : votre collectivité vous les demandera
            après l'envoi de votre demande.
          </p>
        </section>
      )}

      <div className="mt-10">
        {demarche.form === null ? (
          // Une démarche sans formulaire n'est pas une erreur : elle est
          // publiée, sa saisie n'est simplement pas encore paramétrée. Le dire
          // vaut mieux qu'un bouton qui mène à une page vide.
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-600">
            Cette démarche ne peut pas encore être remplie en ligne. Rapprochez-vous de votre
            collectivité pour l'effectuer.
          </p>
        ) : (
          <Link
            to={localizedPath(lang, "/demarches/" + encodeURIComponent(demarche.id) + "/formulaire")}
            className="inline-flex rounded-lg bg-[color:var(--brand-primary)] px-5 py-3 text-sm font-bold text-white hover:opacity-90"
          >
            Commencer la démarche
          </Link>
        )}
      </div>
    </DemarcheShell>
  );
}
