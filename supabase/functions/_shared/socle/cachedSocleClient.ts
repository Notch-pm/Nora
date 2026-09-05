/**
 * Cache du Socle — un décorateur autour du port, pas une couche.
 *
 * Pourquoi ici plutôt que dans chaque service : la résolution d'un domaine et
 * les démarches d'une collectivité sont deux `GET` sur deux chemins distincts.
 * Mémoriser au niveau du port les couvre TOUS LES DEUX, en un seul endroit, et
 * couvrira gratuitement les prochains — la charte graphique, par exemple.
 *
 * Ce qui est mis en cache est ce que le Socle a répondu, y compris un
 * `not_found` : un domaine inconnu est un fait aussi stable qu'un domaine
 * connu, et un robot qui essaie mille sous-domaines ne doit pas se traduire en
 * mille appels au Socle. Ce qui n'est PAS mis en cache, ce sont les pannes
 * (`unreachable`, `auth_failed`, `unexpected`) : mémoriser une indisponibilité
 * la ferait durer après le rétablissement.
 *
 * Volontairement rudimentaire, et facile à retirer : une `Map` par instance,
 * un TTL, aucune éviction fine. `ttlMs = 0` rend le client d'origine, sans
 * décorateur — le cache se coupe donc par configuration, sans changement de
 * code. Le jour où plusieurs instances devront partager un cache, c'est ce
 * fichier qu'on remplace, et lui seul.
 */
import type { SocleClient, SocleReply } from "./socleClient.ts";

/** Ce qui vaut la peine d'être mémorisé : une réponse, pas une panne. */
function isCacheable(reply: SocleReply): boolean {
  return reply.kind === "ok" || reply.kind === "not_found";
}

interface Entry {
  reply: SocleReply;
  expiresAt: number;
}

export interface CacheOptions {
  /** Durée de vie d'une réponse, en millisecondes. `0` désactive le cache. */
  ttlMs: number;
  /**
   * Garde-fou de taille. Le portail interroge peu de chemins distincts ; une
   * `Map` qui gonflerait signalerait un balayage de sous-domaines, pas un
   * usage normal. Au-delà, on repart de zéro — plus simple qu'une LRU, et
   * suffisant pour ce que ce cache protège.
   */
  maxEntries?: number;
  /** Injectable pour les tests : aucun test n'a à attendre une seconde. */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 500;

export function withCache(inner: SocleClient, options: CacheOptions): SocleClient {
  if (options.ttlMs <= 0) return inner;

  const now = options.now ?? (() => Date.now());
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new Map<string, Entry>();

  return {
    async get(path: string): Promise<SocleReply> {
      const cached = entries.get(path);
      if (cached !== undefined && cached.expiresAt > now()) return cached.reply;
      // Entrée périmée : on l'oublie avant l'appel, pour qu'un échec ne laisse
      // pas traîner une réponse dont la date est passée.
      if (cached !== undefined) entries.delete(path);

      const reply = await inner.get(path);
      if (isCacheable(reply)) {
        if (entries.size >= maxEntries) entries.clear();
        entries.set(path, { reply, expiresAt: now() + options.ttlMs });
      }
      return reply;
    },
  };
}
