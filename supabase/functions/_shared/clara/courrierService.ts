/**
 * Le dépôt d'un COURRIER LIBRE — ce que `POST /v1/courriers` fait, dans
 * l'ordre, sans Deno ni réseau (le Socle et Clara sont des ports).
 *
 *   1. lire l'envoi du navigateur (`multipart/form-data`) et le valider avec
 *      les règles de l'écran (`domain/courrier.ts`) — fichiers compris :
 *      taille et extension, AVANT tout relais ;
 *   2. les consentements RGPD (`normalizeConsents`, seuls `kind`/`granted`) ;
 *   3. la porte anti-robot, liée à l'identifiant de dépôt ;
 *   4. l'organisme visé : il doit appartenir à la collectivité du domaine
 *      (celle que `portal-api` a résolue par `Origin`) ET recevoir du courrier
 *      libre (`free_mail.enabled`, décidé au Socle) ;
 *   5. le relais à Clara, et la traduction de sa réponse en un code que
 *      l'écran sait dire.
 *
 * Le portail ne garde rien : ni le texte, ni les fichiers, ni l'accusé. Rien
 * n'est journalisé du contenu.
 *
 * ⚠️ Les pièces partent AVEC le courrier, en un seul envoi — pas déposées à la
 * sélection comme pour Iris. Clara n'a pas de zone d'attente, et trois fichiers
 * de 5 Mo tiennent dans une requête.
 */
import {
  cleanCourrier,
  type CourrierDraft,
  type CourrierFailure,
  type CourrierOrganisme,
  courrierOrganismeOf,
  type CourrierReceipt,
  fileProblem,
  MAX_COURRIER_FILES,
  type SenderCategory,
  SENDER_CATEGORIES,
  SUBMISSION_ID_RE,
  validateCourrier,
} from "../domain/courrier.ts";
import { type ConsentAnswer, normalizeConsents } from "../domain/consents.ts";
import type { DepositGate } from "../ai/depositGate.ts";
import { getCourrierOrganismes } from "../socle/organismeInfoService.ts";
import type { SocleClient } from "../socle/socleClient.ts";
import type { ClaraClient } from "./claraClient.ts";

/** Ce que le navigateur envoie, une fois lu — avant toute lecture du Socle. */
export interface CourrierEnvoi {
  /** Le slug de l'organisme visé ; `null` = la collectivité du domaine. */
  organisme: string | null;
  submissionId: string;
  courrier: CourrierDraft;
  consents: ConsentAnswer[];
  /** Le défi résolu, tel que présenté (vérifié plus loin), ou `undefined`. */
  challenge: unknown;
  files: File[];
}

export type CourrierRead =
  | { ok: true; envoi: CourrierEnvoi }
  | { ok: false; failure: CourrierFailure; message: string };

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function parseJsonField(form: FormData, name: string): { ok: true; value: unknown } | { ok: false } {
  const raw = form.get(name);
  if (raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "string") return { ok: false };
  if (raw.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
}

/**
 * Lit et valide l'envoi du navigateur. Les noms de champs sont ceux du contrat
 * de Clara (`subject`, `sender_last_name`…), plus ceux du portail
 * (`organisme`, `submission_id`, `consents` et `challenge` en JSON).
 *
 * ⚠️ Un message, jamais la saisie : ce qui revient au navigateur nomme le champ
 * fautif, pas ce que l'usager y a écrit.
 */
export function readCourrierForm(form: FormData): CourrierRead {
  const invalid = (message: string): CourrierRead => ({ ok: false, failure: "invalid_courrier", message });

  const submissionId = field(form, "submission_id").trim();
  if (!SUBMISSION_ID_RE.test(submissionId)) return invalid("submission_id : UUID attendu.");

  const rawCategory = field(form, "sender_category").trim();
  const senderCategory: SenderCategory | undefined = rawCategory === ""
    ? "citoyen"
    : SENDER_CATEGORIES.find((c) => c === rawCategory);
  if (senderCategory === undefined) {
    return invalid("sender_category : citoyen, entreprise ou association attendu.");
  }

  const draft: CourrierDraft = {
    subject: field(form, "subject"),
    body: field(form, "body"),
    senderCategory,
    senderCivilite: field(form, "sender_civilite"),
    senderFirstName: field(form, "sender_first_name"),
    senderLastName: field(form, "sender_last_name"),
    senderEmail: field(form, "sender_email"),
    senderPhone: field(form, "sender_phone"),
  };

  const files: File[] = [];
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") return invalid("files : fichier attendu.");
    files.push(entry as File);
  }
  if (files.length > MAX_COURRIER_FILES) {
    return invalid(`files : ${MAX_COURRIER_FILES} fichiers au plus.`);
  }
  // Les fichiers d'abord, avec LEUR code : l'écran dit « trop lourd » ou
  // « format refusé », pas « courrier incomplet ».
  for (const file of files) {
    const problem = fileProblem(file);
    if (problem === "too_large") {
      return { ok: false, failure: "file_too_large", message: "Un fichier dépasse 5 Mo." };
    }
    if (problem === "unsupported") {
      return { ok: false, failure: "file_unsupported", message: "Un fichier n'est pas d'un format accepté." };
    }
    if (problem === "empty") return invalid("files : un fichier est vide.");
  }

  const errors = validateCourrier(draft, files);
  const fautifs = Object.keys(errors);
  if (fautifs.length > 0) return invalid("Champs à corriger : " + fautifs.join(", ") + ".");

  const consentsJson = parseJsonField(form, "consents");
  if (!consentsJson.ok) return invalid("consents : JSON attendu.");
  const consents = normalizeConsents(consentsJson.value);
  if (!consents.ok) return invalid(consents.message);

  const challenge = parseJsonField(form, "challenge");
  if (!challenge.ok) return invalid("challenge : JSON attendu.");

  const organisme = field(form, "organisme").trim();
  return {
    ok: true,
    envoi: {
      organisme: organisme === "" ? null : organisme,
      submissionId,
      courrier: cleanCourrier(draft),
      consents: consents.consents,
      challenge: challenge.value,
      files,
    },
  };
}

/**
 * L'enveloppe de Clara — `multipart/form-data`, champs du contrat
 * `nora-courrier`. Un champ vide n'est pas envoyé : une chaîne vide écraserait
 * une information par un blanc.
 */
export function claraForm(
  organisme: CourrierOrganisme,
  envoi: Pick<CourrierEnvoi, "submissionId" | "courrier" | "consents" | "files">,
): FormData {
  const form = new FormData();
  const put = (name: string, value: string) => {
    if (value !== "") form.append(name, value);
  };
  put("socle_organization_id", organisme.id);
  put("submission_id", envoi.submissionId);
  put("subject", envoi.courrier.subject);
  put("body", envoi.courrier.body);
  put("sender_category", envoi.courrier.senderCategory);
  put("sender_civilite", envoi.courrier.senderCivilite);
  put("sender_first_name", envoi.courrier.senderFirstName);
  put("sender_last_name", envoi.courrier.senderLastName);
  put("sender_email", envoi.courrier.senderEmail);
  put("sender_phone", envoi.courrier.senderPhone);
  // Toujours les deux, en toutes lettres : une absence vaut refus, jamais oubli.
  const granted = (kind: string) => envoi.consents.some((c) => c.kind === kind && c.granted);
  form.append("consent_traitement", granted("traitement") ? "true" : "false");
  form.append("consent_partage", granted("partage") ? "true" : "false");
  for (const file of envoi.files) form.append("files", file, file.name);
  return form;
}

export type CourrierOutcome =
  | { ok: true; receipt: CourrierReceipt }
  | { ok: false; failure: CourrierFailure; message?: string };

/** Relaie un courrier déjà validé à Clara, et traduit sa réponse. */
export async function relayCourrier(
  organisme: CourrierOrganisme,
  envoi: Pick<CourrierEnvoi, "submissionId" | "courrier" | "consents" | "files">,
  clara: ClaraClient,
): Promise<CourrierOutcome> {
  const reply = await clara.postCourrier(claraForm(organisme, envoi));
  switch (reply.kind) {
    case "ok": {
      const body = reply.body as Record<string, unknown>;
      // Un 200 sans `ok: true` ni identifiant n'est pas un courrier reçu : on
      // n'annonce pas à l'usager un envoi dont on n'a pas la preuve.
      if (body.ok !== true || typeof body.courier_id !== "string" || body.courier_id === "") {
        return { ok: false, failure: "clara_unavailable" };
      }
      const reference = typeof body.reference === "string" && body.reference.trim() !== ""
        ? body.reference.trim()
        : null;
      return {
        ok: true,
        receipt: { reference, duplicate: body.duplicate === true, organismeName: organisme.name },
      };
    }
    case "validation":
      // Le portail a déjà appliqué les mêmes règles : un refus ici est un écart
      // de contrat. Le message de Clara va au JOURNAL (via `message`), jamais à
      // l'usager.
      return { ok: false, failure: "courrier_rejected", message: reply.message ?? undefined };
    case "organisme_inconnu":
    case "organisme_ambigu":
      return { ok: false, failure: "courrier_undeliverable", message: reply.kind };
    case "unauthorized":
      return { ok: false, failure: "clara_misconfigured" };
    case "failed":
    case "unreachable":
    case "unexpected":
      return { ok: false, failure: "clara_unavailable" };
  }
}

/**
 * Le dépôt entier, dans l'ordre de `portal-api` — après la résolution de la
 * collectivité par `Origin`, que l'appelant a faite (`tenantId`).
 */
export async function depositCourrier(input: {
  form: FormData;
  tenantId: string;
  socle: SocleClient;
  clara: ClaraClient;
  /** La porte anti-robot (`checkDepositChallenge`), liée à l'identifiant de dépôt. */
  checkChallenge: (challenge: unknown, submissionId: string) => Promise<DepositGate>;
}): Promise<CourrierOutcome> {
  const read = readCourrierForm(input.form);
  if (!read.ok) return { ok: false, failure: read.failure, message: read.message };
  const envoi = read.envoi;

  if ((await input.checkChallenge(envoi.challenge, envoi.submissionId)) !== "open") {
    return { ok: false, failure: "challenge_required" };
  }

  const organismes = await getCourrierOrganismes(input.tenantId, input.socle);
  if (!organismes.ok) return { ok: false, failure: "socle_unavailable", message: organismes.reason };

  // ⚠️ L'organisme est cherché DANS la collectivité du domaine : un slug d'une
  // autre collectivité n'y figure pas, et un organisme fermé non plus — même
  // « pas ici », le portail ne renseigne pas sur l'organigramme.
  const organisme = courrierOrganismeOf(organismes.organismes, envoi.organisme);
  if (organisme === null) return { ok: false, failure: "courrier_unavailable" };

  return relayCourrier(organisme, envoi, input.clara);
}
