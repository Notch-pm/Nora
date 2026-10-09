/**
 * « Vos informations » d'un courrier libre — le pont entre le bloc d'identité
 * des démarches (`RequesterSection`, réutilisé tel quel) et le contrat de
 * Clara (`sender_*`).
 *
 * Le bloc des démarches parle les clés du Socle (`prenoms`, `nom_usuel`,
 * `courriel`…) : c'est ce qui lui donne, sans rien changer, la bonne liste des
 * civilités, le bon type de champ et le bon jeton `autocomplete` (RGAA 11.13).
 * Le courrier, lui, parle `senderFirstName`, `senderEmail`… Ce module traduit
 * dans les deux sens, en un seul endroit. Pur, testé.
 *
 * ⚠️ Contrairement à une démarche, ici le PORTAIL fixe les champs — il n'y a
 * pas de `requester_config` : le contrat de Clara dit ce qui est obligatoire
 * (prénom et nom d'un citoyen, raison sociale d'une entreprise, un moyen de
 * répondre), et l'écran le reflète.
 */
import type { CourrierDraft, CourrierField, SenderCategory } from "@fn/_shared/domain/courrier.ts";
import type { FieldErrors } from "@fn/_shared/domain/formulaire.ts";
import type { RequesterField } from "@fn/_shared/domain/requesterConfig.ts";
import type { StringKey } from "@/i18n/strings.ts";

/** Champ du courrier ↔ clé du bloc d'identité. */
type SenderField = "senderCivilite" | "senderFirstName" | "senderLastName" | "senderEmail" | "senderPhone";

interface SenderFieldDef {
  field: SenderField;
  key: string;
  label: StringKey;
  required: boolean;
}

const CONTACT: SenderFieldDef[] = [
  { field: "senderEmail", key: "courriel", label: "courrierLibre.email", required: false },
  { field: "senderPhone", key: "tel_portable", label: "courrierLibre.phone", required: false },
];

const BY_CATEGORY: Record<SenderCategory, SenderFieldDef[]> = {
  citoyen: [
    { field: "senderCivilite", key: "civilite", label: "courrierLibre.civilite", required: false },
    { field: "senderFirstName", key: "prenoms", label: "courrierLibre.firstName", required: true },
    { field: "senderLastName", key: "nom_usuel", label: "courrierLibre.lastName", required: true },
    ...CONTACT,
  ],
  entreprise: [
    { field: "senderLastName", key: "raison_sociale", label: "courrierLibre.companyName", required: true },
    ...CONTACT,
  ],
  association: [
    { field: "senderLastName", key: "raison_sociale", label: "courrierLibre.associationName", required: true },
    ...CONTACT,
  ],
};

/** Les champs du bloc d'identité pour ce public, libellés traduits par `translate`. */
export function senderFields(
  category: SenderCategory,
  translate: (key: StringKey) => string,
): RequesterField[] {
  return BY_CATEGORY[category].map((def) => ({ key: def.key, label: translate(def.label), required: def.required }));
}

/** Le courrier complet, depuis la saisie : texte + identité du public retenu. */
export function toCourrierDraft(
  text: { subject: string; body: string },
  category: SenderCategory,
  values: Record<string, string>,
): CourrierDraft {
  const draft: CourrierDraft = {
    subject: text.subject,
    body: text.body,
    senderCategory: category,
    senderCivilite: "",
    senderFirstName: "",
    senderLastName: "",
    senderEmail: "",
    senderPhone: "",
  };
  for (const def of BY_CATEGORY[category]) draft[def.field] = values[def.key] ?? "";
  return draft;
}

/**
 * Les erreurs du courrier, rangées là où l'écran les affiche : sous les clés
 * du bloc d'identité pour l'expéditeur, sous leur nom pour le reste (`subject`,
 * `body`, `files`).
 */
export function splitCourrierErrors(
  errors: FieldErrors,
  category: SenderCategory,
): { text: FieldErrors; sender: FieldErrors } {
  const text: FieldErrors = {};
  const sender: FieldErrors = {};
  const keyOf = new Map<string, string>(BY_CATEGORY[category].map((def) => [def.field, def.key]));
  for (const [name, error] of Object.entries(errors) as [CourrierField, FieldErrors[string]][]) {
    const key = keyOf.get(name);
    if (key !== undefined) sender[key] = error;
    else text[name] = error;
  }
  return { text, sender };
}
