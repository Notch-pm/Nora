/**
 * Les consentements RGPD demandés SYSTÉMATIQUEMENT à l'usager au dépôt, quelle
 * que soit la démarche — le modèle du PORTAIL.
 *
 * ⚠️ **Miroir volontaire** du catalogue FERMÉ d'Iris
 * (`supabase/functions/_shared/consents/catalog.ts`), qui le possède, et dont
 * le Socle garde la preuve (`contact_consents`, contrat `contacts-api` 1.2.0).
 * Même motif que `requesterConfig.ts` : une edge function ne peut rien importer
 * d'un autre projet, et un paquet partagé coûterait plus cher que deux fichiers
 * d'accord, épinglés par leurs tests.
 *
 * Deux questions, et ce ne sont **pas** des champs de `form_schema` : elles ne
 * se paramètrent pas démarche par démarche, ne s'ajoutent pas, ne se retirent
 * pas. Un consentement qu'une collectivité pourrait décocher dans son
 * paramétrage ne vaudrait rien — c'est tout l'objet d'un catalogue fermé.
 *
 *   • `traitement` — utiliser les informations fournies pour instruire la
 *     demande. **Obligatoire** : sans lui, le dépôt n'existe pas, ni à l'écran,
 *     ni au serveur (`normalizeConsents`), ni chez Iris.
 *   • `partage` — partager ces informations aux services de la collectivité,
 *     pour cette demande et les suivantes. Facultatif, **proposé coché**.
 *
 * ⚠️ Le portail n'envoie JAMAIS le libellé : seulement `[{ kind, granted }]`.
 * La phrase consignée est recomposée par Iris depuis le nom de la collectivité
 * relu dans sa base — un `statement` envoyé serait refusé (400). Ce que
 * l'écran AFFICHE doit donc être cette phrase-là, mot pour mot : le dictionnaire
 * (`consent.traitement`, `consent.partage`) la porte, et `consents.test.ts`
 * épingle son français sur celui d'Iris.
 *
 * ⚠️ Un `kind` du catalogue non coché vaut REFUS, jamais un défaut silencieux :
 * `toConsentAnswers` rend toujours les deux réponses, une absence comptant
 * pour `false`. Le « coché par défaut » de `partage` est une commodité d'écran,
 * pas une présomption de consentement — la case reste visible et décochable.
 */
import type { FieldErrors } from "./formulaire.ts";

/** Les deux consentements du catalogue. Aucun autre n'existe. */
export type ConsentKind = "traitement" | "partage";

export interface ConsentDef {
  kind: ConsentKind;
  /** Sans lui, le dépôt ne peut pas être envoyé (garde d'écran ET de serveur). */
  required: boolean;
  /** État de la case à l'ouverture du formulaire. */
  defaultGranted: boolean;
}

/** Le catalogue, dans l'ordre d'affichage : l'obligatoire d'abord. */
export const CONSENTS: readonly ConsentDef[] = [
  { kind: "traitement", required: true, defaultGranted: false },
  { kind: "partage", required: false, defaultGranted: true },
];

const BY_KIND = new Map<string, ConsentDef>(CONSENTS.map((c) => [c.kind, c]));

export function isConsentKind(value: unknown): value is ConsentKind {
  return typeof value === "string" && BY_KIND.has(value);
}

/** Ce que l'usager a coché, par consentement — l'état d'écran. */
export type ConsentAnswers = Record<ConsentKind, boolean>;

/** Un consentement tel qu'il part dans la demande : la réponse, et rien d'autre. */
export interface ConsentAnswer {
  kind: ConsentKind;
  granted: boolean;
}

/** La clé sous laquelle l'erreur d'un consentement est rangée dans `FieldErrors`. */
export function consentErrorKey(kind: ConsentKind): string {
  return "consent." + kind;
}

/** L'état initial des cases : `traitement` décoché, `partage` coché. */
export function defaultConsentAnswers(): ConsentAnswers {
  const out = {} as ConsentAnswers;
  for (const def of CONSENTS) out[def.kind] = def.defaultGranted;
  return out;
}

/**
 * Lecture TOLÉRANTE d'un état rangé (`sessionStorage`, pré-remplissage) : un
 * consentement absent ou abîmé retombe sur son défaut, jamais sur une
 * exception. Rien de ce qui est lu ici ne part sans repasser par la case.
 */
export function parseConsentAnswers(raw: unknown): ConsentAnswers {
  const out = defaultConsentAnswers();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  const record = raw as Record<string, unknown>;
  for (const def of CONSENTS) {
    const value = record[def.kind];
    if (typeof value === "boolean") out[def.kind] = value;
  }
  return out;
}

/**
 * Les erreurs du bloc de consentements — un consentement OBLIGATOIRE non coché.
 * Même forme que `validateRequester` : un code, pas une phrase, et c'est
 * l'écran qui la rend (`errorText`).
 */
export function validateConsents(answers: Partial<ConsentAnswers>): FieldErrors {
  const errors: FieldErrors = {};
  for (const def of CONSENTS) {
    if (def.required && answers[def.kind] !== true) {
      errors[consentErrorKey(def.kind)] = { key: "validation.consentRequired" };
    }
  }
  return errors;
}

/**
 * Les consentements tels qu'ils partent dans la demande : TOUS ceux du
 * catalogue, dans son ordre, une absence valant `false`. Une case qu'on n'a
 * pas cochée est un refus, pas une question qu'on aurait oublié de poser.
 */
export function toConsentAnswers(answers: Partial<ConsentAnswers>): ConsentAnswer[] {
  return CONSENTS.map((def) => ({ kind: def.kind, granted: answers[def.kind] === true }));
}

export type ConsentParse =
  | { ok: true; consents: ConsentAnswer[] }
  | { ok: false; message: string };

/**
 * La garde SERVEUR du dépôt (`portal-api`), miroir de celle d'Iris : le corps
 * doit porter `consents: [{ kind, granted }]`, kinds du catalogue, sans doublon
 * ni clé en plus, et le consentement obligatoire ACCORDÉ. Tout le reste est un
 * 400 — c'est le portail qui a affiché la case, il ne transmet pas à Iris un
 * dépôt qu'il sait irrecevable, et n'attend pas d'Iris qu'il le lui dise.
 *
 * ⚠️ `consents` absent est refusé, pas toléré : contrairement à un partenaire
 * d'ingestion, l'écran de ce portail pose toujours la question. Un corps sans
 * consentements vient d'une interface d'avant ce lot, ou d'une enveloppe
 * fabriquée — dans les deux cas, on ne dépose pas sans accord.
 */
export function normalizeConsents(raw: unknown): ConsentParse {
  if (raw === undefined || raw === null) {
    return { ok: false, message: "consents : tableau des consentements requis." };
  }
  if (!Array.isArray(raw)) return { ok: false, message: "consents : tableau attendu." };
  if (raw.length > CONSENTS.length) {
    return { ok: false, message: "consents : plus de consentements que le catalogue n'en compte." };
  }
  const answers: Partial<ConsentAnswers> = {};
  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { ok: false, message: `consents[${i}] : objet attendu.` };
    }
    const row = entry as Record<string, unknown>;
    const unknown = Object.keys(row).filter((k) => k !== "kind" && k !== "granted");
    if (unknown.length > 0) {
      return { ok: false, message: `consents[${i}] : seules les clés kind et granted sont acceptées.` };
    }
    if (!isConsentKind(row.kind)) {
      return { ok: false, message: `consents[${i}].kind : valeur hors catalogue.` };
    }
    if (typeof row.granted !== "boolean") {
      return { ok: false, message: `consents[${i}].granted : booléen attendu.` };
    }
    if (row.kind in answers) {
      return { ok: false, message: `consents[${i}].kind : ${row.kind} transmis deux fois.` };
    }
    answers[row.kind] = row.granted;
  }
  for (const def of CONSENTS) {
    if (def.required && answers[def.kind] !== true) {
      return {
        ok: false,
        message:
          "Le consentement à l'utilisation des informations pour le traitement de la demande " +
          "est obligatoire : sans lui, la demande ne peut pas être envoyée.",
      };
    }
  }
  return { ok: true, consents: toConsentAnswers(answers) };
}
