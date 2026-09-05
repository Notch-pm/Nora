/**
 * Détermination du nom d'hôte visité, **côté serveur**.
 *
 * Le navigateur ne dit jamais au portail quel tenant il veut : il ne dit que
 * d'où il vient, et cette fonction en tire un nom d'hôte. C'est l'unique entrée
 * du mécanisme multi-tenant.
 *
 * Pourquoi `Origin` et non `Host` : le site est servi par un hébergeur statique
 * et l'API par une edge function sur un autre domaine. Le `Host` que voit la
 * fonction est le sien, pas celui du portail. `Origin`, lui, porte le domaine
 * de la page — et c'est un en-tête interdit à `fetch` : le JavaScript de la
 * page ne peut pas le réécrire.
 *
 * La confidentialité ne repose pas sur cet en-tête : elle repose sur ce que le
 * Socle accepte de publier. Un client hors navigateur qui pose l'`Origin` d'une
 * collectivité obtient son catalogue public — ce que son portail affiche déjà à
 * tout visiteur.
 */
import { hostFromOrigin, isLoopbackHost, localhostLabel } from "./hostname.ts";

/**
 * Simulation d'un domaine de collectivité en développement. Sur `localhost`,
 * aucun domaine réel n'est visité : il faut en désigner un.
 *
 * `suffix` est le mécanisme principal, et il est multi-tenant : avec
 * `PORTAL_DEV_DOMAIN_SUFFIX=edilumen.fr`, ouvrir `nantes.localhost:5175` résout
 * `nantes.edilumen.fr` et `angers.localhost:5175` résout `angers.edilumen.fr`.
 * On vérifie donc « hostname A → tenant A, hostname B → tenant B » en changeant
 * d'URL, sans toucher au code ni à la configuration.
 *
 * `fallback` (`PORTAL_DEV_HOSTNAME`) ne sert qu'au bouclage nu — `localhost`,
 * `127.0.0.1`, ou un appel sans `Origin` — où aucun label n'est disponible.
 *
 * En production, aucun des deux n'est posé : la substitution est inatteignable,
 * et un hôte de bouclage ne résout rien.
 */
export interface DevHostnameConfig {
  /** Domaine dont `<label>.localhost` prend la place. */
  suffix: string | null;
  /** Domaine servi pour un bouclage sans label. */
  fallback: string | null;
}

/** Nom d'hôte à résoudre, ou `null` s'il n'a pas pu être déterminé. */
export function hostnameForRequest(request: Request, dev: DevHostnameConfig): string | null {
  const originHost = hostFromOrigin(request.headers.get("origin"));
  const suffix = dev.suffix !== null && dev.suffix !== "" ? dev.suffix : null;
  const fallback = dev.fallback !== null && dev.fallback !== "" ? dev.fallback : null;

  // Un domaine réel : c'est le cas de production, et il passe avant tout le
  // reste. La simulation ne peut donc jamais détourner un vrai visiteur, même
  // si sa configuration traînait en production.
  if (originHost !== null && !isLoopbackHost(originHost)) return originHost;

  // À partir d'ici : bouclage, ou pas d'`Origin` exploitable. Hors
  // développement, cela ne désigne aucune collectivité — mieux vaut le dire
  // que résoudre au hasard.
  const label = originHost === null ? null : localhostLabel(originHost);
  if (label !== null && suffix !== null) return label + "." + suffix;
  return fallback;
}
