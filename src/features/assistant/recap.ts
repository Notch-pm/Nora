/**
 * Le récapitulatif d'un recueil — ce que l'usager relit avant d'envoyer. Pur,
 * testé : les LIBELLÉS (pas les valeurs brutes) sont ce qui se relit, exactement
 * comme un usager qui a choisi « Gravats » doit revoir « Gravats », jamais
 * `gravats`.
 *
 * ⚠️ Un champ FACULTATIF passé (« Passer ») n'a pas de valeur : il apparaît
 * quand même, avec un tiret — un champ qui disparaîtrait purement et
 * simplement du récapitulatif serait indiscernable d'un champ qu'on aurait
 * oublié d'afficher.
 */
import type { FieldOriginRecord } from "@fn/_shared/ai/collection.ts";
import type { Field } from "@fn/_shared/domain/formSchema.ts";
import { isSection } from "@fn/_shared/domain/formSchema.ts";
import { piecesOf, visibleNodes } from "@fn/_shared/domain/formulaire.ts";
import { requesterFieldsFor, type Audience } from "@fn/_shared/domain/requesterConfig.ts";
import { t } from "@/i18n/t.ts";
import type { StringKey } from "@/i18n/strings.ts";
import { effectiveOrganizationId, type CollectSession } from "./collect.ts";

/** Ce qu'on affiche quand il n'y a rien à montrer — jamais un blanc muet. */
const EMPTY = "—";

export interface RecapRow {
  /** `id` du champ (formulaire) ou clé du champ requérant (identité). */
  fieldId: string;
  label: string;
  value: string;
  /**
   * D'où vient la valeur, quand c'est l'ASSISTANT qui l'a posée — `undefined`
   * quand l'usager l'a saisie lui-même.
   *
   * ⚠️ C'est ici que l'origine sert vraiment : le récapitulatif est le dernier
   * écran avant l'envoi, celui où l'usager signe. Distinguer « ce que vous avez
   * dit » de « ce que j'en ai déduit » est ce qui lui permet de relire sans
   * tout relire. Jamais dans l'identité : elle ne passe pas par le modèle.
   */
  origin?: FieldOriginRecord;
}

export interface RecapSection {
  id: string;
  /** `null` pour un champ hors section : pas de titre à afficher. */
  title: string | null;
  rows: RecapRow[];
}

export interface RecapIdentity {
  audienceLabel: string;
  rows: RecapRow[];
}

export interface RecapSummary {
  sections: RecapSection[];
  organization: { id: string; name: string } | null;
  /** `null` : aucun public choisi — la demande part sans identité déclarée. */
  identity: RecapIdentity | null;
}

const AUDIENCE_LABEL_KEYS: Record<Audience, StringKey> = {
  citoyen: "audience.citoyen",
  entreprise: "audience.entreprise",
  association: "audience.association",
};

function formatFieldValue(lang: string, field: Field, value: unknown): string {
  switch (field.type) {
    case "boolean":
      return t(lang, value === true ? "form.yes" : "assistant.recap.no");
    case "select":
    case "radio": {
      const option = field.options.find((o) => o.value === value);
      return option ? option.label : EMPTY;
    }
    case "checkboxes": {
      const selected = Array.isArray(value) ? (value as unknown[]) : [];
      const labels = field.options.filter((o) => selected.includes(o.value)).map((o) => o.label);
      return labels.length > 0 ? labels.join(", ") : EMPTY;
    }
    case "attachment": {
      const pieces = piecesOf(value);
      return pieces.length > 0 ? pieces.map((p) => p.name).join(", ") : EMPTY;
    }
    default:
      return typeof value === "string" && value.trim() !== "" ? value : EMPTY;
  }
}

function formatRequesterValue(lang: string, key: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") return EMPTY;
  if (key === "civilite") return t(lang, value === "madame" ? "requester.madame" : "requester.monsieur");
  return value;
}

/** Le récapitulatif complet, sections respectées — recalculé, jamais mémorisé. */
export function buildRecap(lang: string, session: CollectSession): RecapSummary {
  const { demarche, collection } = session;
  const sections: RecapSection[] = [];
  for (const node of visibleNodes(demarche.form, collection.values)) {
    if (isSection(node)) {
      sections.push({
        id: node.id,
        title: node.title,
        rows: node.fields.map((field) => ({
          fieldId: field.id,
          label: field.label,
          value: formatFieldValue(lang, field, collection.values[field.id]),
          origin: collection.origins[field.id],
        })),
      });
    } else {
      sections.push({
        id: node.id,
        title: null,
        rows: [
          {
            fieldId: node.id,
            label: node.label,
            value: formatFieldValue(lang, node, collection.values[node.id]),
            origin: collection.origins[node.id],
          },
        ],
      });
    }
  }

  const orgId = effectiveOrganizationId(session);
  const foundOrganization = orgId === null ? null : demarche.organizations.find((o) => o.id === orgId) ?? null;
  const organization = foundOrganization === null ? null : { id: foundOrganization.id, name: foundOrganization.name };

  const identity: RecapIdentity | null =
    session.audience === null
      ? null
      : {
          audienceLabel: t(lang, AUDIENCE_LABEL_KEYS[session.audience]),
          rows: requesterFieldsFor(demarche.requester, session.audience).map((field) => ({
            fieldId: field.key,
            label: field.label,
            value: formatRequesterValue(lang, field.key, session.requesterValues[field.key]),
          })),
        };

  return { sections, organization, identity };
}
