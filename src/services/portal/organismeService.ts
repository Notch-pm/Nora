/**
 * Ce que l'écran d'un organisme demande au monde — l'équivalent de
 * `portalService.ts` pour un périmètre plus étroit.
 *
 * Même contrat, mêmes règles : aucun composant n'appelle `fetch` ni ne
 * construit d'URL, un échec est une exception (`PortalUnavailableError`, le
 * MÊME type que pour l'accueil) plutôt qu'un `null` que chaque appelant
 * finirait par oublier de traiter.
 *
 * ── Cache ────────────────────────────────────────────────────────────────────
 * Même mémoïsation primitive qu'à l'accueil — une promesse et une date — avec
 * ⚠️ **LE SLUG DANS LA CLÉ, au même titre que la langue** : sans lui, passer
 * d'une mairie à l'autre servirait la page de la première pendant toute la
 * durée du cache, et le lien semblerait cassé alors que seule la mémoire serait
 * en cause. Une seule entrée est gardée : un visiteur lit une page d'organisme
 * à la fois, et le vrai cache des allers-retours répétés est celui du
 * navigateur, que `portal-api` autorise par son en-tête.
 */
import { fetchOrganisme, type OrganismeLoad, type OrganismeSnapshot } from "./portalClient.ts";
import { PortalUnavailableError } from "./portalService.ts";

export type { OrganismeSnapshot };

const DEFAULT_TTL_SECONDS = 60;

function ttlMs(): number {
  const raw = import.meta.env.VITE_PORTAL_CACHE_TTL_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_TTL_SECONDS * 1000;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_TTL_SECONDS * 1000;
}

interface Cached {
  lang: string;
  slug: string;
  load: Promise<OrganismeLoad>;
  at: number;
}

let cached: Cached | null = null;

/**
 * Charge la page d'un organisme, ou rend le chargement déjà en cours ou récent.
 *
 * Un échec n'est PAS mémorisé : mémoriser une panne la ferait durer une minute
 * de plus que sa cause.
 */
export function loadOrganisme(lang: string, slug: string): Promise<OrganismeLoad> {
  const ttl = ttlMs();
  if (
    cached !== null && cached.lang === lang && cached.slug === slug && ttl > 0 &&
    Date.now() - cached.at < ttl
  ) {
    return cached.load;
  }

  const load = fetchOrganisme(slug, lang).then((result) => {
    if (!result.ok) cached = null;
    return result;
  });
  cached = { lang, slug, load, at: Date.now() };
  return load;
}

/** Vide le cache — utile aux tests, et à un futur bouton « actualiser ». */
export function resetOrganismeCache(): void {
  cached = null;
}

/**
 * La page d'un organisme : la collectivité, l'organisme visité, ses démarches
 * et la charte à appliquer.
 *
 * ⚠️ Lève `organisme_unavailable` quand le slug ne désigne personne qui publie
 * ici — slug inventé, organisme qui n'a plus de démarche publiée, ou slug de la
 * collectivité elle-même (dont la page est l'accueil). L'écran ramène alors le
 * visiteur à l'accueil plutôt que de lui expliquer une adresse périmée.
 */
export async function getOrganismeSnapshot(lang: string, slug: string): Promise<OrganismeSnapshot> {
  const result = await loadOrganisme(lang, slug);
  if (!result.ok) throw new PortalUnavailableError(result.reason);
  return result.snapshot;
}
