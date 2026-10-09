/**
 * État de chargement de la page d'un organisme, pour les composants.
 *
 * Calqué sur `usePortal` (mêmes états, même garde contre un chargement
 * périmé, même `retry`) : c'est le même contrat, pour un chargement scopé à
 * (langue, organisme) plutôt qu'à la seule langue. Le hook n'appelle que
 * `getOrganismeSnapshot()` : il ne connaît ni `fetch`, ni URL, ni Socle.
 *
 * ⚠️ PAS DE `rememberBranding` ICI — et ce n'est pas un oubli. Cette mémoire
 * peint l'écran d'attente de la PROCHAINE visite (voir `theme.ts`), et la
 * prochaine visite s'ouvre sur le PORTAIL de la collectivité, pas sur cet
 * organisme précis : c'est `usePortal` qui doit rester la seule main sur
 * cette mémoire, sous peine qu'un usager revenant sur `/` découvre l'attente
 * peinte aux couleurs d'un service qu'il a visité une fois en passant.
 * La favicon, elle, n'a pas cette portée : elle ne peint que l'onglet ouvert
 * MAINTENANT, et suit donc l'organisme affiché — exactement comme `usePortal`
 * la fait suivre la collectivité.
 */
import { useEffect, useState } from "react";
import type { Demarche, Ville } from "@fn/_shared/domain/demarche.ts";
import type { Tenant } from "@fn/_shared/domain/tenant.ts";
import type { Branding } from "@fn/_shared/domain/branding.ts";
import type { FreeMail } from "@fn/_shared/domain/courrier.ts";
import type { PortalLoadFailure } from "@/services/portal/portalClient.ts";
import { PortalUnavailableError } from "@/services/portal/portalService.ts";
import { getOrganismeSnapshot } from "@/services/portal/organismeService.ts";
import { applyFavicon } from "@/features/portal/favicon.ts";

export type OrganismeState =
  | { status: "loading" }
  | {
    status: "ready";
    /**
     * La langue DEMANDÉE par ce chargement-ci — voir `PortalState.requested`
     * pour la garde qu'elle porte contre un état périmé.
     */
    requested: string;
    /** La langue réellement servie — pas forcément celle demandée. */
    lang: string;
    tenant: Tenant;
    /** Les villes de la collectivité, pour le menu « Ma ville » de l'en-tête. */
    villes: Ville[];
    /** L'organisme dont cette page montre les démarches. */
    organisme: { id: string; name: string; slug: string | null };
    demarches: Demarche[];
    branding: Branding | null;
    /**
     * La charte de la COLLECTIVITÉ — celle de la marque de l'en-tête, pas
     * celle qui peint la page. Voir `PortalSnapshot.tenantBranding`.
     */
    tenantBranding: Branding | null;
    /** Le courrier libre de cet organisme — la page propose alors d'écrire. */
    freeMail: FreeMail;
  }
  | { status: "error"; reason: PortalLoadFailure };

export function useOrganisme(
  lang: string,
  slug: string,
): { state: OrganismeState; retry: () => void } {
  const [state, setState] = useState<OrganismeState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Un chargement obsolète ne doit pas écraser l'état d'un plus récent —
    // même garde que `usePortal`, pour la même raison : un réessai pendant
    // qu'un premier appel court encore ne doit pas voir son résultat écrasé.
    let current = true;
    setState({ status: "loading" });

    getOrganismeSnapshot(lang, slug)
      .then((snapshot) => {
        // L'icône de l'onglet se pose même si ce chargement est devenu
        // périmé entre-temps : elle appartient au document, pas au rendu.
        applyFavicon(snapshot.branding);
        if (current) {
          setState({
            status: "ready",
            requested: lang,
            lang: snapshot.lang,
            tenant: snapshot.tenant,
            villes: snapshot.villes,
            organisme: snapshot.organisme,
            demarches: snapshot.demarches,
            branding: snapshot.branding,
            tenantBranding: snapshot.tenantBranding,
            freeMail: snapshot.freeMail,
          });
        }
      })
      .catch((error: unknown) => {
        if (!current) return;
        setState({
          status: "error",
          reason: error instanceof PortalUnavailableError ? error.reason : "network",
        });
      });

    return () => {
      current = false;
    };
  }, [attempt, lang, slug]);

  return {
    state,
    // ⚠️ Contrairement à `usePortal`, pas de cache à vider ici : ce hook n'a
    // de contrat qu'avec `getOrganismeSnapshot()`, et un échec n'y est de
    // toute façon jamais mémorisé (même règle qu'au `portalService` — voir
    // son en-tête). Rejouer l'appel suffit donc à réessayer pour de vrai.
    retry: () => setAttempt((n) => n + 1),
  };
}
