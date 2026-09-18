/**
 * Les pièces qu'on présente sur la page d'une démarche — règle pure.
 *
 * Deux sources, qui ne disent pas la même chose :
 *   · les pièces ANNONCÉES par la collectivité (`announcedPieces`) — un texte
 *     rédigé pour l'usager, avec ses précisions, qui peut porter ce qui ne se
 *     dépose pas en ligne (un original, un chèque de caution) ;
 *   · les pièces du FORMULAIRE (champs `attachment`) — celles que l'usager
 *     téléversera, et rien d'autre.
 *
 * ⚠️ **ELLES NE SE FONDENT JAMAIS EN UNE LISTE.** Elles se recoupent le plus
 * souvent (« Une pièce d'identité du jeune » / « Pièce d'identité du jeune ») :
 * les concaténer ferait demander deux fois la même pièce. Et l'annonce seule
 * cacherait une pièce que le formulaire exigera. D'où deux rôles : l'annonce
 * est LA liste quand elle existe, et les pièces du formulaire sont nommées à
 * part, comme ce qui se joint en ligne. Sans annonce, on retombe sur le
 * formulaire, comme avant le contrat 1.24.0.
 *
 * Aucune correspondance n'est tentée entre les deux par l'intitulé : elles
 * sont rédigées différemment exprès, et un rapprochement approximatif
 * cacherait tôt ou tard une pièce distincte.
 */
import type { AttachmentField, FormSchema } from "@fn/_shared/domain/formSchema.ts";
import { allFields } from "@fn/_shared/domain/formSchema.ts";
import type { AnnouncedPiece } from "@fn/_shared/domain/userCommunication.ts";

export type PiecesPresentation =
  /** Rien à annoncer, rien à déposer : pas de section. */
  | { kind: "none" }
  /** L'annonce de la collectivité, puis — à part — ce qui se joint en ligne. */
  | { kind: "announced"; announced: AnnouncedPiece[]; online: AttachmentField[] }
  /** Pas d'annonce : les pièces du formulaire, avec leurs formats. */
  | { kind: "form"; online: AttachmentField[] };

export function piecesPresentation(
  announced: AnnouncedPiece[],
  form: FormSchema | null,
): PiecesPresentation {
  const online =
    form === null
      ? []
      : allFields(form).filter((field): field is AttachmentField => field.type === "attachment");
  if (announced.length > 0) return { kind: "announced", announced, online };
  if (online.length > 0) return { kind: "form", online };
  return { kind: "none" };
}
