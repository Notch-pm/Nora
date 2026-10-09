/**
 * L'abstraction que consomme l'INTERFACE. C'est le contrat entre les écrans et
 * le reste du monde.
 *
 * Aucun composant n'appelle `fetch`, ne construit d'URL, ne connaît le Socle ni
 * même `portal-api`. Il demande « la collectivité » et « ses démarches ». Le
 * jour où l'API du Socle change, ce fichier et les services `socle/` bougent —
 * pas les écrans.
 *
 * ── Cache ────────────────────────────────────────────────────────────────────
 * Un chargement mémoïsé, et rien de plus. Il rend deux services :
 *   - `getCurrentTenant()` et `getPublicDemarches()` peuvent être appelés
 *     séparément, comme deux questions distinctes, sans provoquer deux
 *     allers-retours : la promesse est partagée ;
 *   - une navigation qui reviendrait sur la liste ne recharge pas un catalogue
 *     qui change à la journée.
 *
 * `PORTAL_CACHE_TTL_SECONDS` gouverne le cache du SERVEUR ; celui-ci est
 * mémoire, par onglet, et se coupe avec `VITE_PORTAL_CACHE_TTL_SECONDS=0`.
 * Délibérément primitif : une promesse et une date. Pas de revalidation en
 * arrière-plan, pas de déduplication par clé, pas de bibliothèque — il n'y a
 * qu'une seule ressource à ce stade, et la remplacer plus tard par un vrai
 * client de données ne demandera de toucher qu'ici.
 */
import type { Demarche, Ville } from "@fn/_shared/domain/demarche.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { HomePage } from "@fn/_shared/domain/page.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import type { FreeMail } from "@fn/_shared/domain/courrier.ts";
import { fetchPortal, type PortalLoad, type PortalLoadFailure } from "./portalClient.ts";

/**
 * Échec de chargement du portail, levé par les accesseurs.
 *
 * Une exception plutôt qu'un `null` : `getCurrentTenant()` doit rendre un
 * `Tenant`, sinon chaque appelant porterait un cas d'absence et finirait par
 * l'oublier. `reason` reste lisible pour l'écran qui l'attrape.
 */
export class PortalUnavailableError extends Error {
  constructor(readonly reason: PortalLoadFailure) {
    super("Portail indisponible : " + reason);
    this.name = "PortalUnavailableError";
  }
}

const DEFAULT_TTL_SECONDS = 60;

function ttlMs(): number {
  const raw = import.meta.env.VITE_PORTAL_CACHE_TTL_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_TTL_SECONDS * 1000;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_TTL_SECONDS * 1000;
}

interface Cached {
  /**
   * ⚠️ LA LANGUE FAIT PARTIE DE LA CLÉ. Sans elle, basculer en anglais
   * servirait l'instantané français pendant toute la durée du cache : le
   * sélecteur semblerait cassé, alors que seule la mémoire serait en cause.
   */
  lang: string;
  load: Promise<PortalLoad>;
  at: number;
}

let cached: Cached | null = null;

/**
 * Charge le portail, ou rend le chargement déjà en cours ou récent.
 *
 * Un échec n'est PAS mémorisé : le rappel suivant retente. Mémoriser une panne
 * la ferait durer une minute de plus que sa cause, et un visiteur qui recharge
 * après un rétablissement verrait encore l'erreur.
 */
export function loadPortal(lang: string): Promise<PortalLoad> {
  const ttl = ttlMs();
  if (cached !== null && cached.lang === lang && ttl > 0 && Date.now() - cached.at < ttl) {
    return cached.load;
  }

  const load = fetchPortal(lang).then((result) => {
    if (!result.ok) cached = null;
    return result;
  });
  cached = { lang, load, at: Date.now() };
  return load;
}

/** Vide le cache — utile aux tests, et à un futur bouton « actualiser ». */
export function resetPortalCache(): void {
  cached = null;
}

async function snapshot(lang: string) {
  const result = await loadPortal(lang);
  if (!result.ok) throw new PortalUnavailableError(result.reason);
  return result.snapshot;
}

/**
 * La collectivité dont le portail est visité.
 *
 * Elle est déterminée par le DOMAINE, côté serveur. L'interface ne la choisit
 * pas, ne la reçoit pas en paramètre, et ne peut pas en demander une autre.
 */
export async function getCurrentTenant(lang: string): Promise<Tenant> {
  return (await snapshot(lang)).tenant;
}

/**
 * La langue réellement servie. Le serveur la décide — voir
 * `PortalSnapshot.lang` — et l'interface s'y aligne.
 */
export async function getServedLanguage(lang: string): Promise<string> {
  return (await snapshot(lang)).lang;
}

/**
 * Les démarches que cette collectivité publie, dans l'ordre qu'elle a défini.
 *
 * Une liste vide est une réponse normale : la collectivité n'a encore rien
 * publié. Ce n'est pas une erreur, et l'interface doit le dire comme tel.
 */
export async function getPublicDemarches(lang: string): Promise<Demarche[]> {
  return (await snapshot(lang)).demarches;
}

/**
 * La page d'accueil composée par la collectivité, ou `null` si elle n'a
 * jamais rien publié — auquel cas l'interface rend sa mise en page par défaut.
 */
export async function getHomePage(lang: string): Promise<HomePage | null> {
  return (await snapshot(lang)).page;
}

/**
 * Les villes de la collectivité — de quoi bâtir le menu « Ma ville ».
 *
 * Une liste vide est une réponse normale : aucun organisme ne publie de
 * démarche, il n'y a donc nulle part où aller et l'en-tête n'affiche pas le
 * menu.
 */
export async function getVilles(lang: string): Promise<Ville[]> {
  return (await snapshot(lang)).villes;
}

/** Le courrier libre de la collectivité elle-même (`/courrier`) — fermé au doute. */
export async function getFreeMail(lang: string): Promise<FreeMail> {
  return (await snapshot(lang)).freeMail;
}

/** La charte graphique de la collectivité, ou `null` — couleurs par défaut. */
export async function getBranding(lang: string): Promise<Branding | null> {
  return (await snapshot(lang)).branding;
}
