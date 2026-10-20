/**
 * Le cadre des écrans du compte (`AccountFrame`) charge la collectivité, la
 * charte et l'en-tête : hors sujet pour tester un ÉCRAN. Cette doublure le
 * remplace par un cadre nu, en gardant tout le reste du module (titre d'étape,
 * classes de liens) tel quel.
 */
import type { ReactNode } from "react";

export function withPlainFrame<T extends object>(actual: T): T {
  return {
    ...actual,
    AccountFrame: ({ children }: { children: (tenantName: string) => ReactNode }) => <main>{children("Ville de Sceaux")}</main>,
  };
}
