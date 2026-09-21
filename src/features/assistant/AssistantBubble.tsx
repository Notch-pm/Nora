/**
 * LA BULLE — l'assistant, présent sur tous les écrans, en bas à droite.
 *
 * Montée une seule fois, au-dessus de l'`Outlet` : c'est ce qui permet à une
 * conversation de survivre à une navigation. Ouvrir une démarche, revenir,
 * chercher autre chose : le fil reste. Une bulle montée par écran serait
 * démontée à chaque clic, et c'est précisément le défaut qu'elle corrige.
 *
 * ⚠️ **Le thème est posé ICI, sur le bouton et sur le panneau.** Les `--pt-*`
 * vivent sur la racine de chaque composition (`HomeComposition`, `PortalPage`,
 * `DemarcheShell`) ; la bulle est en dehors, ils ne descendent pas jusqu'à
 * elle. Sans ce style, elle s'afficherait sans charte.
 *
 * ⚠️ **Pas de `role="dialog"`, pas d'`aria-modal`, pas de piège de focus.** Le
 * dépôt n'en a aucun et n'en apprend pas un ici : le panneau reprend du
 * bandeau « Ma ville » (`PageHeader`) ce qui vaut pour lui — `aria-expanded`,
 * et Échap qui referme ET rend le focus au déclencheur. Le reste de la page
 * reste atteignable, ce qui est le comportement juste pour un assistant : il
 * accompagne la page, il ne la confisque pas.
 *
 * ⚠️ **Deux écarts assumés à ce motif**, l'un et l'autre pour la même raison —
 * un menu se referme dès qu'on regarde ailleurs, une conversation non :
 *   • le panneau ne se ferme pas au changement d'adresse ;
 *   • il ne se ferme pas au clic extérieur.
 * Le premier essai reprenait les deux, et le panneau se fermait en ouvrant la
 * démarche qu'il venait de proposer. Fermer est donc toujours un GESTE.
 *
 * ⚠️ **RGAA 10.4 (zoom 200 %)** : sous 48rem de largeur de fenêtre — ce qu'un
 * zoom à 200 % atteint mécaniquement sur un écran courant — le panneau passe
 * en PLEIN ÉCRAN. Au-dessus, il flotte, sans aucune hauteur en pixels
 * (`dvh` seulement) et avec un seul défilement vertical. Et il porte en
 * permanence un lien « voir en grand » vers `/assistant`, qui reprend la
 * conversation là où elle en est (le fil vit en `sessionStorage`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation } from "react-router-dom";
import { usePortal } from "@/features/portal/usePortal.ts";
import { themeStyle } from "@/features/portal/themeStyle.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath, splitScopedPath } from "@/i18n/localizedPath.ts";
import { AssistantThread } from "./AssistantThread.tsx";
import { bubbleUiKey, CLOSED, panelSize, readBubbleUi, type BubbleUi } from "./bubbleState.ts";
import type { CollectStep } from "./collect.ts";

/** Ouvrir la bulle depuis un écran — `null` quand la collectivité l'a fermée. */
interface AssistantLauncher {
  open: (demarcheId?: string) => void;
}

const LauncherContext = createContext<AssistantLauncher | null>(null);

export function useAssistantLauncher(): AssistantLauncher | null {
  return useContext(LauncherContext);
}

/** `sessionStorage` peut lever (navigation privée) ou ne pas exister (rendu hors navigateur). */
function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Le panneau flotte-t-il, ou prend-il tout l'écran ?
 *
 * ⚠️ C'est une question de LARGEUR CSS, pas de matériel : un zoom à 200 %
 * divise cette largeur par deux et bascule donc en plein écran tout seul.
 * C'est la mécanique même de la réponse à RGAA 10.4 — elle n'est pas un effet
 * de bord, elle est le sujet.
 */
function useFloats(): boolean {
  const query = "(min-width: 48rem)";
  const [floats, setFloats] = useState(
    () => typeof window === "undefined" || typeof window.matchMedia !== "function"
      || window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const onChange = () => setFloats(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return floats;
}

export function AssistantBubble({ children }: { children: ReactNode }) {
  const { lang } = useLanguage();
  const t = useT();
  const location = useLocation();
  // ⚠️ Gratuit : `loadPortal` mémoïse une promesse par langue. Ce second appel
  // partage le chargement déjà lancé par l'écran, il n'en déclenche pas un autre.
  const { state } = usePortal(lang);
  const floats = useFloats();

  const [ui, setUi] = useState<BubbleUi>(CLOSED);
  const [step, setStep] = useState<CollectStep | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    const raw = tabStorage()?.getItem(bubbleUiKey());
    if (raw === null || raw === undefined) return;
    try {
      setUi(readBubbleUi(JSON.parse(raw)));
    } catch {
      // Une entrée illisible vaut « fermé » : `readBubbleUi` dit la même chose.
    }
  }, []);

  useEffect(() => {
    try {
      tabStorage()?.setItem(bubbleUiKey(), JSON.stringify(ui));
    } catch {
      // Pas de mémoire : la bulle marche quand même, elle se rouvre à la main.
    }
  }, [ui]);

  const close = useCallback(() => setUi((current) => ({ ...current, open: false })), []);

  const open = useCallback((demarcheId?: string) => {
    setUi({ open: true, focusDemarcheId: demarcheId ?? null });
  }, []);

  // Échap referme et rend le focus au déclencheur — sans quoi le clavier
  // perdrait sa place.
  //
  // ⚠️ **Pas de fermeture au clic extérieur**, contrairement au bandeau « Ma
  // ville ». Un menu se referme dès qu'on regarde ailleurs ; un assistant, non.
  // Le premier essai l'avait repris tel quel, et le panneau se fermait en
  // ouvrant la démarche qu'il venait de proposer — l'usager perdait de vue sa
  // conversation au moment précis où elle servait. Une fermeture est donc
  // toujours un GESTE : la croix, Échap, ou le déclencheur.
  useEffect(() => {
    if (!ui.open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ui.open, close]);

  const ready = state.status === "ready";
  const enabled = ready && state.tenant.assistant.enabled;
  const launcher = useMemo<AssistantLauncher | null>(
    () => (enabled ? { open } : null),
    [enabled, open],
  );

  // Sur `/assistant`, le fil a déjà son cadre : une bulle par-dessus
  // afficherait deux fois la même conversation.
  const onAssistantPage = splitScopedPath(location.pathname).path === "/assistant";

  if (!ready || !enabled || onAssistantPage) {
    return <LauncherContext.Provider value={launcher}>{children}</LauncherContext.Provider>;
  }

  const { tenant, demarches, branding } = state;
  const theme = themeStyle(tenant.theme, branding);
  const size = panelSize(step);

  return (
    <LauncherContext.Provider value={launcher}>
      {children}

      {/* ⚠️ `z-40` : sous le plafond de 50 du dépôt (le lien d'évitement passe
          devant, et c'est juste), au-dessus du bandeau `sticky z-20`. */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={ui.open}
        aria-controls={panelId}
        onClick={() => (ui.open ? close() : open())}
        style={{ ...theme, background: "var(--brand-primary)", color: "var(--pt-on-primary)" }}
        className="fixed bottom-4 end-4 z-40 rounded-full px-5 py-3 text-[length:var(--pt-body)] font-semibold shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[color:var(--brand-primary)]"
      >
        {/* ⚠️ Le NOM NE CHANGE PAS avec l'état — c'est `aria-expanded` qui le
            dit. Un déclencheur qui se renomme « Fermer » quand il est ouvert
            porterait le même nom que la croix du panneau : à l'oreille, deux
            boutons identiques pour deux gestes différents. Même règle que le
            bandeau « Ma ville ». */}
        {t("assistant.entry")}
      </button>

      {ui.open && (
        <div
          ref={panelRef}
          id={panelId}
          style={{
            ...theme,
            color: "var(--pt-ink)",
            background: "var(--pt-surface)",
            // ⚠️ Aucune hauteur en pixels, jamais : en `dvh` seulement, pour
            // qu'un zoom agrandisse le contenu au lieu de le couper.
            ...(floats
              ? {
                  width: size === "large" ? "min(40rem, calc(100vw - 2rem))" : "min(26rem, calc(100vw - 2rem))",
                  maxHeight: size === "large" ? "min(90dvh, 52rem)" : "min(70dvh, 40rem)",
                }
              : {}),
          }}
          className={
            "fixed z-40 flex flex-col overflow-hidden border border-[color:var(--pt-border)] shadow-2xl " +
            (floats
              ? "bottom-20 end-4 rounded-[var(--pt-radius)]"
              : "inset-0 h-[100dvh] w-[100dvw]")
          }
        >
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--pt-border)] px-4 py-3">
            <p className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
              {t("assistant.title")}
            </p>
            <div className="flex items-center gap-3">
              {/* Le repli grand format — la conversation s'y poursuit intacte. */}
              <Link
                to={localizedPath(lang, "/assistant")}
                onClick={close}
                className="text-[length:var(--pt-small)] font-semibold text-[color:var(--brand-primary)] hover:underline"
              >
                {t("assistant.bubble.expand")}
              </Link>
              <button
                type="button"
                onClick={() => {
                  close();
                  triggerRef.current?.focus();
                }}
                className="rounded-[var(--pt-radius-sm)] px-2 py-1 text-[length:var(--pt-small)] font-semibold text-[color:var(--pt-muted)] hover:text-[color:var(--pt-ink)]"
              >
                {t("assistant.bubble.close")}
              </button>
            </div>
          </div>

          {/* Un SEUL défilement vertical, jamais horizontal (RGAA 10.11). */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
            <AssistantThread
              demarches={demarches}
              lang={lang}
              focusDemarcheId={ui.focusDemarcheId}
              depositEnabled={tenant.assistant.depositEnabled}
              variant="panel"
              onStepChange={setStep}
            />
          </div>
        </div>
      )}
    </LauncherContext.Provider>
  );
}
