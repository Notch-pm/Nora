/**
 * La langue du visiteur, portée par l'application.
 *
 * Trois sources, dans cet ordre : **l'adresse** (explicite, partageable,
 * indexable), la **mémoire du navigateur** (pour la visite suivante), le
 * **français** à défaut. Aucune détection automatique — `navigator.language`
 * dirait la langue du téléphone, pas celle que la personne veut lire sur le
 * site de sa mairie, et une page publique doit s'ouvrir de façon prévisible.
 *
 * ⚠️ CE QUI EST DEMANDÉ N'EST PAS CE QUI EST SERVI. Le serveur seul sait ce que
 * la collectivité a activé : il clampe et **renvoie la langue servie**. Les
 * écrans appellent alors `serve()`, qui remet l'adresse d'accord avec ce qui
 * est affiché. Sans ça, une langue mémorisée puis désactivée par la
 * collectivité serait redemandée à chaque visite, et l'adresse mentirait.
 */
import * as React from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { isRtl } from "@fn/_shared/domain/languages.ts";
import { useAudience } from "@/services/audience/useAudience.ts";
import { localizedPath, PIVOT_LANGUAGE, splitLangPath } from "./localizedPath.ts";
import { t, tn } from "./t.ts";
import type { StringKey } from "./strings.ts";

interface LanguageState {
  /** La langue demandée — celle dans laquelle on charge. */
  lang: string;
  /** Choix du visiteur : l'adresse change, et l'historique le garde. */
  setLang: (next: string) => void;
  /** Le serveur a tranché : l'adresse s'aligne, sans entrée d'historique. */
  serve: (served: string) => void;
}

const LanguageContext = React.createContext<LanguageState>({
  lang: PIVOT_LANGUAGE,
  setLang: () => {},
  serve: () => {},
});

export function useLanguage(): LanguageState {
  return React.useContext(LanguageContext);
}

/**
 * Traduit un texte de l'interface dans la langue courante.
 *
 * `t` reste PURE et prend la langue en argument — c'est ce qui se teste. Ce
 * hook n'est que le raccourci des composants, pour ne pas faire descendre
 * `lang` à travers chaque niveau de rendu.
 */
export function useT(): (key: StringKey, params?: Record<string, string | number>) => string {
  const { lang } = useLanguage();
  return React.useCallback(
    (key: StringKey, params?: Record<string, string | number>) => t(lang, key, params),
    [lang],
  );
}

/** Le pluriel, dans la langue courante (voir `tn`). */
export function useTn(): (base: string, count: number, params?: Record<string, string | number>) => string {
  const { lang } = useLanguage();
  return React.useCallback(
    (base: string, count: number, params: Record<string, string | number> = {}) =>
      tn(lang, base, count, params),
    [lang],
  );
}

const STORAGE_KEY = "nora.lang";

/**
 * ⚠️ `localStorage` LÈVE en navigation privée sur certains navigateurs, et
 * quand les données de site sont bloquées. Un portail public ne peut pas
 * s'écrouler là-dessus : l'échec vaut « pas de mémoire », rien de plus.
 */
function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(lang: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Pas de mémoire : la visite se passe quand même, l'adresse suffit.
  }
}

export function LanguageLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { lang: urlLang, path } = splitLangPath(location.pathname);

  const [lang, setLangState] = React.useState<string>(
    () => urlLang ?? readStored() ?? PIVOT_LANGUAGE,
  );

  // L'adresse fait foi quand elle porte une langue : navigation arrière,
  // lien collé, nouvel onglet.
  React.useEffect(() => {
    if (urlLang !== null && urlLang !== lang) setLangState(urlLang);
  }, [urlLang, lang]);

  // `/fr/…` n'existe pas : une seule forme canonique par page.
  React.useEffect(() => {
    if (urlLang === PIVOT_LANGUAGE) {
      navigate(path + location.search + location.hash, { replace: true });
    }
  }, [urlLang, path, location.search, location.hash, navigate]);

  // La langue de la page, pour les technologies d'assistance et pour le sens
  // d'écriture (RGAA 8.3). ⚠️ `dir` corrige le TEXTE et la SAISIE, pas le
  // placement : les utilitaires Tailwind sont physiques (`ml-`, `text-left`) et
  // ne se miroitent pas. Le miroir complet est un chantier de mise en page.
  React.useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = isRtl(lang) ? "rtl" : "ltr";
  }, [lang]);

  const go = React.useCallback(
    (next: string, replace: boolean) => {
      writeStored(next);
      setLangState(next);
      const target = localizedPath(next, path) + location.search + location.hash;
      if (target !== location.pathname + location.search + location.hash) {
        navigate(target, { replace });
      }
    },
    [navigate, path, location.pathname, location.search, location.hash],
  );

  // La fréquentation, comptée sans cookie. Posée ICI parce que ce layout est le
  // seul point commun aux trois écrans ; il voit donc passer toutes les
  // navigations. Le hook ne rend rien et n'affiche rien — voir son en-tête pour
  // le piège des deux `navigate(replace)` ci-dessus.
  useAudience(lang);

  const value = React.useMemo<LanguageState>(
    () => ({
      lang,
      setLang: (next: string) => go(next, false),
      // Toujours, même quand la langue ne change pas : c'est aussi ce qui pose
      // le préfixe quand la langue venait de la mémoire et pas de l'adresse.
      serve: (served: string) => go(served, true),
    }),
    [lang, go],
  );

  return (
    <LanguageContext.Provider value={value}>
      <Outlet />
    </LanguageContext.Provider>
  );
}
