/**
 * L'envoi de la mesure de fréquentation, depuis le navigateur.
 *
 * ⚠️ CE HOOK NE RENVOIE RIEN ET N'AFFICHE RIEN. Un échec est un silence : la
 * page du visiteur ne dépend d'aucun compteur, et ne doit jamais l'attendre.
 *
 * ⚠️ RIEN N'EST ÉCRIT DANS LE STOCKAGE DU NAVIGATEUR — voir l'en-tête de
 * `pageView.ts`. La déduplication vit dans une `ref` de React, qui meurt avec
 * l'onglet.
 *
 * ⚠️ IL EST MONTÉ DANS `LanguageLayout`, le seul point commun aux trois écrans.
 * Piège que ça implique, et qui a dicté la forme de ce hook : le layout
 * déclenche jusqu'à DEUX `navigate(replace)` par chargement (la
 * canonicalisation de `/fr/…` vers `/…`, puis l'alignement de `serve()` sur la
 * langue réellement servie). Un effet branché naïvement sur `location.pathname`
 * compterait donc la même page deux fois. La `ref` de déduplication le règle :
 * elle retient la clé de page, indépendante de la langue.
 */

import * as React from "react";
import { useLocation } from "react-router-dom";
import { isArrival, pageKey, pageOf } from "./pageView.ts";

/**
 * L'envoi lui-même. Exporté pour les tests ; il ne lève jamais.
 *
 * ⚠️ `text/plain` : c'est une requête « SIMPLE » au sens du CORS, donc **sans
 * requête préalable OPTIONS**. Un seul appel réseau par page vue, pas deux —
 * et c'est ce qui rend la mesure assez légère pour être faite à chaque écran.
 * Le corps reste du JSON ; `portal-api` le lit lui-même.
 *
 * `keepalive` : l'envoi survit à une navigation immédiate. Sans lui, un
 * visiteur qui clique aussitôt perdrait la page qu'il vient de voir.
 */
export async function sendPageView(
  body: { page: string; demarcheId: string | null; entry: boolean },
  lang: string,
): Promise<void> {
  const baseUrl = import.meta.env.VITE_PORTAL_API_URL;
  if (!baseUrl) return;
  try {
    await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/audience?lang=${encodeURIComponent(lang)}`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Un compteur ne fait pas de bruit.
  }
}

/**
 * Faut-il mesurer dans ce contexte ?
 *
 * ⚠️ JAMAIS EN DÉVELOPPEMENT, JAMAIS SOUS PILOTAGE. Un agent qui met au point
 * la page d'accueil de sa collectivité, ou un test de bout en bout qui la
 * parcourt, gonfleraient des chiffres qu'un élu lira comme de la
 * fréquentation réelle. `navigator.webdriver` est posé par Playwright,
 * Selenium et consorts.
 */
function shouldMeasure(): boolean {
  if (!import.meta.env.PROD) return false;
  return !(typeof navigator !== "undefined" && navigator.webdriver);
}

export function useAudience(lang: string): void {
  const location = useLocation();
  // Ce qui a déjà été compté dans cet onglet, et si l'arrivée est passée.
  const counted = React.useRef<string | null>(null);
  const arrived = React.useRef(false);

  React.useEffect(() => {
    if (!shouldMeasure()) return;

    const identity = pageOf(location.pathname);
    // Une adresse qui ne désigne aucun des trois écrans ne se compte pas —
    // y compris pendant la redirection de `/fr/…` vers `/…`, où le chemin est
    // transitoire.
    if (identity === null) return;

    const key = pageKey(identity);
    if (counted.current === key) return;
    counted.current = key;

    // ⚠️ L'ARRIVÉE NE SE COMPTE QU'UNE FOIS PAR ONGLET, et seulement sur la
    // première page mesurée : au-delà, c'est une navigation interne, quoi que
    // dise le référent (React Router ne le met pas à jour d'un écran à l'autre,
    // et il continuerait d'annoncer le site d'où le visiteur est venu).
    let entry = false;
    if (!arrived.current) {
      arrived.current = true;
      const navigation = typeof performance !== "undefined"
        ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)
        : undefined;
      entry = isArrival({
        referrer: document.referrer,
        host: currentHost(),
        navigationType: navigation?.type ?? null,
      });
    }

    void sendPageView({ page: identity.page, demarcheId: identity.demarcheId, entry }, lang);
  }, [location.pathname, lang]);
}

function currentHost(): string {
  return typeof window === "undefined" ? "" : window.location.host;
}
