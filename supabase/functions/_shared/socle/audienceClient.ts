/**
 * Client HTTP de l'API Audience du Socle — le seul endroit du portail qui lui
 * écrive.
 *
 * ⚠️ POURQUOI UN CLIENT À PART, et pas une méthode de plus sur `SocleClient` :
 * celui-là est un port de LECTURE, décoré par un cache (`withCache`) et
 * construit une fois par isolat pour que ce cache serve. Une méthode `post`
 * sur la même interface obligerait le décorateur à la relayer sans jamais rien
 * en faire, et ferait passer une écriture par un objet dont tout le reste est
 * mis en cache. Motif `irisClient` : celui qui écrit se construit par requête.
 *
 * ⚠️ IL NE LÈVE JAMAIS, ET C'EST TOUT SON CONTRAT. Un compteur ne doit pas
 * faire échouer une page, ni la retarder : le délai est court, l'échec est
 * silencieux, et l'appelant n'a rien à rattraper. C'est la raison pour
 * laquelle il ne rend pas de `SocleReply` détaillée comme le client de
 * lecture — il n'y a rien à décider d'un échec.
 *
 * ⚠️ CE QU'IL N'ENVOIE PAS : aucun en-tête venu du visiteur. Le corps est
 * composé par `index.ts` à partir de valeurs déjà réduites (une page, un
 * booléen, un code de langue, un mot d'appareil), et l'API du Socle refuse
 * toute clé inconnue de toute façon.
 */

export interface AudienceClient {
  /** `true` si le Socle a accusé réception ; `false` sur tout échec. */
  post(path: string, body: unknown): Promise<boolean>;
}

export interface AudienceClientConfig {
  /** Racine de l'API Audience du Socle. Barre finale tolérée. */
  baseUrl: string;
  /** Clé plateforme du portail, portant le scope `audience`. */
  apiKey: string;
  /**
   * Deux secondes : le compteur part pendant que la page se rend. Au-delà, on
   * abandonne — une mesure vaut moins qu'une milliseconde d'attente du visiteur.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2_000;

export function createAudienceClient(config: AudienceClientConfig): AudienceClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async post(path: string, body: unknown): Promise<boolean> {
      try {
        const response = await fetch(baseUrl + path, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        // Le corps n'intéresse personne : on le libère pour ne pas fuir la
        // connexion (motif `discard` du client de lecture).
        try {
          await response.body?.cancel();
        } catch {
          // Sans importance : la réponse est déjà écartée.
        }
        return response.ok;
      } catch {
        // Réseau, DNS, délai dépassé — indiscernables, et sans conséquence.
        return false;
      }
    },
  };
}
