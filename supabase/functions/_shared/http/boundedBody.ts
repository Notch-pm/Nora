/**
 * Un corps de requête qui ne peut pas dépasser une taille donnée.
 *
 * Pourquoi pas seulement `Content-Length` : l'en-tête peut manquer (envoi en
 * flux, `Transfer-Encoding: chunked`), et `request.formData()` /
 * `request.json()` chargent alors TOUT en mémoire avant le moindre contrôle.
 * Quelques envois de 90 Mo en parallèle suffisaient à faire tomber une
 * instance de `portal-api`, et avec elle les requêtes de tous les visiteurs
 * qu'elle servait (relecture de sécurité L3c, I2).
 *
 * Ici, le flux est compté au fil de la lecture : au-delà de la borne, il
 * échoue, et la lecture du corps lève comme pour un corps illisible — chaque
 * route répond donc déjà « envoi invalide ». Les routes d'envoi gardent en
 * plus leur refus sur `Content-Length`, avec leur propre message.
 */

export class BodyTooLargeError extends Error {
  constructor() {
    super("Corps de requête trop volumineux.");
    this.name = "BodyTooLargeError";
  }
}

/** La même requête, dont le corps échoue à la lecture au-delà de `maxBytes`. */
export function boundRequestBody(request: Request, maxBytes: number): Request {
  if (request.body === null) return request;
  let seen = 0;
  const counted = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          controller.error(new BodyTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: counted,
    // Exigé par fetch dès qu'un corps est un flux ; absent des types DOM.
    duplex: "half",
  } as RequestInit);
}
