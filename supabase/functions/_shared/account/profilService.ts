/**
 * Le profil de l'usager connecté (espace usager, lot L3b) : lire sa fiche du
 * Socle, la rattacher au premier remplissage, mettre à jour ses coordonnées.
 *
 * La fiche n'est jamais désignée par le navigateur : elle se lit dans l'espace
 * du compte pour la collectivité (`citizen_spaces`), lui-même tiré de la
 * session. Le rattachement est fait par le Socle, sur l'adresse du COMPTE —
 * vérifiée à la confirmation — et l'identité saisie (contacts-api 1.4.0).
 */
import type { RequestTrace } from "../session/sessionStore.ts";
import {
  type Profil,
  type ProfilChamp,
  parseCoordonnees,
  parseIdentite,
  toProfil,
  toSocleCoordonnees,
  toSocleIdentity,
} from "../domain/profil.ts";
import type { CitizenContacts } from "../socle/citizenContacts.ts";
import type { AccountStore } from "./accountStore.ts";
import { isConsentKind } from "../domain/consents.ts";
import type { IdentityProvider } from "./identity.ts";

export type ProfilFailure = "profil_invalide" | "profil_refuse" | "profil_indisponible";

export type ProfilResult =
  | { ok: true; profil: Profil | null }
  | { ok: false; reason: ProfilFailure; champs?: ProfilChamp[]; message?: string | null };

export interface ProfilDeps {
  store: AccountStore;
  identity: IdentityProvider;
  contacts: CitizenContacts;
  tenantId: string;
  trace: RequestTrace;
}

/**
 * La fiche que l'espace retient est-elle TOUJOURS celle que le Socle rattache
 * à ce compte, et active ? Un agent peut avoir corrigé le rattachement ou
 * archivé la fiche : « Mes demandes » ne suit alors plus l'ancienne
 * (relecture de sécurité du 2026-10-20, I3). `undefined` = Socle muet.
 */
export async function ficheConfirmee(deps: ProfilDeps, accountId: string, contactId: string): Promise<boolean | undefined> {
  const reply = await deps.contacts.get(deps.tenantId, accountId);
  if (reply.kind === "not_found") return false;
  if (reply.kind !== "ok") return undefined;
  const id = (reply.body as { contact?: { id?: unknown } } | null)?.contact?.id;
  return id === contactId;
}

/** La fiche de l'espace, ou `null` s'il n'en a pas encore — `undefined` si la base ne répond pas. */
export async function spaceContactId(deps: ProfilDeps, accountId: string): Promise<string | null | undefined> {
  const r = await deps.store.spaceContact(accountId, deps.tenantId);
  return r.ok ? r.value : undefined;
}

function profilOf(body: unknown): Profil | null {
  const contact = typeof body === "object" && body !== null ? (body as Record<string, unknown>).contact : null;
  return toProfil(contact);
}

export async function lireProfil(deps: ProfilDeps, accountId: string): Promise<ProfilResult> {
  const contactId = await spaceContactId(deps, accountId);
  if (contactId === undefined) return { ok: false, reason: "profil_indisponible" };
  if (contactId === null) return { ok: true, profil: null };
  const reply = await deps.contacts.get(deps.tenantId, accountId);
  if (reply.kind === "not_found") return { ok: true, profil: null };
  if (reply.kind !== "ok") return { ok: false, reason: "profil_indisponible" };
  const profil = profilOf(reply.body);
  // Le Socle désigne une AUTRE fiche que celle de l'espace : on ne montre rien.
  const id = (reply.body as { contact?: { id?: unknown } } | null)?.contact?.id;
  if (id !== contactId) return { ok: false, reason: "profil_indisponible" };
  return { ok: true, profil };
}

/**
 * Premier remplissage : l'identité complète, et le rattachement. Ensuite :
 * les coordonnées seules (le Socle refuse le reste).
 */
export async function enregistrerProfil(deps: ProfilDeps, accountId: string, body: unknown): Promise<ProfilResult> {
  const contactId = await spaceContactId(deps, accountId);
  if (contactId === undefined) return { ok: false, reason: "profil_indisponible" };

  if (contactId === null) {
    const identite = parseIdentite(body);
    if (!identite.ok) return { ok: false, reason: "profil_invalide", champs: identite.champs };
    const courriel = await deps.identity.emailOf(accountId);
    if (courriel === null) return { ok: false, reason: "profil_indisponible" };
    const reply = await deps.contacts.link(deps.tenantId, accountId, toSocleIdentity(identite.value, courriel));
    if (reply.kind === "rejected") return { ok: false, reason: "profil_refuse", message: reply.message };
    if (reply.kind !== "ok") return { ok: false, reason: "profil_indisponible" };
    const contact = (reply.body as { contact?: { id?: unknown } } | null)?.contact;
    if (typeof contact?.id !== "string") return { ok: false, reason: "profil_indisponible" };
    const set = await deps.store.setSpaceContact(accountId, deps.tenantId, contact.id, deps.trace);
    if (!set.ok || !set.value) return { ok: false, reason: "profil_indisponible" };
    return { ok: true, profil: profilOf(reply.body) };
  }

  const coordonnees = parseCoordonnees(body);
  if (!coordonnees.ok) return { ok: false, reason: "profil_invalide", champs: coordonnees.champs };
  if (Object.keys(coordonnees.value).length === 0) return lireProfil(deps, accountId);
  const reply = await deps.contacts.update(deps.tenantId, accountId, toSocleCoordonnees(coordonnees.value));
  if (reply.kind === "rejected") return { ok: false, reason: "profil_refuse", message: reply.message };
  if (reply.kind !== "ok") return { ok: false, reason: "profil_indisponible" };
  return { ok: true, profil: profilOf(reply.body) };
}

/**
 * L'usager modifie un consentement depuis « Mon compte » (lot L3c) : un
 * recueil daté au Socle, sur SA fiche. `{ kind, granted }` seulement — la
 * phrase est composée par le Socle. Un retrait est un recueil `granted: false`.
 */
export async function modifierConsentement(deps: ProfilDeps, accountId: string, body: unknown): Promise<ProfilResult> {
  const r = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (!isConsentKind(r.kind) || typeof r.granted !== "boolean") return { ok: false, reason: "profil_invalide" };
  const contactId = await spaceContactId(deps, accountId);
  if (contactId === undefined) return { ok: false, reason: "profil_indisponible" };
  if (contactId === null) return { ok: false, reason: "profil_invalide" };
  const reply = await deps.contacts.consent(deps.tenantId, accountId, { kind: r.kind, granted: r.granted });
  if (reply.kind === "rejected") return { ok: false, reason: "profil_refuse", message: reply.message };
  if (reply.kind !== "ok") return { ok: false, reason: "profil_indisponible" };
  return { ok: true, profil: profilOf(reply.body) };
}

export function httpStatusForProfilFailure(failure: ProfilFailure): number {
  return failure === "profil_indisponible" ? 503 : 400;
}

export const PROFIL_MESSAGES: Record<ProfilFailure, string> = {
  profil_invalide: "Certaines informations sont manquantes ou mal saisies.",
  profil_refuse: "Ces informations n'ont pas pu être enregistrées.",
  profil_indisponible: "Le service est momentanément indisponible. Merci de réessayer dans quelques instants.",
};
