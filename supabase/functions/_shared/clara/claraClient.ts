/**
 * Client HTTP de Clara — le SEUL endroit du portail qui parle réseau à la
 * gestion du courrier.
 *
 * Même parti que `iris/irisClient.ts` : `ClaraClient` est un **port**. Le
 * service qui relaie un courrier ne connaît que cette interface, jamais
 * `fetch` ; ses règles se testent contre un Clara simulé, et le jour où le
 * transport change, un seul fichier bouge.
 *
 * Le point d'entrée est l'edge function `nora-courrier` de Clara
 * (`CLARA_INTAKE_URL`, l'URL COMPLÈTE de la fonction), authentifiée par
 * `Authorization: Bearer {CLARA_INTAKE_KEY}`. La clé vit en secret d'edge
 * function et ne traverse JAMAIS un navigateur : elle donne le droit de
 * déposer du courrier dans la boîte de n'importe quel organisme abonné.
 */

/**
 * Réponse de Clara ramenée aux cas dont le portail sait quoi faire — le code
 * HTTP brut ne remonte pas, sans quoi chaque appelant redéciderait dans son
 * coin ce que vaut un 409.
 */
export type ClaraReply =
  /** 200 — le courrier existe, créé à l'instant ou rendu par un rejeu. */
  | { kind: "ok"; body: unknown }
  /** 400 `validation` — Clara refuse le contenu (un écart de contrat, pour nous). */
  | { kind: "validation"; message: string | null }
  /** 401 (ou 403) — la clé du PORTAIL est refusée. */
  | { kind: "unauthorized" }
  /** 404 `organisme_inconnu` — Clara ne rattache cet UUID Socle à aucune de ses organisations. */
  | { kind: "organisme_inconnu" }
  /** 409 `organisme_ambigu` — plusieurs organisations Clara pour le même UUID Socle. */
  | { kind: "organisme_ambigu" }
  /** 5xx — Clara a échoué de son côté. */
  | { kind: "failed" }
  /** Réseau, DNS, délai dépassé : rien n'est revenu. */
  | { kind: "unreachable" }
  /** Une réponse est revenue, mais elle n'a aucun sens pour nous. */
  | { kind: "unexpected" };

export interface ClaraClient {
  /** Dépose un courrier : `multipart/form-data`, champs du contrat `nora-courrier`. */
  postCourrier(form: FormData): Promise<ClaraReply>;
}

export interface ClaraClientConfig {
  /** URL COMPLÈTE de l'edge function `nora-courrier` de Clara. */
  url: string;
  /** Clé serveur-à-serveur. Ne doit jamais atteindre un navigateur. */
  apiKey: string;
  /**
   * Un dépôt avec trois pièces de 5 Mo est une écriture lourde : plus de temps
   * qu'à une lecture, sans faire tourner l'onglet d'un usager indéfiniment.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Le message d'une erreur de Clara (`{ error, message }`), quand il est lisible. */
function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const message = (body as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() !== "" ? message.trim() : null;
}

/** Le code d'erreur de Clara (`{ error: "organisme_inconnu" }`), ou `null`. */
function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

export function createClaraClient(config: ClaraClientConfig): ClaraClient {
  const url = config.url.trim();
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async postCourrier(form: FormData): Promise<ClaraReply> {
      let response: Response;
      try {
        // Pas de Content-Type explicite : fetch pose la frontière multipart lui-même.
        response = await fetch(url, {
          method: "POST",
          headers: { Authorization: "Bearer " + config.apiKey },
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Réseau, DNS, délai dépassé — indiscernables, et sans conséquence
        // différente : l'usager réessaie, et le `submission_id` conservé fait
        // qu'un rejeu ne crée pas de second courrier.
        return { kind: "unreachable" };
      }

      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => {});
        return { kind: "unauthorized" };
      }

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }

      if (response.status === 200 || response.status === 201) {
        return parsed === null ? { kind: "unexpected" } : { kind: "ok", body: parsed };
      }
      // ⚠️ LE CODE DU CORPS FAIT FOI, pas le seul statut : un 404 sans
      // `organisme_inconnu` est celui de la plateforme (fonction non déployée,
      // URL fausse) — une panne de configuration, pas un organisme à signaler.
      const code = errorCode(parsed);
      if (response.status === 400) return { kind: "validation", message: errorMessage(parsed) };
      if (response.status === 404 && code === "organisme_inconnu") return { kind: "organisme_inconnu" };
      if (response.status === 409 && code === "organisme_ambigu") return { kind: "organisme_ambigu" };
      if (response.status >= 500) return { kind: "failed" };
      return { kind: "unexpected" };
    },
  };
}
