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
   * 400 / 409 / 413 / 415 / 422 / 429 — l'envoi est refusé : démarche fermée
   * côté Iris, identité absente, rejeu d'un même identifiant avec un contenu
   * qui a changé, fichier trop gros ou d'un format refusé, trop de dépôts.
   * Aucune n'est une panne. `status` laisse l'appelant distinguer ce qui se
   * dit à l'usager (un fichier refusé) de ce qui va au journal (un contrat).
   */
  | { kind: "rejected"; status: number; message: string | null }
  /** 401/403 — la clé du PORTAIL est refusée, ou hors de son périmètre. */
  | { kind: "auth_failed" }
  /** Réseau, DNS, délai dépassé : rien n'est revenu. */
  | { kind: "unreachable" }
  /** Une réponse est revenue, mais elle n'a aucun sens pour nous. */
  | { kind: "unexpected" };

export interface IrisClient {
  post(path: string, body: unknown): Promise<IrisReply>;
  /**
   * Dépôt d'un FICHIER (`POST /v1/uploads`, contrat 2.0.0) : les octets
   * partent en `multipart/form-data`, champ `file`, avec leur nom d'origine —
   * Iris vérifie lui-même le contenu réel et l'extension.
   */
  postMultipart(path: string, file: Blob, fileName: string): Promise<IrisReply>;
}

export interface IrisClientConfig {
  /** Racine de l'API d'ingestion d'Iris. Barre finale tolérée. */
  baseUrl: string;
  /**
   * Clé serveur-à-serveur (`irs_…`). Ne doit jamais atteindre un navigateur.
   *
   * ⚠️ C'est une clé PLATEFORME (contrat Iris 2.3.0) : une seule pour toutes
   * les collectivités, comme la clé du Socle. Elle authentifie le portail ; la
   * collectivité pour laquelle il agit est nommée à chaque appel par
   * `socleRootOrganizationId`. Une clé par collectivité a été essayée (le
   * 2026-09-22, une journée) : il fallait reposer toutes les clés ensemble dans
   * un secret que personne ne peut relire — intenable dès la troisième.
   */
  apiKey: string;
  /**
   * L'identifiant Socle de la collectivité racine du domaine visité — envoyé
   * en `X-Socle-Root-Organization-Id`. Iris exige qu'elle ait une source
   * `portail-citoyen` active : c'est là que le dépôt s'ouvre ou se ferme par
   * collectivité, sans toucher à aucun secret.
   */
  socleRootOrganizationId: string;
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

const REJECTED_STATUSES = new Set([400, 409, 413, 415, 422, 429]);

export function createIrisClient(config: IrisClientConfig): IrisClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function send(path: string, init: RequestInit): Promise<IrisReply> {
    let response: Response;
    try {
      response = await fetch(baseUrl + path, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: "Bearer " + config.apiKey,
          "X-Socle-Root-Organization-Id": config.socleRootOrganizationId,
        },
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
    if (REJECTED_STATUSES.has(response.status)) {
      return { kind: "rejected", status: response.status, message: errorMessage(parsed) };
    }
    return { kind: "unexpected" };
  }

  return {
    post(path: string, body: unknown): Promise<IrisReply> {
      return send(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    postMultipart(path: string, file: Blob, fileName: string): Promise<IrisReply> {
      // Pas de Content-Type explicite : fetch pose la frontière multipart lui-même.
      const form = new FormData();
      form.append("file", file, fileName);
      return send(path, { method: "POST", headers: {}, body: form });
    },
  };
}
