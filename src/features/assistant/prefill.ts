/**
 * Le pré-remplissage du formulaire classique depuis un recueil de l'assistant
 * — le REPLI permanent (« Continuer dans le formulaire classique »). Pur,
 * testé : la lecture tolère tout, l'écriture n'en a pas besoin.
 *
 * ⚠️ Une clé PAR DÉMARCHE (`nora.assistant.prefill.<id>`) : l'usager peut
 * ouvrir cette adresse depuis un autre onglet, ou après avoir consulté une
 * autre démarche entre-temps — un pré-remplissage NE DOIT JAMAIS s'appliquer
 * à une autre démarche que la sienne. `FormulairePage` le lit UNE fois au
 * montage puis l'efface (`readAndClearPrefill`) : rouvrir la même page
 * ensuite retrouve un formulaire vide, comme d'habitude.
 */
import type { FormValues } from "@fn/_shared/domain/conditions.ts";
import type { Audience } from "@fn/_shared/domain/requesterConfig.ts";
import type { CollectSession } from "./collect.ts";

export interface DemarchePrefill {
  values: FormValues;
  requesterValues: Record<string, string>;
  audience: Audience | null;
  organizationId: string | null;
}

export function prefillStorageKey(demarcheId: string): string {
  return "nora.assistant.prefill." + demarcheId;
}

const AUDIENCES_KNOWN: readonly Audience[] = ["citoyen", "entreprise", "association"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializePrefill(prefill: DemarchePrefill): string {
  return JSON.stringify(prefill);
}

/** Lecture tolérante — tout ce qui ne convainc pas retombe sur un défaut vide. */
export function parsePrefill(raw: string | null): DemarchePrefill | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const values: FormValues = isRecord(parsed.values) ? (parsed.values as FormValues) : {};

  const requesterValues: Record<string, string> = {};
  if (isRecord(parsed.requesterValues)) {
    for (const [key, value] of Object.entries(parsed.requesterValues)) {
      if (typeof value === "string") requesterValues[key] = value;
    }
  }

  const audience = (AUDIENCES_KNOWN as readonly unknown[]).includes(parsed.audience) ? (parsed.audience as Audience) : null;
  const organizationId =
    typeof parsed.organizationId === "string" && parsed.organizationId !== "" ? parsed.organizationId : null;

  return { values, requesterValues, audience, organizationId };
}

/** Ce qu'on retient d'un recueil en cours, pour proposer le formulaire classique. */
export function buildPrefill(session: CollectSession): DemarchePrefill {
  return {
    values: session.collection.values,
    requesterValues: session.requesterValues,
    audience: session.audience,
    organizationId: session.organizationId,
  };
}

/** Ce qu'un `sessionStorage` doit savoir faire — même motif que `ConversationStorage`. */
export interface PrefillStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Dépose le pré-remplissage avant de quitter vers le formulaire classique. */
export function writePrefill(storage: PrefillStorage, demarcheId: string, prefill: DemarchePrefill): void {
  try {
    storage.setItem(prefillStorageKey(demarcheId), serializePrefill(prefill));
  } catch {
    // Pas de mémoire : le lien s'ouvre quand même, le formulaire sera juste vide.
  }
}

/** Le lit UNE fois, puis l'efface — la relecture retombe toujours sur `null`. */
export function readAndClearPrefill(storage: PrefillStorage, demarcheId: string): DemarchePrefill | null {
  const key = prefillStorageKey(demarcheId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  try {
    storage.removeItem(key);
  } catch {
    // Tant pis : au pire une relecture retrouverait la même valeur.
  }
  return parsePrefill(raw);
}
