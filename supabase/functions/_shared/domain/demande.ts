/**
 * Une demande déposée par un usager — le modèle du PORTAIL.
 *
 * Le portail ne parle ni la langue du Socle ni celle d'Iris : il décrit ce
 * qu'un usager vient de faire, et la traduction vers l'enveloppe d'ingestion
 * d'Iris vit dans `iris/demandeService.ts`, en un seul endroit. Un renommage
 * de champ chez Iris ne remonte pas jusqu'aux écrans.
 */

/** Ce qu'un usager dépose : les réponses, qui il est, et pour quel organisme. */
export interface DemandeSubmission {
  /** La démarche remplie. Revérifiée au catalogue publié avant tout envoi. */
  demarcheId: string;
  /**
   * L'organisme destinataire — celui que l'usager a choisi quand la démarche
   * est proposée par plusieurs. `null` = laisser la collectivité trancher.
   */
  organizationId: string | null;
  /**
   * Réponses au formulaire, indexées par la **`key`** des champs — jamais par
   * leur `id`. C'est cette clé qu'un agent lit dans la demande.
   */
  formData: Record<string, unknown>;
  /**
   * Identité déclarée, aux clés du paramétrage du Socle (`courriel`,
   * `nom_usuel`, …), qu'Iris sait rapprocher telles quelles. `null` = la
   * collectivité n'a ouvert aucun public : la demande est déposée sans
   * identité, et le portail le dit à l'usager.
   */
  requester: Record<string, string> | null;
  /**
   * Identifiant tiré par le navigateur au PREMIER envoi et conservé pendant
   * les rejeux. C'est lui qui rend le double-clic et le renvoi après coupure
   * inoffensifs : Iris répond alors « déjà reçue », sans créer de doublon.
   */
  submissionId: string;
  /**
   * Les pièces justificatives, DÉJÀ déposées dans Iris (`POST /v1/uploads`
   * via `portal-api`) et désignées par leur identifiant de dépôt — le portail
   * ne détient aucun fichier. `fieldKey` est la clé machine du champ « pièce »
   * auquel le fichier répond.
   */
  attachments: AttachmentRef[];
}

/** Une pièce déposée, rattachée à l'exigence du formulaire qu'elle honore. */
export interface AttachmentRef {
  uploadId: string;
  fieldKey: string;
}

/** Ce que l'usager reçoit en retour : de quoi retrouver sa demande. */
export interface DemandeReceipt {
  /** Référence lisible, à afficher et à noter (ex. `DEM-2026-000123`). */
  reference: string;
  /** État de la demande chez Iris, liste fermée (`a_traiter`, …). */
  status: string;
  /**
   * Faux quand la demande existait déjà — un rejeu. L'usager doit voir le même
   * accusé, pas une seconde demande ni une erreur.
   */
  created: boolean;
}
