/**
 * « Mes consentements » dans « Mon compte » (lot L3c) : les deux consentements
 * RGPD du catalogue FERMÉ, tels que le Socle les tient pour la personne.
 *
 * Pour chacun : son état en clair (TROIS états — accordé le…, refusé le…,
 * jamais demandé), la phrase EXACTE du dictionnaire (celle que le serveur
 * consigne), et un seul bouton — « Accorder » ou « Retirer ». Le retrait du
 * traitement se confirme : il n'annule pas les demandes en cours.
 *
 * Aucune règle ici : l'état se lit par `consentState.ts`, le catalogue vient de
 * `domain/consents.ts`, et le serveur compose la phrase et reste juge. Après
 * chaque écriture, l'affichage reprend le profil que le serveur rend.
 */
import { useEffect, useRef, useState } from "react";
import { CONSENTS, type ConsentKind } from "@fn/_shared/domain/consents.ts";
import type { Profil } from "@fn/_shared/domain/profil.ts";
import { CONSENT_STATEMENT_KEYS } from "@/features/demarche/ConsentFields.tsx";
import { formatDate } from "@/features/suivi/format.ts";
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import type { StringKey } from "@/i18n/strings.ts";
import { saveConsentement, type ProfilClientFailure } from "@/services/portal/profilClient.ts";
import { accountFailureKey } from "./failureMessage.ts";
import { H2, PRIMARY_BUTTON, SECONDARY_BUTTON, StatusNote } from "./form.tsx";
import { consentAction, consentView, needsWithdrawConfirmation } from "./consentState.ts";
import { PROFIL_MESSAGES, profilFailureAsAccount } from "./profilForm.ts";

const SHORT_KEYS: Record<ConsentKind, StringKey> = {
  traitement: "consent.traitement.short",
  partage: "consent.partage.short",
};

export function ConsentementsSection({
  profil,
  tenantName,
  onChanged,
  onSessionLost,
}: {
  profil: Profil;
  tenantName: string;
  /** Le profil à jour, tel que le serveur le rend. */
  onChanged: (profil: Profil) => void;
  onSessionLost: () => void;
}) {
  const t = useT();
  const { lang } = useLanguage();
  const organisme = tenantName.trim() === "" ? t("consent.organismFallback") : tenantName.trim();
  const [pending, setPending] = useState<ConsentKind | null>(null);
  const [confirming, setConfirming] = useState<ConsentKind | null>(null);
  const [done, setDone] = useState<StringKey | null>(null);
  const [failure, setFailure] = useState<ProfilClientFailure | null>(null);
  const buttons = useRef<Partial<Record<ConsentKind, HTMLButtonElement | null>>>({});
  const confirmButton = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<ConsentKind | null>(null);

  // Ouvrir la confirmation y amène le focus ; la fermer le rend au bouton qui l'a ouverte.
  useEffect(() => {
    if (confirming !== null) confirmButton.current?.focus();
    else if (returnFocusTo.current !== null) {
      buttons.current[returnFocusTo.current]?.focus();
      returnFocusTo.current = null;
    }
  }, [confirming]);

  const write = async (kind: ConsentKind, granted: boolean) => {
    setPending(kind);
    setFailure(null);
    setDone(null);
    const result = await saveConsentement(kind, granted);
    setPending(null);
    if (result.ok) {
      setConfirming(null);
      setDone(granted ? "compte.consents.doneGranted" : "compte.consents.doneWithdrawn");
      returnFocusTo.current = kind;
      onChanged(result.value);
      return;
    }
    if (result.reason === "session_required") return onSessionLost();
    setFailure(result.reason);
  };

  return (
    <section aria-labelledby="compte-consentements" className="mt-10 flex flex-col gap-3">
      <h2 id="compte-consentements" className={H2}>
        {t("compte.consents.title")}
      </h2>
      <p className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">{t("compte.consents.intro")}</p>

      {/* Le résultat s'annonce sans prendre le focus (RGAA 7.5). */}
      {done !== null && <StatusNote>{t(done)}</StatusNote>}
      {failure !== null && (
        <div
          role="alert"
          className="rounded-[var(--pt-radius-sm)] border border-red-300 bg-red-50 px-4 py-3 text-[length:var(--pt-body)] text-red-800"
        >
          {t(PROFIL_MESSAGES[profilFailureAsAccount(failure)] ?? accountFailureKey(profilFailureAsAccount(failure)))}
        </div>
      )}

      <ul className="flex flex-col gap-4">
        {CONSENTS.map((def) => {
          const view = consentView(profil.consentements[def.kind]);
          const action = consentAction(view);
          const busy = pending === def.kind;
          const asking = confirming === def.kind;
          const statusId = "consentement-etat-" + def.kind;
          const confirmId = "consentement-confirmation-" + def.kind;
          const status =
            view.state === "granted"
              ? t("compte.consents.granted", { date: formatDate(view.at, lang) })
              : view.state === "refused"
                ? t("compte.consents.refused", { date: formatDate(view.at, lang) })
                : t("compte.consents.never");
          return (
            <li
              key={def.kind}
              className="flex flex-col gap-2 rounded-[var(--pt-radius-sm)] border border-[color:var(--pt-border)] p-4"
            >
              <p className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                {t(CONSENT_STATEMENT_KEYS[def.kind], { organisme })}
              </p>
              <p id={statusId} className="text-[length:var(--pt-body)] font-semibold text-[color:var(--pt-ink)]">
                {status}
              </p>

              {asking ? (
                <div className="flex flex-col gap-3">
                  <p id={confirmId} className="text-[length:var(--pt-body)] text-[color:var(--pt-muted)]">
                    {t("compte.consents.confirmWithdraw")}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      ref={confirmButton}
                      disabled={busy}
                      aria-describedby={confirmId}
                      onClick={() => void write(def.kind, false)}
                      className={PRIMARY_BUTTON}
                    >
                      {t(busy ? "compte.submitting" : "compte.consents.confirmYes")}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        returnFocusTo.current = def.kind;
                        setConfirming(null);
                      }}
                      className={SECONDARY_BUTTON}
                    >
                      {t("compte.profil.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    ref={(node) => {
                      buttons.current[def.kind] = node;
                    }}
                    disabled={busy}
                    aria-describedby={statusId}
                    onClick={() => {
                      if (needsWithdrawConfirmation(def.kind, view)) setConfirming(def.kind);
                      else void write(def.kind, action === "grant");
                    }}
                    className={SECONDARY_BUTTON}
                  >
                    {t(busy ? "compte.submitting" : action === "grant" ? "compte.consents.grant" : "compte.consents.withdraw")}
                    {/* Le nom accessible dit de QUEL consentement il s'agit, sans changer le texte visible. */}
                    <span className="sr-only"> : {t(SHORT_KEYS[def.kind], { organisme })}</span>
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
