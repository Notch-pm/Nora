/**
 * Client HTTP de « Mes informations » (`/v1/compte/profil`, espace usager L3b).
 *
 * Même motif que `accountClient.ts` : relais de MÊME ORIGINE (`/api`) — la
 * session est un cookie HttpOnly de première partie — et `x-nora-request: 1`
 * sur l'écriture. Le profil est la fiche du Socle vue par son titulaire ; rien
 * n'en est gardé ici, l'écran le tient en mémoire de composant.
 *
 * `profil: null` = jamais rempli (premier remplissage : l'identité complète).
 */
import type { Profil, ProfilChamp, ProfilCoordonnees, ProfilIdentite } from "@fn/_shared/domain/profil.ts";
import { ACCOUNT_API_BASE } from "./accountClient.ts";

export type ProfilClientFailure =
  | "profil_invalide"
  | "profil_refuse"
  | "profil_indisponible"
  | "session_required"
  | "csrf_rejected"
  | "session_unavailable"
  | "network";

const KNOWN_FAILURES: readonly ProfilClientFailure[] = [
  "profil_invalide",
  "profil_refuse",
  "profil_indisponible",
  "session_required",
  "csrf_rejected",
  "session_unavailable",
  "network",
];

const CHAMPS: readonly ProfilChamp[] = [
  "civilite", "prenom", "nom", "nomUsage", "dateNaissance", "mobile", "fixe", "adresse1", "adresse2", "codePostal", "ville",
];

export type ProfilCall<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ProfilClientFailure; champs?: ProfilChamp[] };

/** Un code inconnu vaut « indisponible » ; les champs fautifs ne sont gardés que s'ils sont connus. */
function readFailure(body: unknown): { reason: ProfilClientFailure; champs?: ProfilChamp[] } {
  const error = (body as { error?: { code?: unknown; champs?: unknown } } | null)?.error;
  const reason = KNOWN_FAILURES.includes(error?.code as ProfilClientFailure)
    ? (error?.code as ProfilClientFailure)
    : "profil_indisponible";
  const champs = Array.isArray(error?.champs)
    ? error.champs.filter((c): c is ProfilChamp => CHAMPS.includes(c as ProfilChamp))
    : [];
  return champs.length > 0 ? { reason, champs } : { reason };
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** La forme seulement : le serveur a déjà fait le tri. `undefined` = corps illisible. */
function readProfil(reply: unknown): Profil | null | undefined {
  const raw = (reply as { profil?: unknown } | null)?.profil;
  if (raw === null) return null;
  if (typeof raw !== "object" || raw === undefined) return undefined;
  const r = raw as Record<string, unknown>;
  return {
    civilite: r.civilite === "madame" || r.civilite === "monsieur" ? r.civilite : null,
    prenom: text(r.prenom),
    nom: text(r.nom),
    nomUsage: text(r.nomUsage),
    dateNaissance: text(r.dateNaissance),
    courriel: text(r.courriel),
    mobile: text(r.mobile),
    fixe: text(r.fixe),
    adresse1: text(r.adresse1),
    adresse2: text(r.adresse2),
    codePostal: text(r.codePostal),
    ville: text(r.ville),
    consentements: {
      traitement: readConsent(r.consentements, "traitement"),
      partage: readConsent(r.consentements, "partage"),
    },
  };
}

/** Trois états : accordé, refusé (daté), jamais demandé (`null`). */
function readConsent(raw: unknown, kind: "traitement" | "partage"): { accorde: boolean; le: string } | null {
  const v = (raw as Record<string, unknown> | null)?.[kind] as Record<string, unknown> | null | undefined;
  return v && typeof v.accorde === "boolean" && typeof v.le === "string" ? { accorde: v.accorde, le: v.le } : null;
}

async function call(method: "GET" | "POST", body: object | null): Promise<ProfilCall<Profil | null>> {
  let response: Response;
  try {
    response = await fetch(
      ACCOUNT_API_BASE + "/v1/compte/profil",
      method === "GET"
        ? undefined
        : { method, headers: { "Content-Type": "application/json", "x-nora-request": "1" }, body: JSON.stringify(body ?? {}) },
    );
  } catch {
    return { ok: false, reason: "network" };
  }
  const reply = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, ...readFailure(reply) };
  const profil = readProfil(reply);
  return profil === undefined ? { ok: false, reason: "profil_indisponible" } : { ok: true, value: profil };
}

/** Le profil de la session ; `null` = jamais rempli. `session_required` = pas (ou plus) connecté. */
export function fetchProfil(): Promise<ProfilCall<Profil | null>> {
  return call("GET", null);
}

/** Premier remplissage : l'identité complète (l'adresse de courriel est celle du compte). */
export async function saveIdentite(identite: ProfilIdentite): Promise<ProfilCall<Profil>> {
  const result = await call("POST", identite);
  if (!result.ok) return result;
  return result.value === null ? { ok: false, reason: "profil_indisponible" } : { ok: true, value: result.value };
}

/** Ensuite : SEULES les coordonnées. */
export async function saveCoordonnees(coordonnees: ProfilCoordonnees): Promise<ProfilCall<Profil>> {
  const result = await call("POST", coordonnees);
  if (!result.ok) return result;
  return result.value === null ? { ok: false, reason: "profil_indisponible" } : { ok: true, value: result.value };
}
