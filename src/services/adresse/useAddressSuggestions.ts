/**
 * Les propositions d'adresse pendant la frappe — le seul point du portail qui
 * parle à un service hors de `portal-api` (voir l'en-tête de `ban.ts`).
 *
 * Trois garde-fous, sans bibliothèque :
 *  • un délai (`SEARCH_DEBOUNCE_MS`) entre la dernière touche et la requête ;
 *  • l'annulation de la requête en cours dès que la saisie change ou que le
 *    champ disparaît — sans elle, une réponse lente à « 10 rue » écraserait
 *    celle, plus récente, de « 10 rue de la p » ;
 *  • un cache court par URL : une lettre tapée puis effacée ne refait pas la
 *    requête.
 *
 * Toute panne est muette : `error` passe à vrai, la liste reste vide, l'usager
 * continue de taper. L'assistance est un confort, jamais une porte.
 */
import * as React from "react";
import { addressSearchUrl, geocodeUrl, parseAddressSuggestions, SEARCH_DEBOUNCE_MS, type AddressSuggestion } from "./ban.ts";

const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { at: number; suggestions: AddressSuggestion[] }>();

function cached(url: string): AddressSuggestion[] | null {
  const entry = cache.get(url);
  if (entry === undefined) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(url);
    return null;
  }
  return entry.suggestions;
}

export interface AddressSuggestionsState {
  suggestions: AddressSuggestion[];
  /** Une requête est en cours pour la saisie affichée. */
  loading: boolean;
  /** Le service n'a pas répondu, ou mal : la saisie libre est la seule voie. */
  error: boolean;
  /** La frappe est en avance sur les propositions affichées (délai pas encore écoulé). */
  stale: boolean;
}

const IDLE: AddressSuggestionsState = { suggestions: [], loading: false, error: false, stale: false };

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * @param query   la saisie courante ;
 * @param enabled `false` gèle tout — après un choix dans la liste, par exemple,
 *                pour ne pas réinterroger la BAN avec le libellé complet.
 */
export function useAddressSuggestions(query: string, enabled: boolean): AddressSuggestionsState {
  // ⚠️ C'est le COUPLE (saisie, activation) qui passe par le délai, pas la
  // saisie seule. Sinon, retaper juste après un choix réactivait la recherche
  // alors que la valeur retardée était encore le libellé choisi — et une
  // requête partait pour une adresse déjà connue (vu le 2026-09-22).
  const wanted = enabled ? query : null;
  const debounced = useDebounced(wanted, SEARCH_DEBOUNCE_MS);
  const url = debounced === null ? null : addressSearchUrl(debounced, geocodeUrl());
  const [state, setState] = React.useState<{ url: string; result: AddressSuggestionsState }>({ url: "", result: IDLE });

  React.useEffect(() => {
    if (url === null) return;
    const hit = cached(url);
    if (hit !== null) {
      setState({ url, result: { suggestions: hit, loading: false, error: false, stale: false } });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({
      url,
      // Les propositions précédentes restent affichées pendant la requête :
      // une liste qui clignote à chaque lettre se lit mal.
      result: { ...previous.result, loading: true, error: false, stale: false },
    }));
    fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseAddressSuggestions(await response.json());
      })
      .then((suggestions) => {
        cache.set(url, { at: Date.now(), suggestions });
        setState({ url, result: { suggestions, loading: false, error: false, stale: false } });
      })
      .catch((cause: unknown) => {
        // Une requête annulée n'est pas une panne : la suivante a pris sa place.
        if (controller.signal.aborted) return;
        void cause;
        setState({ url, result: { suggestions: [], loading: false, error: true, stale: false } });
      });
    return () => controller.abort();
  }, [url]);

  if (url === null) return IDLE;
  // La saisie a changé depuis la requête dont on tient les résultats.
  const stale = debounced !== wanted || state.url !== url;
  return state.url === url ? { ...state.result, stale } : { ...state.result, loading: true, stale };
}
