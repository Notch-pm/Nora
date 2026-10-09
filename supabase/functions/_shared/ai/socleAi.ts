/**
 * Le port vers le guichet IA du Socle (`ai-api`, `POST /v1/completions`).
 *
 * Le portail ne parle JAMAIS au fournisseur : il compose son prompt et le
 * confie au Socle, qui détient la clé du fournisseur, compte les jetons et
 * refuse au-delà du plafond de la collectivité. Le Socle voit le prompt ; il ne
 * le garde pas (passe-plat).
 *
 * ⚠️ **Une clé À PART** (`SOCLE_AI_API_KEY`, scope `ai` seul), distincte de la
 * clé de lecture du portail : une clé `read` qui fuit lit du public, une clé
 * `ai` qui fuit DÉPENSE. Construit par requête, comme tout client d'écriture
 * (motif `audienceClient`) — seul le port de lecture est mis en cache.
 *
 * ⚠️ **Chaîne de délais, à ne pas inverser : fournisseur 55 s < Socle 60 s <
 * portail 75 s.** Inversée, le portail abandonne des appels que le Socle
 * termine et FACTURE, et l'usager qui réessaie paie deux fois — le guichet n'a
 * pas de clé d'idempotence (elle exigerait de stocker la réponse).
 *
 * ⚠️ Ce que l'appelant ne décide pas, et que le guichet refuse en 400 : le
 * modèle, l'`agent_id`, la température, les outils, le flux. On passe un ALIAS
 * d'agent ; le Socle le résout en secret (`MISTRAL_AGENT_ASSISTANT_USAGER`).
 */
import type { TurnMessage } from "../domain/assistantTurn.ts";

export const AGENT_ALIAS = "assistant-usager";
export const FEATURE = "assistant-usager";
const DEFAULT_TIMEOUT_MS = 75_000;
/**
 * Borne ce qu'un tour peut coûter — et ce n'est PAS le texte visible qui la
 * remplit.
 *
 * ⚠️ **À relire chaque fois que le contrat de sortie grossit** (`outputContract`
 * dans `prompt.ts`). En recueil, le modèle rend le message à l'usager (≈ 100
 * mots) PLUS une enveloppe JSON qui pèse davantage : jusqu'à 20 `field_updates`
 * portant chacun `origin`, et une citation (`source`) ou une justification
 * (`reason`). Trois champs remplis en un tour valent déjà autant que la phrase.
 *
 * ⚠️ Ce que coûte un dépassement n'est PAS une réponse écourtée, mais un tour
 * PERDU : le guichet rend quand même un `200` avec une chaîne tronquée, on la
 * prend pour bonne, et c'est `JSON.parse` qui tombe plus loin — l'usager lit
 * « L'assistant est momentanément indisponible » au tour où le modèle avait le
 * plus compris. Relevé de 600 à 1 100 le 2026-09-21, après que `origin`,
 * `source`, `reason` et `asking` ont rejoint le contrat sans que ce plafond
 * bouge.
 *
 * C'est un PLAFOND, pas une consommation : une réponse courte ne coûte pas plus
 * cher qu'avant.
 */
export const MAX_OUTPUT_TOKENS = 1_100;

export interface CompletionInput {
  /** La collectivité débitée — TOUJOURS dérivée du domaine visité, jamais du navigateur. */
  organizationId: string;
  system: string;
  messages: Pick<TurnMessage, "role" | "content">[];
  /** Identifiant de CONVERSATION (UUID) : la cadence du guichet se compte par lui. */
  actorId: string;
  /** La démarche consultée, pour le journal d'usage du Socle (un uuid nu, aucun contenu). */
  procedureId: string | null;
}

export type CompletionResult =
  | { kind: "ok"; answer: string }
  /** Plafond mensuel atteint — `message` est celui du Socle, daté : à relayer tel quel. */
  | { kind: "quota_exceeded"; message: string | null }
  /** Cadence dépassée : le crédit est intact, il suffit d'attendre. */
  | { kind: "rate_limited"; retryAfterSeconds: number }
  /** Clé refusée, scope manquant, collectivité non abonnée, fournisseur non configuré. */
  | { kind: "not_configured" }
  | { kind: "unavailable" };

export interface SocleAiClient {
  complete(input: CompletionInput): Promise<CompletionResult>;
}

/** Ce qu'un appel au guichet peut rendre d'autre qu'une réussite — commun aux trois routes. */
export type GuichetRefusal = Exclude<CompletionResult, { kind: "ok" }>;

export interface TranscriptionInput {
  organizationId: string;
  /** WAV PCM 16 bits, 16 kHz, mono — déjà vérifié par le portail (`readWav`). */
  audio: Uint8Array<ArrayBuffer>;
  durationMs: number;
  /** Langue de base (`fr`), ou `null` pour laisser le fournisseur la détecter. */
  language: string | null;
  /** Identifiant de CONVERSATION : la cadence audio du guichet se compte par lui. */
  actorId: string;
}

export type TranscriptionResult = { kind: "ok"; text: string } | GuichetRefusal;

export interface SpeechInput {
  organizationId: string;
  /** Texte DÉJÀ prononçable (`speakable`), 2 000 caractères au plus. */
  text: string;
  /** Langue de base : c'est le Socle qui en déduit la voix. */
  language: string;
  actorId: string;
}

export type SpeechResult = { kind: "ok"; audio: Uint8Array<ArrayBuffer>; contentType: string } | GuichetRefusal;

/**
 * La voix du MODE DIALOGUE (`ai-api` 1.4.0) — à part de `SocleAiClient` : un
 * tour de conversation n'en a pas besoin, et ses tests non plus.
 *
 * ⚠️ Même clé, même chaîne de délais, même classement des refus que la
 * conversation : c'est le même guichet, le même plafond, la même cadence (dans
 * un seau « audio » à part, au Socle).
 */
export interface SocleVoiceClient {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
  speak(input: SpeechInput): Promise<SpeechResult>;
}

export function createSocleAiClient(config: {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}): SocleAiClient & SocleVoiceClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const post = async (path: string, init: { body: BodyInit; json: boolean; organizationId: string }) => {
    try {
      return await fetch(baseUrl + path, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.apiKey,
          ...(init.json ? { "Content-Type": "application/json" } : {}),
          "X-Organization-Id": init.organizationId,
        },
        body: init.body,
        signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  };
  const bodyOf = async (response: Response): Promise<unknown> => {
    try {
      return await response.json();
    } catch {
      return null;
    }
  };
  return {
    async transcribe(input) {
      const form = new FormData();
      form.append("file", new Blob([input.audio], { type: "audio/wav" }), "tour.wav");
      form.append("duration_ms", String(Math.max(1, Math.round(input.durationMs))));
      if (input.language !== null) form.append("language", input.language);
      form.append("feature", FEATURE);
      form.append("actor_id", input.actorId);
      const response = await post("/v1/transcriptions", { body: form, json: false, organizationId: input.organizationId });
      if (response === null) return { kind: "unavailable" };
      const body = await bodyOf(response);
      if (response.status === 200) {
        // Un silence transcrit en « » n'est pas une panne : l'écran dit qu'il n'a
        // rien entendu, il ne dit pas que l'assistant est indisponible.
        const text = typeof body === "object" && body !== null ? (body as Record<string, unknown>).text : null;
        return typeof text === "string" ? { kind: "ok", text: text.trim() } : { kind: "unavailable" };
      }
      return classifyRefusal(response.status, response.headers.get("Retry-After"), body);
    },
    async speak(input) {
      const response = await post("/v1/speech", {
        body: JSON.stringify({
          feature: FEATURE,
          text: input.text,
          language: input.language,
          format: "mp3",
          actor_id: input.actorId,
        }),
        json: true,
        organizationId: input.organizationId,
      });
      if (response === null) return { kind: "unavailable" };
      if (response.status === 200) {
        const contentType = response.headers.get("Content-Type") ?? "";
        if (!contentType.startsWith("audio/")) return { kind: "unavailable" };
        try {
          const audio = new Uint8Array(await response.arrayBuffer());
          return audio.length > 0 ? { kind: "ok", audio, contentType } : { kind: "unavailable" };
        } catch {
          return { kind: "unavailable" };
        }
      }
      return classifyRefusal(response.status, response.headers.get("Retry-After"), await bodyOf(response));
    },
    async complete(input) {
      let response: Response;
      try {
        response = await fetch(baseUrl + "/v1/completions", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + config.apiKey,
            "Content-Type": "application/json",
            "X-Organization-Id": input.organizationId,
          },
          body: JSON.stringify({
            feature: FEATURE,
            agent: AGENT_ALIAS,
            system: input.system,
            messages: input.messages.map(({ role, content }) => ({ role, content })),
            response_format: "json",
            max_output_tokens: MAX_OUTPUT_TOKENS,
            actor_id: input.actorId,
            ...(input.procedureId === null
              ? {}
              : { reference: { kind: "procedure", id: input.procedureId } }),
          }),
          signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
      } catch {
        return { kind: "unavailable" };
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Corps illisible : traité plus bas selon le statut.
      }
      return classify(response.status, response.headers.get("Retry-After"), body);
    },
  };
}

/** Le classement d'une réponse du guichet — pur, testé sans réseau. */
export function classify(status: number, retryAfter: string | null, body: unknown): CompletionResult {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (status === 200) {
    return typeof record.answer === "string" && record.answer.trim() !== ""
      ? { kind: "ok", answer: record.answer }
      : { kind: "unavailable" };
  }
  return classifyRefusal(status, retryAfter, body);
}

/** Le classement d'un refus du guichet, quelle que soit la route — pur, testé sans réseau. */
export function classifyRefusal(status: number, retryAfter: string | null, body: unknown): GuichetRefusal {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const error =
    typeof record.error === "object" && record.error !== null
      ? (record.error as Record<string, unknown>)
      : {};
  if (status === 429) {
    // Deux refus sous un même statut ; le CODE les distingue. Inconnu ⇒ cadence,
    // le moins alarmant des deux : on n'annonce pas un crédit épuisé sans le savoir.
    if (error.code === "ai_quota_exceeded") {
      return { kind: "quota_exceeded", message: typeof error.message === "string" ? error.message : null };
    }
    const seconds = Number(retryAfter);
    return {
      kind: "rate_limited",
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), 120) : 30,
    };
  }
  // 401/403 (clé, scope, application), 404 (collectivité non abonnée), 503
  // (fournisseur absent) : rien qu'un usager puisse corriger, tout ce qu'un
  // exploitant doit voir. 400 compris : c'est NOTRE requête qui est fausse.
  if ([400, 401, 403, 404, 503].includes(status)) return { kind: "not_configured" };
  return { kind: "unavailable" };
}
