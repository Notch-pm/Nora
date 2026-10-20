/**
 * L'encart d'une démarche réservée aux usagers connectés (lot L3c).
 *
 * Il REMPLACE le bouton de dépôt quand l'usager ne peut pas encore déposer :
 *   • `login`    — « Me connecter » (qui le ramène ici ensuite) et « Créer un
 *     compte » ;
 *   • `complete` — connecté, mais profil non rempli : lien vers `/compte`.
 *
 * Le retour de connexion est le chemin COMPLET de la page courante (langue et
 * organisme compris) ; la connexion le revalide (`safeRetour`).
 *
 * `alert` : l'encart apparaît en réponse à un envoi refusé (`account_required`)
 * — il s'annonce alors aux lecteurs d'écran et prend le focus.
 */
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { LINK_CLASS } from "@/features/compte/AccountFrame.tsx";
import { connexionUrl } from "@/features/compte/retour.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";

const BUTTON =
  "inline-flex min-h-12 items-center justify-center rounded-[var(--pt-radius-sm)] bg-[color:var(--pt-primary)] px-5 py-3 text-[length:var(--pt-body)] font-bold text-[color:var(--pt-on-primary)] shadow-[var(--pt-shadow)] hover:underline hover:underline-offset-4";

export function AccessNotice({
  gate,
  alert = false,
  block = false,
}: {
  gate: "login" | "complete";
  alert?: boolean;
  /** Boutons pleine largeur (colonne « L'essentiel »). */
  block?: boolean;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const here = useLocation().pathname;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (alert) ref.current?.focus();
  }, [alert]);

  const login = gate === "login";
  return (
    <div
      ref={ref}
      role={alert ? "alert" : undefined}
      tabIndex={alert ? -1 : undefined}
      className="flex flex-col gap-3 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] bg-[color:var(--pt-surface)] p-4"
    >
      <p className="text-[length:var(--pt-body)] font-bold text-[color:var(--pt-ink)]">
        {t(login ? "access.login.title" : "access.complete.title")}
      </p>
      <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
        {t(login ? "access.login.help" : "access.complete.help")}
      </p>
      {login ? (
        <>
          <Link to={connexionUrl(localizedPath(lang, "/compte/connexion"), here)} className={BUTTON + (block ? " w-full" : "")}>
            {t("access.login.submit")}
          </Link>
          <Link to={localizedPath(lang, "/compte/inscription")} className={LINK_CLASS + " text-[length:var(--pt-body)]"}>
            {t("access.login.register")}
          </Link>
        </>
      ) : (
        <Link to={localizedPath(lang, "/compte")} className={BUTTON + (block ? " w-full" : "")}>
          {t("access.complete.link")}
        </Link>
      )}
    </div>
  );
}
