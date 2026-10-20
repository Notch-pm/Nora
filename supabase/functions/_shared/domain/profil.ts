/**
 * Le PROFIL de l'usager connecté — sa fiche du Socle, vue par lui (espace
 * usager, lot L3b). Logique pure, partagée avec l'interface par `@fn`.
 *
 * La fiche vit au Socle (contacts-api 1.4.0, scope `citizen`) ; Nora n'en
 * garde que l'identifiant, dans l'espace du compte pour la collectivité. Le
 * portail parle sa langue (camelCase, français) ; la traduction vers le
 * contrat du Socle tient ici, en un seul endroit.
 *
 * Au premier remplissage, l'identité RATTACHE le compte à une fiche : la fiche
 * unique de même adresse (celle du compte, vérifiée) ET même nom et prénom,
 * sinon une fiche neuve. Ensuite, l'usager ne modifie que ses coordonnées et
 * son nom d'usage — nom, prénom, civilité et date de naissance fondent le
 * rattachement, et se corrigent auprès de la collectivité.
 */

import type { ConsentKind } from "./consents.ts";

export type Civilite = "madame" | "monsieur";

export interface Profil {
  civilite: Civilite | null;
  prenom: string | null;
  nom: string | null;
  nomUsage: string | null;
  dateNaissance: string | null;
  courriel: string | null;
  mobile: string | null;
  fixe: string | null;
  adresse1: string | null;
  adresse2: string | null;
  codePostal: string | null;
  ville: string | null;
  /**
   * Les consentements RGPD de la PERSONNE, tels que le Socle les tient — TROIS
   * états : accordé, refusé (`accorde: false`, daté), jamais demandé (`null`).
   * C'est la date qui tranche, jamais le booléen seul (règle de la gamme).
   */
  consentements: Record<ConsentKind, ConsentEtat | null>;
}

export interface ConsentEtat {
  accorde: boolean;
  /** Date du dernier recueil (ISO). */
  le: string;
}

/** L'identité saisie au premier remplissage (CCTP Sceaux 5.1). */
export interface ProfilIdentite {
  civilite: Civilite;
  prenom: string;
  nom: string;
  nomUsage: string | null;
  dateNaissance: string | null;
  mobile: string | null;
  fixe: string | null;
  adresse1: string;
  adresse2: string | null;
  codePostal: string;
  ville: string;
}

/** Ce que l'usager modifie ensuite lui-même. */
export type ProfilCoordonnees = {
  [K in "nomUsage" | "mobile" | "fixe" | "adresse1" | "adresse2" | "codePostal" | "ville"]?: string | null;
};

export type ProfilChamp = keyof ProfilIdentite;

/** Champs obligatoires de l'identité, dans l'ordre de l'écran. */
export const PROFIL_OBLIGATOIRES: readonly ProfilChamp[] = ["civilite", "prenom", "nom", "adresse1", "codePostal", "ville"];

const COORDONNEES: readonly (keyof ProfilCoordonnees)[] = ["nomUsage", "mobile", "fixe", "adresse1", "adresse2", "codePostal", "ville"];

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" || t.length > max ? null : t;
}

export type ProfilParse<T> = { ok: true; value: T } | { ok: false; champs: ProfilChamp[] };

/** L'identité, bornée ; la liste des champs en défaut sinon (l'écran les signale un par un). */
export function parseIdentite(body: unknown): ProfilParse<ProfilIdentite> {
  const r = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const fautifs: ProfilChamp[] = [];
  const civilite = r.civilite === "madame" || r.civilite === "monsieur" ? r.civilite : null;
  if (civilite === null) fautifs.push("civilite");
  const champ = (key: ProfilChamp, required: boolean, check?: (v: string) => boolean): string | null => {
    const v = text(r[key]);
    if ((v === null && required) || (v !== null && check && !check(v))) fautifs.push(key);
    return v;
  };
  const prenom = champ("prenom", true);
  const nom = champ("nom", true);
  const nomUsage = champ("nomUsage", false);
  const dateNaissance = champ("dateNaissance", false, isBirthDate);
  const mobile = champ("mobile", false, (v) => /^[+\d][\d .-]{5,19}$/.test(v));
  const fixe = champ("fixe", false, (v) => /^[+\d][\d .-]{5,19}$/.test(v));
  const adresse1 = champ("adresse1", true);
  const adresse2 = champ("adresse2", false);
  const codePostal = champ("codePostal", true, (v) => /^\d{5}$/.test(v));
  const ville = champ("ville", true);
  if (fautifs.length > 0) return { ok: false, champs: fautifs };
  return {
    ok: true,
    value: {
      civilite: civilite!,
      prenom: prenom!,
      nom: nom!,
      nomUsage,
      dateNaissance,
      mobile,
      fixe,
      adresse1: adresse1!,
      adresse2,
      codePostal: codePostal!,
      ville: ville!,
    },
  };
}

/** Les coordonnées modifiées ; un champ absent n'est pas touché, un champ vide est effacé (sauf obligatoire). */
export function parseCoordonnees(body: unknown): ProfilParse<ProfilCoordonnees> {
  const r = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const out: ProfilCoordonnees = {};
  const fautifs: ProfilChamp[] = [];
  for (const key of COORDONNEES) {
    if (!(key in r)) continue;
    const v = text(r[key]);
    const required = key === "adresse1" || key === "codePostal" || key === "ville";
    if (v === null && required) fautifs.push(key);
    else if (key === "codePostal" && v !== null && !/^\d{5}$/.test(v)) fautifs.push(key);
    else if ((key === "mobile" || key === "fixe") && v !== null && !/^[+\d][\d .-]{5,19}$/.test(v)) fautifs.push(key);
    else out[key] = v;
  }
  if (fautifs.length > 0) return { ok: false, champs: fautifs };
  return { ok: true, value: out };
}

/** La fiche du Socle (`CitizenContact`) → le profil du portail. */
export function toProfil(body: unknown): Profil | null {
  const r = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  if (r === null || typeof r.id !== "string") return null;
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    civilite: r.civility === "madame" || r.civility === "monsieur" ? r.civility : null,
    prenom: s(r.first_name),
    nom: s(r.last_name),
    nomUsage: s(r.usage_name),
    dateNaissance: s(r.birth_date),
    courriel: s(r.email),
    mobile: s(r.mobile_phone),
    fixe: s(r.landline_phone),
    adresse1: s(r.address_line1),
    adresse2: s(r.address_line2),
    codePostal: s(r.postal_code),
    ville: s(r.city),
    consentements: {
      traitement: consentEtat(r.consent_traitement, r.consent_traitement_at),
      partage: consentEtat(r.consent_partage, r.consent_partage_at),
    },
  };
}

function consentEtat(granted: unknown, at: unknown): ConsentEtat | null {
  return typeof at === "string" && typeof granted === "boolean" ? { accorde: granted, le: at } : null;
}

/**
 * Le profil → les réponses du bloc « Vos informations » d'un formulaire, aux
 * clés du paramétrage du Socle (`requesterConfig.ts`, public `citoyen`) — le
 * préremplissage du dépôt connecté (« Dites-le nous une fois », CCTP 3.5).
 * Seules les clés renseignées sont rendues ; l'usager peut tout corriger.
 */
/**
 * Une date de naissance RÉELLE (AAAA-MM-JJ) : la forme ne suffit pas —
 * « 1990-02-31 » passait, puis le Socle échouait en 500 sur sa conversion.
 */
export function isBirthDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900
    && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getTime() <= Date.now();
}

export function requesterValuesFromProfil(profil: Profil): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: string | null) => {
    if (value !== null && value.trim() !== "") out[key] = value;
  };
  put("civilite", profil.civilite);
  put("nom_naissance", profil.nom);
  put("nom_usuel", profil.nomUsage ?? profil.nom);
  put("prenoms", profil.prenom);
  const rue = [profil.adresse1, profil.adresse2].filter((v) => v !== null && v.trim() !== "").join(", ");
  const commune = [profil.codePostal, profil.ville].filter((v) => v !== null && v.trim() !== "").join(" ");
  put("adresse", [rue, commune].filter((v) => v !== "").join(", ") || null);
  put("tel_portable", profil.mobile);
  put("tel_fixe", profil.fixe);
  put("courriel", profil.courriel);
  return out;
}

/** L'identité → le corps de `POST /v1/citizen/contacts/{compte}/link` (l'adresse est celle du compte). */
export function toSocleIdentity(identite: ProfilIdentite, courriel: string): Record<string, string> {
  const out: Record<string, string> = {
    civility: identite.civilite,
    first_name: identite.prenom,
    last_name: identite.nom,
    email: courriel,
    address_line1: identite.adresse1,
    postal_code: identite.codePostal,
    city: identite.ville,
  };
  const optional: [string, string | null][] = [
    ["usage_name", identite.nomUsage],
    ["birth_date", identite.dateNaissance],
    ["mobile_phone", identite.mobile],
    ["landline_phone", identite.fixe],
    ["address_line2", identite.adresse2],
  ];
  for (const [key, value] of optional) if (value !== null) out[key] = value;
  return out;
}

const COORDONNEES_SOCLE: Record<keyof ProfilCoordonnees, string> = {
  nomUsage: "usage_name",
  mobile: "mobile_phone",
  fixe: "landline_phone",
  adresse1: "address_line1",
  adresse2: "address_line2",
  codePostal: "postal_code",
  ville: "city",
};

/** Les coordonnées → le corps de `PATCH /v1/citizen/contacts/{compte}`. */
export function toSocleCoordonnees(coordonnees: ProfilCoordonnees): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(coordonnees) as [keyof ProfilCoordonnees, string | null][]) {
    out[COORDONNEES_SOCLE[key]] = value;
  }
  return out;
}
