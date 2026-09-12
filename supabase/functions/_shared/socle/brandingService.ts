/**
 * La charte graphique de la collectivité, traduite et VALIDÉE.
 *
 * Deux règles, toutes deux de sécurité avant d'être de forme :
 *   - une couleur n'entre que sous la forme `#rrggbb`. Elle finira dans une
 *     variable CSS de la page ; tout ce qui n'est pas une couleur est écarté,
 *     pas « nettoyé » ;
 *   - une URL d'image (logos, favicon) n'entre qu'en `https`. Le reste est
 *     écarté.
 *
 * Et une règle de service : **la charte est décorative**. Si le Socle ne la
 * sert pas — jamais renseignée, ou indisponible à cet instant précis alors que
 * la collectivité et ses démarches viennent d'être lues — le portail rend ses
 * couleurs par défaut plutôt qu'une page d'erreur. Seul un refus de la clé
 * remonte : c'est une panne de configuration, pas un choix de la collectivité.
 */
import type { Branding } from "../domain/branding.ts";
import type { PortalFailure } from "../domain/failure.ts";
import type { SocleClient } from "./socleClient.ts";
import { httpsUrl } from "./urls.ts";

export type BrandingResult =
  | { ok: true; branding: Branding | null }
  | { ok: false; reason: PortalFailure };

const HEX_COLOR = /^#[0-9a-f]{6}$/;

/** `#RRGGBB` ou `#rrggbb` → `#rrggbb` ; tout le reste → `null`. */
export function color(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  return HEX_COLOR.test(lower) ? lower : null;
}

/**
 * URL absolue en https ; tout le reste → `null`. La règle vit dans `urls.ts` :
 * un logo de charte, un favicon et l'image d'un bloc de page sont trois
 * adresses posées dans la même page publique, elles ne peuvent pas avoir trois
 * règles.
 */
export const logoUrl = httpsUrl;

/** `null` si rien d'exploitable n'est renseigné — le portail garde ses défauts. */
export function toBranding(body: unknown): Branding | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  if (raw.configured === false) return null;
  const branding: Branding = {
    logoUrl: logoUrl(raw.logo_url),
    logoWhiteUrl: logoUrl(raw.logo_white_url),
    faviconUrl: logoUrl(raw.favicon_url),
    primaryColor: color(raw.primary_color),
    secondaryColor: color(raw.secondary_color),
  };
  const anything = Object.values(branding).some((v) => v !== null);
  return anything ? branding : null;
}

export async function getBranding(tenantId: string, socle: SocleClient): Promise<BrandingResult> {
  const reply = await socle.get("/v1/organizations/" + encodeURIComponent(tenantId) + "/branding");
  switch (reply.kind) {
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "not_found":
    case "unreachable":
    case "unexpected":
      // Décoratif : l'absence n'est pas une panne.
      return { ok: true, branding: null };
  }
  return { ok: true, branding: toBranding(reply.body) };
}
