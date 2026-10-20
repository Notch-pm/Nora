/**
 * Lectures LANCÉES AU DÉMARRAGE, avant que la collectivité soit chargée.
 *
 * Les écrans du compte n'existent qu'une fois `/v1/bootstrap` reçu (la charte,
 * la langue) ; ils ne demandaient donc la session et leurs données qu'après
 * lui — deux allers-retours bout à bout, environ une seconde de plus à chaque
 * page (recette du 2026-10-20). Ces lectures ne dépendent pas du bootstrap :
 * `main.tsx` les part en même temps que lui, et l'écran prend la réponse déjà
 * en route au lieu d'en demander une nouvelle.
 *
 * Une réponse n'est servie QU'UNE fois (`takeEarly`) : « Réessayer », un
 * retour sur la page ou une lecture suivante repartent toujours au serveur.
 * Rien n'est écrit sur le poste ; une erreur est rendue telle quelle à
 * l'écran, qui la traite comme s'il avait lui-même posé la question.
 */
import { splitLangPath } from "@/i18n/localizedPath.ts";
import { fetchAccount, fetchSessionKind } from "./accountClient.ts";
import { fetchMaDemande, fetchMesDemandes } from "./mesDemandesClient.ts";
import { fetchProfil } from "./profilClient.ts";

const early = new Map<string, Promise<unknown>>();

/** La réponse déjà en route pour `key`, sinon une lecture neuve. */
export function takeEarly<T>(key: string, start: () => Promise<T>): Promise<T> {
  const pending = early.get(key) as Promise<T> | undefined;
  early.delete(key);
  return pending ?? start();
}

export const maDemandeKey = (id: string) => "maDemande:" + id.toLowerCase();

const DETAIL_RE = /^\/compte\/demandes\/([0-9a-f-]{36})\/?$/i;

/** Les lectures dont la page d'arrivée aura besoin, parties tout de suite. */
export function startEarlyFetches(pathname: string): void {
  const path = splitLangPath(pathname).path.replace(/\/+$/, "") || "/";
  const put = (key: string, start: () => Promise<unknown>) => {
    const pending = start();
    // Une réponse jamais réclamée (l'écran a changé entre-temps) ne doit pas finir en rejet non traité.
    pending.catch(() => {});
    early.set(key, pending);
  };
  put("session", fetchSessionKind);
  if (path === "/compte") {
    put("account", fetchAccount);
    put("profil", fetchProfil);
  } else if (path === "/compte/demandes") {
    put("mesDemandes", () => fetchMesDemandes());
  } else {
    const detail = DETAIL_RE.exec(path);
    if (detail) put(maDemandeKey(detail[1]), () => fetchMaDemande(detail[1]));
  }
}

/** Pour les tests : oublie tout ce qui est en route. */
export function resetEarlyFetches(): void {
  early.clear();
}
