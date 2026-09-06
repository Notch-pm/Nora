/**
 * Client HTTP d'Iris — le SEUL endroit du portail qui parle réseau au système
 * de traitement des demandes.
 *
 * Même parti que `socle/socleClient.ts` : `IrisClient` est un **port**, le
 * service qui dépose une demande ne connaît que cette interface, jamais
 * `fetch`. Les règles du dépôt se testent donc sans réseau, et le jour où
 * l'ingestion change de transport, un seul fichier bouge.
 *
 * La clé d'Iris (`irs_…`) vit en secret d'edge function et ne traverse JAMAIS
 * un navigateur — c'est une règle absolue de son API d'ingestion, et déjà la
 * nôtre pour le Socle. Un portail qui l'exposerait donnerait à n'importe quel
 * visiteur le droit de déposer des demandes au nom de la collectivité.
 */

/**
 * Réponse d'Iris ramenée aux cas dont le portail sait quoi faire. Le code HTTP
 * brut ne remonte pas : sans quoi chaque appelant redéciderait dans son coin
 * ce que vaut un 409.
 */
export type IrisReply =
  /** 200 ou 201 — la demande existe, qu'elle vienne d'être créée ou non. */
  | { kind: "ok"; body: unknown }
  /**
   * 400 / 409 / 422 — l'enveloppe est refusée : démarche fermée côté Iris,
   * identité absente, ou rejeu d'un même identifiant avec un contenu qui a
   * changé. Aucune n'est une panne, et aucune ne se répare en réessayant.
   */
  | { kind: "rejected"; message: string | null }
  /** 401/403 — la clé du PORTAIL est refusée, ou hors de son périmètre. */
  | { kind: "auth_failed" }
  /** Réseau, DNS, délai dépassé : rien n'est revenu. */
  | { kind: "unreachable" }
  /** Une réponse est revenue, mais elle n'a aucun sens pour nous. */
  | { kind: "unexpected" };

export interface IrisClient {
  post(path: string, body: unknown): Promise<IrisReply>;
}

export interface IrisClientConfig {
  /** Racine de l'API d'ingestion d'Iris. Barre finale tolérée. */
  baseUrl: string;
  /** Clé serveur-à-serveur (`irs_…`). Ne doit jamais atteindre un navigateur. */
  apiKey: string;
  /**
   * Un dépôt est une écriture : on lui laisse plus de temps qu'à une lecture,
   * sans pour autant faire tourner l'onglet d'un usager indéfiniment.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Le message d'erreur d'Iris, quand il en donne un lisible. */
function errorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return null;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() !== "" ? message.trim() : null;
}

export function createIrisClient(config: IrisClientConfig): IrisClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async post(path: string, body: unknown): Promise<IrisReply> {
      let response: Response;
      try {
        response = await fetch(baseUrl + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + config.apiKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        // Réseau, DNS, délai dépassé — indiscernables. Sans conséquence
        // différente : l'usager réessaie, et l'identifiant de dépôt conservé
        // fait qu'un rejeu ne crée pas de doublon.
        return { kind: "unreachable" };
      }

      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => {});
        return { kind: "auth_failed" };
      }

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }

      // 200 = la demande existait déjà (rejeu), 201 = elle vient d'être créée.
      // Les deux sont des succès : l'usager doit voir le même accusé.
      if (response.status === 200 || response.status === 201) {
        return parsed === null ? { kind: "unexpected" } : { kind: "ok", body: parsed };
      }
      if (response.status === 400 || response.status === 409 || response.status === 422) {
        return { kind: "rejected", message: errorMessage(parsed) };
      }
      return { kind: "unexpected" };
    },
  };
}
