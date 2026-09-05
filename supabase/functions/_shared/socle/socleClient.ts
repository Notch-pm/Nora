/**
 * Client HTTP du Socle — le SEUL endroit du portail qui parle réseau au Socle.
 *
 * `SocleClient` est un **port** : les services (`tenantService`,
 * `demarcheService`) ne connaissent que cette interface, jamais `fetch`. Trois
 * conséquences, toutes voulues :
 *   - les règles du portail se testent sans réseau ;
 *   - le cache s'ajoute en décorant le port, sans toucher aux services ;
 *   - le jour où le Socle change de transport, un seul fichier bouge.
 *
 * L'URL et la clé arrivent par CONFIGURATION. Ce module ne les connaît pas : il
 * les reçoit.
 */

/**
 * Réponse du Socle ramenée aux seuls cas dont le portail sait quoi faire. Le
 * code HTTP brut n'est délibérément pas propagé plus haut, sans quoi chaque
 * appelant déciderait dans son coin de ce que vaut un 409.
 */
export type SocleReply =
  | { kind: "ok"; body: unknown }
  /** 404 — la ressource n'existe pas dans le périmètre de la clé. */
  | { kind: "not_found" }
  /** 401/403 — la clé du PORTAIL est refusée. Jamais la faute du visiteur. */
  | { kind: "auth_failed" }
  /** Réseau, DNS, délai dépassé : rien n'est revenu. */
  | { kind: "unreachable" }
  /** Une réponse est revenue, mais elle n'a aucun sens pour nous. */
  | { kind: "unexpected" };

export interface SocleClient {
  get(path: string): Promise<SocleReply>;
}

export interface SocleClientConfig {
  /** Racine de l'API publique du Socle. Barre finale tolérée. */
  baseUrl: string;
  /** Clé serveur-à-serveur du portail. Ne doit jamais atteindre un navigateur. */
  apiKey: string;
  /**
   * Le portail rend une page : au-delà de quelques secondes, mieux vaut une
   * page d'indisponibilité qu'un onglet qui tourne.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;

/** Libère le corps d'une réponse qu'on ne lira pas, pour ne pas fuir la connexion. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Sans importance : la réponse est déjà écartée.
  }
}

export function createSocleClient(config: SocleClientConfig): SocleClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async get(path: string): Promise<SocleReply> {
      let response: Response;
      try {
        response = await fetch(baseUrl + path, {
          headers: { Authorization: "Bearer " + config.apiKey },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Réseau, DNS, délai dépassé — indiscernables, et sans conséquence
        // différente pour le portail.
        return { kind: "unreachable" };
      }

      if (response.status === 404) {
        await discard(response);
        return { kind: "not_found" };
      }
      if (response.status === 401 || response.status === 403) {
        await discard(response);
        return { kind: "auth_failed" };
      }
      if (!response.ok) {
        await discard(response);
        return { kind: "unexpected" };
      }
      try {
        return { kind: "ok", body: await response.json() };
      } catch {
        return { kind: "unexpected" };
      }
    },
  };
}
