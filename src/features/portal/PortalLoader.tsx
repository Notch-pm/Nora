/**
 * L'attente, à la marque de la collectivité.
 *
 * Trois ondes s'écartent d'un logo qui respire, à la couleur principale de la
 * collectivité : le visiteur reconnaît sa mairie avant même que la page
 * arrive. C'est le premier écran de chaque visite, et le seul qu'on montre
 * sans rien savoir encore — autant qu'il ne ressemble pas à un chargement
 * générique.
 *
 * ⚠️ LA CHARTE N'EST PAS ENCORE CHARGÉE quand cet écran s'affiche : elle vient
 * de la réponse qu'on attend. Le loader peint donc la DERNIÈRE charte connue
 * (`rememberedBranding`), et retombe sur les couleurs de la gamme à la toute
 * première visite — jamais sur un écran cassé. Le logo, lui, disparaît sans
 * bruit : une pastille à la couleur principale tient sa place, comme dans
 * l'en-tête.
 *
 * Les animations vivent dans `index.css` : c'est là que
 * `prefers-reduced-motion` peut les calmer, ce qu'un style en ligne ne saurait
 * pas faire.
 */
import type { Branding } from "@fn/_shared/domain/branding.ts";
import { brandingStyle, rememberedBranding } from "./theme.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";

/** Les trois ondes sont la même animation, décalée d'un tiers de cycle. */
const WAVE_DELAYS = ["0s", "1.13s", "2.26s"];

export function PortalLoader({
  /**
   * La charte, quand l'appelant la connaît déjà — un rechargement après un
   * changement de langue, par exemple. Sinon la dernière connue.
   */
  branding = null,
}: {
  branding?: Branding | null;
}) {
  const t = useT();
  const brand = branding ?? rememberedBranding();
  const logoUrl = brand?.logoUrl ?? null;

  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-white px-6 py-12"
      style={brandingStyle(brand)}
    >
      {/* Décor pur : le message d'attente, lui, est annoncé plus bas. */}
      <div
        className="relative flex h-[232px] w-[232px] shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        {WAVE_DELAYS.map((delay) => (
          <span
            key={delay}
            className="portal-wave absolute inset-0 rounded-full border-2 border-[color:var(--brand-primary)]"
            style={{ animationDelay: delay }}
          />
        ))}
        <span className="absolute h-[134px] w-[134px] rounded-full bg-[color:var(--brand-primary)] opacity-[0.07]" />
        <span className="portal-breathe relative flex h-[104px] w-[104px] items-center justify-center rounded-full bg-white shadow-sm">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="max-h-[60px] max-w-[84%] object-contain" />
          ) : (
            <span className="h-10 w-10 rounded-xl bg-[color:var(--brand-primary)]" />
          )}
        </span>
      </div>
      <p role="status" className="portal-fade mt-9 text-[17px] font-semibold text-slate-900">
        {t("page.loading")}
      </p>
    </main>
  );
}
