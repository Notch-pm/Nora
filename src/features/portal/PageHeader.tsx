/**
 * L'en-tête du portail : la pastille (ou le logo) de la collectivité, son nom,
 * une navigation, et le choix de la langue.
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
 * ce qui met le sélecteur de langue sur les quatre écrans d'un coup.
 *
 * « Mon compte » reste décoratif tant que l'espace usager n'existe pas —
 * mieux vaut du gris inerte qu'un lien mort. « Contact » de même. Le premier
 * élément de la nav, lui, est réellement interactif dès qu'il y a au moins une
 * ville : voir « Ma ville » plus bas.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { PortalTheme } from "@fn/_shared/domain/theme.ts";
import type { Ville } from "@fn/_shared/domain/demarche.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { languageName } from "@/i18n/languageNames.ts";
import { localizedPath, organismePath, splitScopedPath } from "@/i18n/localizedPath.ts";

export function PageHeader({
  tenantName,
  logoUrl,
  theme,
  languages = [],
  villes = [],
  singleLine = false,
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
  /**
   * Les villes de la collectivité — les organismes qui ont leur propre page —
   * déjà triées par nom. Vide = pas de menu « Ma ville » : la nav reste alors
   * exactement celle d'avant ce menu (deux étiquettes décoratives).
   */
  villes?: Ville[];
  /**
   * ⚠️ VRAI SUR UNE PAGE DE VILLE, ET NULLE PART AILLEURS. Cette page veut
   * marque + nav + langue + compte sur UNE LIGNE — trouver « Ma ville » ne
   * doit pas dépendre d'un défilement. Un thème qui centre le logo (ACCM)
   * empile aujourd'hui ces blocs sur deux lignes par défaut : pertinent pour
   * un accueil composé, plus pour une page qui doit avant tout rendre ce menu
   * facile à trouver. Cette prop lève ce centrage pour CETTE page seulement ;
   * les trois autres écrans gardent le rendu du thème tel quel. Le repli à
   * deux lignes quand la largeur manque se fait par un simple retour à la
   * ligne CSS (`flex-wrap`), jamais par une media query en JavaScript.
   */
  singleLine?: boolean;
}) {
  const { lang, setLang } = useLanguage();
  const t = useT();
  const location = useLocation();
  const currentOrganisme = splitScopedPath(location.pathname).organisme;
  // La marque ramène à l'accueil de la COLLECTIVITÉ, sur tous les écrans.
  //
  // ⚠️ Elle a un temps dépendu du périmètre, et c'était juste tant que le
  // bandeau affichait le nom et le logo de la mairie visitée : l'y renvoyer
  // était le geste attendu. La marque dit désormais sur quel SITE on est — la
  // ville, elle, est nommée dans le bloc d'identification de sa page. Cliquer
  // la marque, c'est donc revenir au portail de la collectivité ; pour aller
  // dans une ville, il y a « Ma ville » juste à côté.
  const home = localizedPath(lang, "/");

  const hasVilles = villes.length > 0;
  const [villesOpen, setVillesOpen] = useState(false);
  const villesTriggerRef = useRef<HTMLButtonElement>(null);
  const villesPanelRef = useRef<HTMLDivElement>(null);
  const villesPanelId = useId();

  // Un panneau ouvert qui survit à la navigation choisie DEDANS serait un
  // bandeau qui reste déroulé sur la page qu'on vient d'atteindre.
  useEffect(() => {
    setVillesOpen(false);
  }, [location.pathname]);

  // Échap referme et rend le focus au déclencheur — sans quoi le clavier
  // perdrait sa place. Un clic hors du bouton et du panneau referme sans
  // déplacer le focus : l'attention du visiteur est déjà ailleurs.
  useEffect(() => {
    if (!villesOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setVillesOpen(false);
      villesTriggerRef.current?.focus();
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (villesTriggerRef.current?.contains(target)) return;
      if (villesPanelRef.current?.contains(target)) return;
      setVillesOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [villesOpen]);

  const themeCentered = theme?.header.logo === "center";
  const centered = themeCentered && !singleLine;

  const navPillStyle: CSSProperties = {
    color: "var(--pt-header-muted)",
    background: "var(--pt-nav-bg)",
    padding: "var(--pt-nav-pad)",
    borderRadius: "var(--pt-nav-radius)",
  };

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
          (centered
            ? "flex-col items-center gap-2.5"
            : "items-center gap-3.5" + (singleLine ? " flex-wrap" : ""))
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
            to={home}
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
        {/* Décorative sauf son premier élément : « Ma ville » est un vrai
            bouton dès qu'il y a au moins une ville, et le seul lien réel de
            cette barre. `aria-hidden` ne porte donc plus sur la `<nav>`
            entière — la masquer masquerait aussi ce bouton — mais sur chaque
            étiquette qui reste un texte inerte. */}
        {/* ⚠️ LA NAV RESTE AFFICHÉE SUR TÉLÉPHONE quand elle porte « Ma ville » —
            seules les étiquettes inertes se retirent (`NavPill`). La même
            raison que pour le sélecteur de langue juste en dessous : c'est un
            vrai chemin, et le téléphone est précisément l'appareil de
            quelqu'un qui vient de lire l'adresse d'une mairie sur une affiche.
            Sans ville, la nav redevient ce qu'elle était : décorative, donc
            masquée sous `sm`. */}
        <nav
          className={
            "items-center gap-2 " + (hasVilles ? "flex" : "hidden sm:flex")
          }
          aria-hidden={hasVilles ? undefined : true}
        >
          {hasVilles ? (
            <button
              type="button"
              ref={villesTriggerRef}
              aria-expanded={villesOpen}
              aria-controls={villesPanelId}
              onClick={() => setVillesOpen((open) => !open)}
              className="inline-flex items-center gap-1 whitespace-nowrap text-[length:var(--pt-small)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] focus-visible:ring-offset-1"
              style={navPillStyle}
            >
              {t("header.maVille")}
              <ChevronIcon open={villesOpen} />
            </button>
          ) : (
            <NavPill style={navPillStyle}>{t("header.demarches")}</NavPill>
          )}
          <NavPill style={navPillStyle}>{t("header.contact")}</NavPill>
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

      {/* Le bandeau déroulant : PLEINE LARGEUR sous l'en-tête, pas une petite
          liste flottante — c'est le mot de Laurent. Il vit dans CE `<header>`
          (donc dans le même bandeau fixe que la marque) plutôt qu'à côté :
          s'il défilait avec la page pendant que l'en-tête reste collé en haut,
          il disparaîtrait sous lui au premier défilement. */}
      {hasVilles && villesOpen && (
        <div
          id={villesPanelId}
          ref={villesPanelRef}
          className="border-t"
          style={{ borderColor: "var(--pt-header-border)" }}
        >
          <div className="mx-auto max-w-5xl px-6 py-4">
            <ul
              aria-label={t("header.maVille")}
              // Trois colonnes au plus : à quatre, les noms de communes se
              // faisaient tronquer — « Mairie de Saint Martin de Cr… » ne se lit
              // pas, et c'est précisément ce qu'on vient chercher dans ce menu.
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {villes.map((ville) => (
                <VilleTile key={ville.id} ville={ville} lang={lang} current={ville.slug === currentOrganisme} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </header>
  );
}

/** Une étiquette de navigation décorative — la pilule du thème, texte inerte. */
function NavPill({ children, style }: { children: ReactNode; style: CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      // Inerte : elle ne s'affiche qu'à partir de `sm`, là où il reste de la
      // place pour du texte qui ne mène nulle part.
      className="hidden whitespace-nowrap text-[length:var(--pt-small)] sm:inline"
      style={style}
    >
      {children}
    </span>
  );
}

/** Le chevron du déclencheur « Ma ville » — décoratif, l'état est dit par `aria-expanded`. */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
      className={"shrink-0 " + (open ? "rotate-180" : "")}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Une entrée du bandeau « Ma ville » : logo (ou pastille) et nom, l'entrée
 * entière cliquable. `alt=""` : le nom, juste à côté, est déjà ce qu'un
 * lecteur d'écran doit lire — l'image n'apporte rien de plus.
 */
function VilleTile({ ville, lang, current }: { ville: Ville; lang: string; current: boolean }) {
  return (
    <li>
      <Link
        to={organismePath(lang, ville.slug, "/")}
        aria-current={current ? "page" : undefined}
        className={
          "flex items-center gap-2.5 rounded-[var(--pt-radius-sm)] border p-2.5 text-[length:var(--pt-small)] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] " +
          (current
            ? "border-[color:var(--pt-primary)]"
            : "border-[color:var(--pt-border)] hover:border-[color:var(--pt-primary)]")
        }
        style={{
          color: "var(--pt-header-ink)",
          background: current ? "var(--pt-primary-soft)" : "transparent",
        }}
      >
        {ville.logoUrl ? (
          <img
            src={ville.logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-[var(--pt-radius-sm)] object-contain"
          />
        ) : (
          <div
            className="h-8 w-8 shrink-0 rounded-[var(--pt-radius-sm)]"
            style={{ background: "var(--pt-mark-bg)" }}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{ville.name}</span>
      </Link>
    </li>
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
