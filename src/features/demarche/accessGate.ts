/**
 * La garde d'accès d'une démarche, côté écran (lot L3c).
 *
 * ⚠️ COMMODITÉ D'AFFICHAGE, pas une protection : le droit de déposer une
 * démarche `authentifie` se décide au serveur (`account_required`, 401). Cette
 * garde évite seulement à l'usager de remplir un formulaire qu'on lui refusera.
 *
 *   • `open`     — rien à dire : démarche libre, ou connecté au profil rempli ;
 *   • `login`    — réservée, et personne n'est connecté ;
 *   • `complete` — connecté, mais le profil n'est pas rempli ;
 *   • `pending`  — la session ou le profil n'a pas encore répondu.
 *
 * Un profil injoignable (`unavailable`) ouvre la garde : c'est le serveur qui
 * tranchera à l'envoi, et son refus aura son propre encart.
 */
import type { AccessMode } from "@fn/_shared/domain/demarche.ts";
import type { SessionKind } from "@/services/portal/accountClient.ts";

export type ProfilStatus = "unknown" | "empty" | "filled" | "unavailable";
export type AccessGate = "open" | "login" | "complete" | "pending";

export function accessGate(input: {
  accessMode: AccessMode;
  session: SessionKind | null;
  profil: ProfilStatus;
}): AccessGate {
  if (input.accessMode !== "authentifie") return "open";
  if (input.session === null) return "pending";
  if (input.session !== "account") return "login";
  if (input.profil === "unknown") return "pending";
  if (input.profil === "empty") return "complete";
  return "open";
}

/** Quel encart montrer quand le serveur a répondu `account_required`. */
export function gateAfterRefusal(session: SessionKind | null, profil: ProfilStatus): "login" | "complete" {
  return session === "account" && profil === "empty" ? "complete" : "login";
}
