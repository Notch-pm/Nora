/**
 * Qui est connecté sur ce navigateur, pour choisir où mène « Mon compte »
 * (`/compte` si c'est un compte, la connexion sinon).
 *
 * Une seule question au serveur par chargement de page : le résultat est gardé
 * dans une variable de module, qui meurt avec l'onglet — RIEN n'est écrit sur
 * le poste. `forgetSessionKind` la jette après une connexion ou une
 * déconnexion, pour que le lien suivant dise vrai.
 *
 * ⚠️ Ce n'est qu'une COMMODITÉ D'AFFICHAGE : le droit d'ouvrir `/compte` se
 * décide au serveur, qui répond `session_required` à qui n'a pas de session.
 */
import { useEffect, useState } from "react";
import { useLanguage } from "@/i18n/LanguageLayout.tsx";
import { localizedPath } from "@/i18n/localizedPath.ts";
import { fetchSessionKind, type SessionKind } from "@/services/portal/accountClient.ts";
import { takeEarly } from "@/services/portal/earlyFetch.ts";

let known: Promise<SessionKind> | null = null;

export function forgetSessionKind(): void {
  known = null;
}

/** `null` tant que le serveur n'a pas répondu. */
export function useSessionKind(): SessionKind | null {
  const [kind, setKind] = useState<SessionKind | null>(null);
  useEffect(() => {
    let current = true;
    known ??= takeEarly("session", fetchSessionKind);
    void known.then((result) => {
      if (current) setKind(result);
    });
    return () => {
      current = false;
    };
  }, []);
  return kind;
}

/** L'adresse du lien « Mon compte » : le compte si l'on y est connecté, la connexion sinon (et en attendant). */
export function useAccountHref(): { href: string; connected: boolean } {
  const { lang } = useLanguage();
  const connected = useSessionKind() === "account";
  return { href: localizedPath(lang, connected ? "/compte" : "/compte/connexion"), connected };
}
