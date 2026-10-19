/**
 * Limiteur de débit EN MÉMOIRE D'ISOLAT — pour le dépôt de fichiers d'un
 * portail public, sans base de données.
 *
 * ⚠️ CE QU'IL EST, ET CE QU'IL N'EST PAS. Nora n'a pas de table : ce compteur
 * vit dans l'isolat Deno, meurt avec lui, et n'est PAS partagé entre deux
 * isolats qui serviraient le même visiteur. C'est un frein de confort contre
 * un script maladroit, pas une borne opposable. La borne opposable est chez
 * Iris : 60 dépôts par minute et par clé (`POST /v1/uploads`) — et c'est
 * elle qui protège le stockage. Ce limiteur évite seulement qu'un seul
 * visiteur consomme à lui seul ce quota partagé par toute la collectivité.
 *
 * La clé est un HACHÉ de l'adresse IP (SHA-256) : le portail ne journalise ni
 * ne conserve d'adresse en clair — motif `portal-form` de Clara.
 */

export interface RateLimiter {
  /** Vrai si l'appel est accepté ; il est alors compté. */
  allow(key: string): boolean;
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Injectable pour les tests. */
  now?: () => number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const hits = new Map<string, number[]>();
  let lastPrune = 0;

  function prune(at: number): void {
    // Un balayage par fenêtre suffit : la carte ne grossit pas avec le temps.
    if (at - lastPrune < options.windowMs) return;
    lastPrune = at;
    for (const [key, stamps] of hits) {
      const kept = stamps.filter((s) => at - s < options.windowMs);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }

  return {
    allow(key: string): boolean {
      const at = now();
      prune(at);
      const recent = (hits.get(key) ?? []).filter((s) => at - s < options.windowMs);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(at);
      hits.set(key, recent);
      return true;
    },
  };
}

/** L'adresse du visiteur telle que la passerelle la transmet ; jamais conservée en clair. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first !== "") return first;
  }
  return headers.get("cf-connecting-ip")?.trim() || "inconnue";
}

/**
 * La clé d'un frein qui doit résister à un visiteur décidé : une adresse IPv6
 * se change à volonté dans son /64 (le préfixe qu'un fournisseur attribue à un
 * abonné), on compte donc par /64. Une IPv4 reste entière — un /24 regrouperait
 * des abonnés sans rapport derrière le même opérateur.
 */
export function addressBucket(address: string): string {
  if (!address.includes(":")) return address;
  const [head] = address.split("%");
  const parts = head.split("::");
  const left = parts[0] === "" ? [] : parts[0].split(":");
  const right = parts.length > 1 && parts[1] !== "" ? parts[1].split(":") : [];
  const groups = parts.length > 1 ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return groups.slice(0, 4).map((g) => (g === "" ? "0" : g.toLowerCase().replace(/^0+(?=.)/, ""))).join(":") + "::/64";
}

/** SHA-256 hexadécimal — WebCrypto, disponible sous Deno comme sous Node. */
export async function hashKey(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
