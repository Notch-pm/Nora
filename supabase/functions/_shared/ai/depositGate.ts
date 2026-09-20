/**
 * La porte anti-robot du DÉPÔT (`POST /v1/demandes`) — la décision, pure.
 *
 * Jusqu'au 2026-09-20, déposer une demande ne demandait rien : ni captcha, ni
 * frein opposable, ni ici ni chez Iris. Tolérable tant qu'il fallait remplir un
 * formulaire à la main ; plus du tout depuis qu'un assistant peut en recueillir
 * un. La parade est la même que pour ouvrir une conversation — une preuve de
 * travail, sans tiers ni cookie — mais LIÉE à l'identifiant de la demande (voir
 * `challenge.ts`) : le serveur n'a pas de mémoire, et c'est cette liaison qui
 * rend un rejeu inoffensif.
 *
 * ⚠️ DÉPLOIEMENT EN DEUX TEMPS, et c'est la raison d'être de `required`. L'écran
 * (Cloudflare, au push) et cette fonction (déployée à la main) ne changent pas
 * au même instant. Exiger la preuve avant que l'écran sache la fournir
 * couperait TOUS les dépôts du portail. Donc : d'abord tolérer (une preuve
 * absente passe, une preuve FAUSSE est refusée), puis, l'écran déployé, poser
 * `DEPOSIT_CHALLENGE_REQUIRED=true`. Sans secret de signature, la porte n'existe
 * pas : un portail qui n'a pas configuré l'assistant dépose comme avant.
 */
import { verifySolution } from "./challenge.ts";

export type DepositGate = "open" | "challenge_required";

export async function checkDepositChallenge(input: {
  /** `ASSISTANT_SIGNING_SECRET`, ou `null` s'il n'est pas posé. */
  secret: string | null;
  /** `DEPOSIT_CHALLENGE_REQUIRED === "true"`. */
  required: boolean;
  /** Le défi résolu présenté par le navigateur, tel quel. */
  challenge: unknown;
  submissionId: string;
  nowSeconds: number;
}): Promise<DepositGate> {
  if (input.secret === null) return "open";
  if (input.challenge === undefined || input.challenge === null) {
    return input.required ? "challenge_required" : "open";
  }
  // Une preuve présentée est TOUJOURS vérifiée, même en phase tolérante : un
  // script qui prend la peine d'en fabriquer une fausse n'a pas à passer.
  return (await verifySolution(input.secret, input.challenge, input.nowSeconds, input.submissionId))
    ? "open"
    : "challenge_required";
}
