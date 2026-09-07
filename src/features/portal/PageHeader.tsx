/**
 * L'en-tête du portail : la pastille (ou le logo) de la collectivité, son nom,
 * une navigation encore décorative, et le choix de la langue.
 *
 * Partagé par la page d'accueil composée et par les pages d'une démarche : un
 * usager qui commence une démarche ne doit pas avoir l'impression de quitter le
 * site de sa collectivité. C'est la seule raison pour laquelle ce composant
 * vit dans son propre fichier plutôt que dans la composition — et c'est aussi
 * ce qui met le sélecteur de langue sur les trois écrans d'un coup.
 *
 * La nav et « Mon compte » restent décoratifs tant qu'aucune de ces pages
 * n'existe — mieux vaut du gris inerte qu'un lien mort.
 */
import { useLanguage } from "@/i18n/LanguageLayout.tsx";
import { languageName } from "@/i18n/languageNames.ts";

export function PageHeader({
  tenantName,
  logoUrl,
  languages = [],
}: {
  tenantName: string;
  logoUrl: string | null;
  /**
   * Les langues activées par la collectivité. Vide ou à une seule entrée : pas
   * de sélecteur — un choix sans alternative est une question sans objet.
   */
  languages?: readonly string[];
}) {
  const { lang, setLang } = useLanguage();

  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-5xl items-center gap-3.5 px-6 py-4">
        {/* Le logo de la collectivité quand elle en a un ; sinon une pastille à
            sa couleur — la page reste reconnaissable sans image. */}
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-7 w-auto max-w-[160px] shrink-0 object-contain" />
        ) : (
          <div
            className="h-[26px] w-[26px] shrink-0 rounded-md bg-[color:var(--brand-primary)]"
            aria-hidden="true"
          />
        )}
        <span className="text-sm font-extrabold tracking-tight text-slate-900">{tenantName}</span>
        <div className="flex-1" />
        {/* Décoratif : ces pages n'existent pas encore, ce ne sont pas des liens. */}
        <div className="hidden items-center gap-4 sm:flex" aria-hidden="true">
          <span className="text-sm text-slate-500">Démarches</span>
          <span className="text-sm text-slate-500">Contact</span>
        </div>
        {/* ⚠️ Visible sur TOUS les formats, contrairement à la nav : c'est le
            seul élément qu'un visiteur qui ne lit pas le français doit pouvoir
            atteindre, et il le cherche d'abord sur son téléphone. */}
        {languages.length > 1 ? (
          <LanguageSelector languages={languages} value={lang} onChange={setLang} />
        ) : null}
        <span className="rounded-full border border-[color:var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-[color:var(--brand-primary)]">
          Mon compte
        </span>
      </div>
    </header>
  );
}

/**
 * Le choix de la langue.
 *
 * ⚠️ CHAQUE LANGUE EST ÉCRITE DANS SA PROPRE LANGUE (`languageName`), jamais en
 * français : quelqu'un qui ne lit pas le français cherche « English » ou
 * « العربية », pas « Anglais ». Le catalogue du Socle, lui, nomme les langues
 * en français — c'est juste pour l'agent qui paramètre, et inutile ici.
 *
 * Un `<select>` natif : accessible au clavier et aux lecteurs d'écran sans une
 * ligne de plus, utilisable sur mobile, et sans dépendance — Nora n'a aucune
 * bibliothèque de composants, et une liste déroulante maison serait le premier
 * endroit où l'accessibilité se perdrait.
 */
function LanguageSelector({
  languages,
  value,
  onChange,
}: {
  languages: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5">
      {/* La langue est lisible dans le contrôle lui-même : l'étiquette est là
          pour les lecteurs d'écran, pas pour occuper la barre. */}
      <span className="sr-only">Langue</span>
      <select
        value={languages.includes(value) ? value : languages[0]}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]"
      >
        {languages.map((code) => (
          <option key={code} value={code} lang={code}>
            {languageName(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
