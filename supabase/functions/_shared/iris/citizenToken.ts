/**
 * Le jeton court qu'exige Iris sur chaque lecture de la vue usager (contrat
 * 2.7.0, relecture de sécurité M4) : la clé plateforme du portail ne suffit
 * plus, à elle seule, à lire les demandes des usagers. Signé ici avec un
 * SECOND secret (`NORA_IRIS_TOKEN_SECRET`, la même valeur que
 * `IRIS_CITIZEN_TOKEN_SECRET` chez Iris), court, et lié à ce qu'il ouvre :
 *   · `request:<id>` — la demande d'une session invitée (lot L2) ;
 *   · `contact:<id>` — les demandes de la fiche d'un compte connecté, avec
 *     l'adresse du compte (`e`), qui filtre les messages.
 * Portal-api ne le signe qu'APRÈS ses propres contrôles (session).
 */

/** Un jeton par appel, valable deux minutes : le temps d'un aller-retour. */
const TOKEN_SECONDS = 120;

export function irisTokenSecret(value: string | undefined): string | null {
  return value && value.length >= 32 ? value : null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type CitizenTokenSubject =
  // `version` : celle de l'accès invité à l'ouverture de la session (`g`, Iris 2.8.0).
  | { kind: "request"; id: string; version?: number | null }
  | { kind: "contact"; id: string; email: string };

export async function signCitizenToken(
  secret: string,
  tenantId: string,
  subject: CitizenTokenSubject,
  nowSeconds: number,
): Promise<string> {
  const payload: Record<string, unknown> = {
    v: 1,
    t: tenantId,
    sub: `${subject.kind}:${subject.id}`,
    exp: nowSeconds + TOKEN_SECONDS,
  };
  if (subject.kind === "contact") payload.e = subject.email;
  if (subject.kind === "request" && typeof subject.version === "number") payload.g = subject.version;
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `${body}.${toBase64Url(mac)}`;
}
