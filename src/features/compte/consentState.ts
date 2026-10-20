/**
 * L'état d'un consentement tel que « Mon compte » l'affiche — TROIS états :
 * accordé, refusé (daté), jamais demandé.
 *
 * ⚠️ C'est la DATE qui tranche, jamais le booléen seul : un `accorde: false`
 * sans date de recueil ne prouve pas un refus, c'est « jamais demandé ». Le
 * retrait est un recueil `granted: false` plus récent, pas un effacement.
 */
import type { ConsentEtat } from "@fn/_shared/domain/profil.ts";
import type { ConsentKind } from "@fn/_shared/domain/consents.ts";

export type ConsentView =
  | { state: "granted"; at: string }
  | { state: "refused"; at: string }
  | { state: "never" };

export function consentView(etat: ConsentEtat | null | undefined): ConsentView {
  if (!etat || typeof etat.le !== "string" || etat.le.trim() === "") return { state: "never" };
  return etat.accorde ? { state: "granted", at: etat.le } : { state: "refused", at: etat.le };
}

/** Ce que le bouton propose : retirer ce qui est accordé, accorder tout le reste. */
export function consentAction(view: ConsentView): "grant" | "withdraw" {
  return view.state === "granted" ? "withdraw" : "grant";
}

/** Le retrait du consentement au traitement se confirme (il n'annule pas les demandes en cours). */
export function needsWithdrawConfirmation(kind: ConsentKind, view: ConsentView): boolean {
  return kind === "traitement" && consentAction(view) === "withdraw";
}
