/**
 * Durées de vie des sessions — la politique, séparée de son application.
 *
 * Trois profils :
 *   - `standard` — un citoyen connecté : déconnecté après 30 minutes sans
 *     activité, et au plus tard 12 heures après la connexion ;
 *   - `remember` — « rester connecté » : 7 jours sans activité, 30 jours au plus ;
 *   - `guest`    — accès à UNE demande par courriel + code de suivi : 30 minutes
 *     sans activité, 2 heures au plus.
 *
 * L'inactivité est réglable par l'exploitant (`CITIZEN_SESSION_IDLE_MINUTES`) :
 * les marchés la demandent « éventuellement paramétrable » (CCTP Sceaux §6.2).
 * Les bornes sont celles de la colonne `citizen_sessions.idle_seconds` : une
 * valeur que la base refuserait est écartée ici, avec un avertissement.
 */

export type SessionProfile = "standard" | "remember" | "guest";

export interface SessionDurations {
  /** Inactivité tolérée, en secondes. */
  idleSeconds: number;
  /** Vie maximale depuis l'ouverture, en secondes. */
  lifetimeSeconds: number;
}

export type SessionPolicy = Record<SessionProfile, SessionDurations>;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  standard: { idleSeconds: 30 * MINUTE, lifetimeSeconds: 12 * HOUR },
  remember: { idleSeconds: 7 * DAY, lifetimeSeconds: 30 * DAY },
  guest: { idleSeconds: 30 * MINUTE, lifetimeSeconds: 2 * HOUR },
};

/** Bornes de `idle_seconds` en base. */
const MIN_IDLE_MINUTES = 1;
const MAX_IDLE_MINUTES = 12 * 60;

/**
 * La politique effective. `CITIZEN_SESSION_IDLE_MINUTES` règle l'inactivité des
 * sessions `standard` et `guest` ; « rester connecté » est un choix explicite de
 * l'usager et n'en dépend pas.
 */
export function sessionPolicyFromEnv(get: (name: string) => string | undefined): SessionPolicy {
  const raw = get("CITIZEN_SESSION_IDLE_MINUTES");
  if (raw === undefined || raw.trim() === "") return DEFAULT_SESSION_POLICY;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes < MIN_IDLE_MINUTES || minutes > MAX_IDLE_MINUTES) {
    console.warn("portal-api : CITIZEN_SESSION_IDLE_MINUTES illisible, valeur par défaut appliquée.");
    return DEFAULT_SESSION_POLICY;
  }
  const idleSeconds = minutes * MINUTE;
  return {
    standard: { ...DEFAULT_SESSION_POLICY.standard, idleSeconds },
    remember: DEFAULT_SESSION_POLICY.remember,
    guest: { ...DEFAULT_SESSION_POLICY.guest, idleSeconds },
  };
}
