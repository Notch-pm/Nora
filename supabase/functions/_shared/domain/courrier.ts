/**
 * Le COURRIER LIBRE — un usager écrit à un organisme sans passer par une
 * démarche, et son courrier arrive dans Clara (la gestion du courrier).
 *
 * Module PUR, partagé par l'edge function et l'écran (`@fn`) : les règles d'un
 * courrier — qui l'ouvre, ce qu'on doit y écrire, quels fichiers il emporte —
 * sont écrites UNE fois. L'écran guide la saisie avec elles, `portal-api` les
 * réapplique avant de relayer à Clara ; deux versions divergeraient au premier
 * cas limite, et ce serait l'usager qui le découvrirait.
 *
 * ⚠️ QUI L'OUVRE : le Socle, et lui seul. Chaque organisme de
 * `GET /v1/portal/organizations?tenant_id=` porte `free_mail: { enabled, title }`
 * (contrat public-api 1.38.0). `enabled` est LA décision — déjà conditionnée au
 * Socle à l'abonnement Clara de la collectivité. Le portail ne la refait pas,
 * et ne la devine pas : un champ absent (Socle d'avant 1.38.0), abîmé, ou
 * autre chose que `true` vaut FERMÉ. Même parti que `assistant.ts` — ouvrir au
 * doute ferait écrire des usagers à un organisme qui ne lira rien.
 */
import type { DemarcheOrganization } from "./demarche.ts";
import type { FieldErrors } from "./formulaire.ts";

/** Ce que la collectivité a ouvert du courrier libre, pour UN organisme. */
export interface FreeMail {
  enabled: boolean;
  /**
   * Le libellé choisi au Socle (« Écrire au maire », « Nous contacter »…).
   * `null` : le portail affiche son libellé par défaut, traduit
   * (`courrierLibre.title`). Jamais une chaîne vide.
   */
  title: string | null;
}

/** Le courrier libre fermé — l'état de tout organisme qui n'a rien ouvert. */
export function closedFreeMail(): FreeMail {
  return { enabled: false, title: null };
}

/** Borne du libellé : un titre de page, pas un paragraphe. */
const MAX_TITLE = 120;

/**
 * Le bloc `free_mail` d'un organisme, lu avec la méfiance d'un interrupteur :
 * seul `enabled === true` ouvre. Le titre n'est gardé que sous un courrier
 * ouvert — un titre sans courrier ne mène nulle part.
 */
export function parseFreeMail(raw: unknown): FreeMail {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return closedFreeMail();
  const block = raw as Record<string, unknown>;
  if (block.enabled !== true) return closedFreeMail();
  const title = typeof block.title === "string" ? block.title.trim() : "";
  return { enabled: true, title: title === "" ? null : title.slice(0, MAX_TITLE) };
}

/**
 * Un organisme tel que le courrier libre le voit : de quoi le nommer, le
 * retrouver par son adresse, et savoir s'il reçoit du courrier.
 *
 * ⚠️ Distinct d'`OrganismeInfo` (le corpus de l'assistant), qui écarte un
 * organisme n'ayant rien écrit dans « Informations usagers » : un organisme
 * peut ouvrir le courrier libre sans avoir rédigé une ligne d'horaires, et il
 * doit rester joignable.
 */
export interface CourrierOrganisme {
  /** UUID **Socle** — c'est lui qui part à Clara (`socle_organization_id`). */
  id: string;
  name: string;
  /** Son adresse sur le portail (`/{slug}`) ; `null` = pas de page propre. */
  slug: string | null;
  /** La collectivité du domaine elle-même — sa page, c'est l'accueil. */
  isTenant: boolean;
  freeMail: FreeMail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * La réponse de `/v1/portal/organizations`, vue du courrier libre. Tolérante :
 * un organisme illisible est écarté, les autres restent ; une réponse qui n'est
 * pas une liste vaut « personne n'a ouvert le courrier ».
 */
export function parseCourrierOrganismes(value: unknown): CourrierOrganisme[] {
  if (!Array.isArray(value)) return [];
  const out: CourrierOrganisme[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") continue;
    if (typeof raw.name !== "string" || raw.name.trim() === "" || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const slug = typeof raw.slug === "string" && raw.slug.trim() !== "" ? raw.slug.trim() : null;
    out.push({
      id: raw.id,
      name: raw.name.trim(),
      slug,
      isTenant: raw.is_tenant === true,
      freeMail: parseFreeMail(raw.free_mail),
    });
  }
  return out;
}

/**
 * L'organisme qu'une adresse de courrier désigne — et seulement s'il reçoit du
 * courrier libre.
 *
 * `slug === null` désigne la COLLECTIVITÉ du domaine (`/courrier`, sans
 * préfixe d'organisme) ; un slug désigne un de ses organismes, jamais la
 * collectivité elle-même (sa page est l'accueil, comme pour les démarches).
 * Inconnu, fermé ou ambigu : `null`, et c'est un même « pas ici » — le portail
 * ne renseigne pas sur l'organigramme.
 */
export function courrierOrganismeOf(
  organismes: readonly CourrierOrganisme[],
  slug: string | null,
): CourrierOrganisme | null {
  if (slug === null) {
    const tenant = organismes.find((org) => org.isTenant);
    return tenant !== undefined && tenant.freeMail.enabled ? tenant : null;
  }
  const wanted = slug.trim().toLowerCase();
  if (wanted === "") return null;
  const found = organismes.find(
    (org) => !org.isTenant && org.slug !== null && org.slug.toLowerCase() === wanted,
  );
  return found !== undefined && found.freeMail.enabled ? found : null;
}

/**
 * Les organismes qui reçoivent du courrier libre ET ont une page — de quoi
 * ouvrir une page d'organisme, ou une entrée « Ma ville », sans démarche
 * publiée. La collectivité n'en fait pas partie : sa page est l'accueil.
 */
export function courrierPages(organismes: readonly CourrierOrganisme[]): CourrierOrganisme[] {
  return organismes.filter((org) => !org.isTenant && org.slug !== null && org.freeMail.enabled);
}

/**
 * La page d'un organisme qui ne publie AUCUNE démarche mais reçoit du courrier
 * libre — sous la forme qu'a un organisme du catalogue, pour que la page
 * d'organisme n'ait qu'un seul type à rendre. Pas de logo propre : la liste des
 * organismes du Socle ne le sert pas, et la page peint de toute façon la charte
 * de l'organisme (héritage résolu au Socle).
 *
 * À n'appeler qu'APRÈS le catalogue (`organizationBySlug`) : un organisme qui
 * publie des démarches s'y trouve déjà, avec son logo.
 */
export function courrierPageBySlug(
  organismes: readonly CourrierOrganisme[],
  slug: string,
): DemarcheOrganization | null {
  const wanted = slug.trim().toLowerCase();
  if (wanted === "") return null;
  const found = courrierPages(organismes).find((org) => org.slug!.toLowerCase() === wanted);
  return found === undefined ? null : { id: found.id, name: found.name, slug: found.slug, logoUrl: null };
}

// ── Ce qu'un courrier doit contenir ─────────────────────────────────────────
//
// Bornes alignées sur le contrat de Clara (`nora-courrier`) : le portail ne
// relaie pas ce qu'il sait irrecevable.

export const MAX_SUBJECT = 500;
export const MAX_BODY = 20_000;
export const MAX_NAME = 200;
export const MAX_EMAIL = 320;
export const MAX_PHONE = 40;

/** Trois fichiers au plus, cinq Mo chacun — la borne de Clara. */
export const MAX_COURRIER_FILES = 3;
export const MAX_COURRIER_FILE_BYTES = 5 * 1_048_576;

/**
 * Les formats acceptés, par EXTENSION : documents et photos, ce qu'un usager
 * joint à un courrier. Liste FERMÉE — un exécutable renommé n'y entre pas par
 * son nom, et Clara revérifie de son côté.
 */
export const COURRIER_FILE_EXTENSIONS: readonly string[] = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "heic",
  "doc",
  "docx",
  "odt",
];

/** Qui écrit — les trois publics du Socle, avec leurs mots à lui. */
export type SenderCategory = "citoyen" | "entreprise" | "association";
export const SENDER_CATEGORIES: readonly SenderCategory[] = ["citoyen", "entreprise", "association"];

/** Les civilités telles que le Socle les stocke — la valeur ne se traduit jamais. */
export const CIVILITES: readonly string[] = ["madame", "monsieur"];

/** Un courrier tel que l'usager l'écrit — l'état de l'écran, et ce que lit le serveur. */
export interface CourrierDraft {
  subject: string;
  body: string;
  senderCategory: SenderCategory;
  /** Citoyen seulement, facultative. */
  senderCivilite: string;
  /** Obligatoire pour un citoyen ; ignoré pour une entreprise ou une association. */
  senderFirstName: string;
  /** Le nom — ou la RAISON SOCIALE pour une entreprise ou une association. */
  senderLastName: string;
  senderEmail: string;
  senderPhone: string;
}

/** Les champs d'un courrier qui peuvent porter une erreur (plus `files`). */
export type CourrierField = keyof Omit<CourrierDraft, "senderCategory"> | "files";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Lâche à dessein : un numéro étranger, des espaces, un indicatif. */
const PHONE_RE = /^\+?[0-9 ().-]{6,40}$/;

/** Un fichier vu par les règles — `File` côté écran comme côté serveur. */
export interface CourrierFileLike {
  name: string;
  size: number;
}

export type FileProblem = "empty" | "too_large" | "unsupported";

/** L'extension d'un nom de fichier, en minuscules — `""` sans extension. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Ce qui ne va pas dans UN fichier, ou `null`. */
export function fileProblem(file: CourrierFileLike): FileProblem | null {
  if (file.size <= 0) return "empty";
  if (file.size > MAX_COURRIER_FILE_BYTES) return "too_large";
  if (!COURRIER_FILE_EXTENSIONS.includes(fileExtension(file.name))) return "unsupported";
  return null;
}

/**
 * Les erreurs d'un courrier, par champ — un CODE, jamais une phrase (comme
 * `validateRequester`) : c'est l'écran qui la rend dans la langue du visiteur,
 * et le serveur qui en tire un 400.
 *
 * ⚠️ « Au moins un moyen de vous répondre » : un courriel OU un téléphone.
 * L'erreur se range sous le courriel — c'est le premier des deux à l'écran.
 */
export function validateCourrier(draft: CourrierDraft, files: readonly CourrierFileLike[] = []): FieldErrors {
  const errors: FieldErrors = {};
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  if (subject === "") errors.subject = { key: "validation.required" };
  else if (subject.length > MAX_SUBJECT) errors.subject = { key: "validation.maxLength", params: { n: MAX_SUBJECT } };
  if (body === "") errors.body = { key: "validation.required" };
  else if (body.length > MAX_BODY) errors.body = { key: "validation.maxLength", params: { n: MAX_BODY } };

  const citoyen = draft.senderCategory === "citoyen";
  if (citoyen) {
    const first = draft.senderFirstName.trim();
    if (first === "") errors.senderFirstName = { key: "validation.required" };
    else if (first.length > MAX_NAME) errors.senderFirstName = { key: "validation.maxLength", params: { n: MAX_NAME } };
  }
  const last = draft.senderLastName.trim();
  if (last === "") errors.senderLastName = { key: "validation.required" };
  else if (last.length > MAX_NAME) errors.senderLastName = { key: "validation.maxLength", params: { n: MAX_NAME } };

  const email = draft.senderEmail.trim();
  const phone = draft.senderPhone.trim();
  if (email === "" && phone === "") {
    errors.senderEmail = { key: "validation.contactRequired" };
  } else {
    if (email !== "" && (email.length > MAX_EMAIL || !EMAIL_RE.test(email))) {
      errors.senderEmail = { key: "validation.email" };
    }
    if (phone !== "" && (phone.length > MAX_PHONE || !PHONE_RE.test(phone))) {
      errors.senderPhone = { key: "validation.phone" };
    }
  }

  if (files.length > MAX_COURRIER_FILES) {
    errors.files = { key: "validation.maxFiles", params: { n: MAX_COURRIER_FILES } };
  } else {
    for (const file of files) {
      const problem = fileProblem(file);
      if (problem === null) continue;
      errors.files =
        problem === "too_large"
          ? { key: "validation.fileTooLarge", params: { name: file.name, size: MAX_COURRIER_FILE_BYTES / 1_048_576 } }
          : { key: "validation.fileUnsupported", params: { name: file.name } };
      break;
    }
  }
  return errors;
}

/**
 * Le courrier tel qu'il part : texte nettoyé, et ce qui ne concerne pas le
 * public choisi RETIRÉ — une civilité ou un prénom saisis avant de passer à
 * « entreprise » n'ont rien à faire dans le courrier d'une entreprise.
 */
export function cleanCourrier(draft: CourrierDraft): CourrierDraft {
  const citoyen = draft.senderCategory === "citoyen";
  const civilite = draft.senderCivilite.trim().toLowerCase();
  return {
    subject: draft.subject.trim(),
    body: draft.body.trim(),
    senderCategory: draft.senderCategory,
    senderCivilite: citoyen && CIVILITES.includes(civilite) ? civilite : "",
    senderFirstName: citoyen ? draft.senderFirstName.trim() : "",
    senderLastName: draft.senderLastName.trim(),
    senderEmail: draft.senderEmail.trim(),
    senderPhone: draft.senderPhone.trim(),
  };
}

/** Un identifiant de dépôt : un UUID, comme Clara l'exige pour l'idempotence. */
export const SUBMISSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** L'accusé d'un courrier — ce que l'usager peut noter. */
export interface CourrierReceipt {
  /** `null` quand Clara n'a pas (encore) attribué de référence : l'accusé le dit autrement. */
  reference: string | null;
  /** Un rejeu du même dépôt : Clara a rendu le courrier déjà reçu. */
  duplicate: boolean;
  /** À qui le courrier est parti — le nom affiché, pas un identifiant. */
  organismeName: string;
}

/**
 * Les façons dont un courrier peut ne pas partir. Union fermée, partagée par
 * `portal-api` (qui choisit) et l'écran (qui traduit par code).
 */
export type CourrierFailure =
  /** Le formulaire est incomplet ou invalide (la même règle que l'écran). */
  | "invalid_courrier"
  /** Un fichier dépasse 5 Mo, ou l'envoi entier est démesuré. */
  | "file_too_large"
  /** Un fichier n'est pas d'un format accepté. */
  | "file_unsupported"
  /** La preuve de travail manque ou est fausse — l'écran sait la refaire. */
  | "challenge_required"
  /** Cet organisme ne reçoit pas de courrier libre ici (inconnu, fermé). */
  | "courrier_unavailable"
  /** Trop d'envois depuis la même adresse en peu de temps. */
  | "too_many_courriers"
  /** Les secrets de Clara ne sont pas posés sur `portal-api`. */
  | "courrier_not_configured"
  /** Clara ne sait pas à qui remettre ce courrier (organisme inconnu ou ambigu chez elle). */
  | "courrier_undeliverable"
  /** Clara a refusé le contenu — un écart de contrat, pas une faute de l'usager. */
  | "courrier_rejected"
  /** Clara injoignable, ou en panne. */
  | "clara_unavailable"
  /** La clé du portail est refusée par Clara — panne de configuration. */
  | "clara_misconfigured"
  /** Le Socle n'a pas pu dire qui reçoit du courrier. */
  | "socle_unavailable";

export function httpStatusForCourrierFailure(failure: CourrierFailure): number {
  switch (failure) {
    case "invalid_courrier":
      return 400;
    case "courrier_unavailable":
      return 404;
    case "file_too_large":
      return 413;
    case "file_unsupported":
      return 415;
    case "courrier_rejected":
      return 422;
    case "challenge_required":
      return 428;
    case "too_many_courriers":
      return 429;
    case "courrier_undeliverable":
    case "clara_unavailable":
    case "clara_misconfigured":
    case "socle_unavailable":
      return 502;
    case "courrier_not_configured":
      return 503;
  }
}

/**
 * Le repli en français de chaque refus — l'écran traduit par CODE. Adressé à
 * un VISITEUR : ni Clara, ni Socle, ni clé. ⚠️ Jamais le message d'une panne
 * de Clara recopié tel quel : il parle à un exploitant, et peut citer ce que
 * l'usager n'a pas à lire.
 */
export const COURRIER_MESSAGES: Record<CourrierFailure, string> = {
  invalid_courrier: "Votre courrier est incomplet. Vérifiez les champs signalés.",
  file_too_large: "Un fichier dépasse la taille maximale de 5 Mo.",
  file_unsupported: "Un fichier n'est pas dans un format accepté.",
  challenge_required: "Votre courrier n'a pas pu être envoyé. Merci de réessayer.",
  courrier_unavailable: "Cet organisme ne reçoit pas de courrier en ligne.",
  too_many_courriers: "Trop d'envois en peu de temps : patientez une minute avant de réessayer.",
  courrier_not_configured: "L'envoi de courrier n'est pas disponible sur ce portail pour le moment.",
  courrier_undeliverable:
    "Votre courrier n'a pas pu être remis à cet organisme. Merci de le contacter directement.",
  courrier_rejected: "Votre courrier n'a pas pu être enregistré. Merci de contacter directement l'organisme.",
  clara_unavailable: "Votre courrier n'a pas pu être envoyé. Merci de réessayer dans quelques instants.",
  clara_misconfigured: "Votre courrier n'a pas pu être envoyé. Merci de réessayer dans quelques instants.",
  socle_unavailable: "Le service est momentanément indisponible. Merci de réessayer plus tard.",
};
