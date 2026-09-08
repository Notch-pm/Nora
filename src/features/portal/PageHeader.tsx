/**
 * L'en-tête du portail : la pastille (ou le logo) de la collectivité, son nom,
 * une navigation encore décorative, et le choix de la langue.
 *
 * ⚠️ **C'est le bloc que le thème habille le plus** : fond blanc ou coloré,
 * logo à gauche ou centré, menu en texte ou en pilules, bouton de compte mis en
 * avant ou discret, bandeau fixe ou non. Tout passe par les variables `--pt-*`
 * posées sur la page — ce composant ne reçoit le thème que pour ce qu'aucune
 * variable ne peut porter : le `position: sticky` et le choix du logo.
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
import { Link } from "react-router-dom";
import type { PortalTheme } from "@fn/_shared/domain/theme.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { languageName } from "@/i18n/languageNames.ts";
import { localizedPath } from "@/i18n/localizedPath.ts";

export function PageHeader({
  tenantName,
  logoUrl,
  theme,
  languages = [],
}: {
  tenantName: string;
  logoUrl: string | null;
  /**
   * Le thème du site. Facultatif : les écrans qui s'affichent avant que la
   * collectivité soit connue (attente, erreur) n'en ont pas — l'en-tête prend
   * alors les défauts posés dans `index.css`.
   */
  theme?: PortalTheme;
  /**
   * Les langues activées par la collectivité. Vide ou à une seule entrée : pas
   * de sélecteur — un choix sans alternative est une question sans objet.
   */
  languages?: readonly string[];
}) {
  const { lang, setLang } = useLanguage();
  const t = useT();

  const centered = theme?.header.logo === "center";
  return (
    <header
      className={
        "border-b " +
        // ⚠️ Le bandeau fixe ne se règle pas par une variable : `position` ne
        // peut pas être interpolée sans risquer une valeur inconnue. C'est le
        // seul réglage du thème que ce composant lit lui-même.
        (theme?.header.sticky === false ? "" : "sticky top-0 z-20 ")
      }
      style={{
        background: "var(--pt-header-surface)",
        color: "var(--pt-header-ink)",
        borderColor: "var(--pt-header-border)",
      }}
    >
      <div
        className={
          "mx-auto flex max-w-5xl px-6 py-4 " +
          (centered ? "flex-col items-center gap-2.5" : "items-center gap-3.5")
        }
      >
        {/* Le logo de la collectivité quand elle en a un ; sinon une pastille à
            sa couleur — la page reste reconnaissable sans image.
            Il ramène à l'accueil : c'est le geste attendu de tout site, et
            depuis une démarche, le chemin de retour de qui ne se sert pas du
            bouton « précédent ». L'image restant décorative, c'est le lien qui
            porte le nom lu par les lecteurs d'écran. */}
        {/* ⚠️ La marque et le nom dans UN conteneur : en logo centré la barre
            passe en colonne, et des enfants frères s'empileraient chacun sur sa
            ligne. Ce qu'on veut, c'est deux lignes — la marque, puis le reste. */}
        <div className="flex min-w-0 items-center gap-3.5">
          <Link
            to={localizedPath(lang, "/")}
            aria-label={t("header.home")}
            className="flex shrink-0 items-center rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] focus-visible:ring-offset-2"
          >
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-7 w-auto max-w-[160px] object-contain" />
            ) : (
              <div
                className="h-[26px] w-[26px] rounded-[var(--pt-radius-sm)]"
                style={{ background: "var(--pt-mark-bg)" }}
                aria-hidden="true"
              />
            )}
          </Link>
          <span className="truncate text-[length:var(--pt-h2)] font-extrabold tracking-tight">
            {tenantName}
          </span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3.5">
        {/* Décoratif : ces pages n'existent pas encore, ce ne sont pas des liens. */}
        <nav className="hidden items-center gap-2 sm:flex" aria-hidden="true">
          {[t("header.demarches"), t("header.contact")].map((label) => (
            <span
              key={label}
              className="whitespace-nowrap text-[length:var(--pt-small)]"
              style={{
                color: "var(--pt-header-muted)",
                background: "var(--pt-nav-bg)",
                padding: "var(--pt-nav-pad)",
                borderRadius: "var(--pt-nav-radius)",
              }}
            >
              {label}
            </span>
          ))}
        </nav>
        {/* ⚠️ Visible sur TOUS les formats, contrairement à la nav : c'est le
            seul élément qu'un visiteur qui ne lit pas le français doit pouvoir
            atteindre, et il le cherche d'abord sur son téléphone. */}
        {languages.length > 1 ? (
          <LanguageSelector languages={languages} value={lang} onChange={setLang} />
        ) : null}
        <span
          className="whitespace-nowrap rounded-[var(--pt-radius-sm)] border text-[length:var(--pt-small)] font-bold"
          style={{
            background: "var(--pt-account-bg)",
            color: "var(--pt-account-fg)",
            borderColor: "var(--pt-account-border)",
            padding: "var(--pt-account-pad)",
          }}
        >
          {t("header.account")}
        </span>
        </div>
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
  const t = useT();
  return (
    <label className="flex items-center gap-1.5">
      {/* La langue est lisible dans le contrôle lui-même : l'étiquette est là
          pour les lecteurs d'écran, pas pour occuper la barre. */}
      <span className="sr-only">{t("header.language")}</span>
      <select
        value={languages.includes(value) ? value : languages[0]}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-white px-2 py-1.5 text-[length:var(--pt-small)] text-[color:var(--pt-ink)] focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]"
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
