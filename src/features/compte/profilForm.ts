/**
 * La saisie de « Mes informations » — logique pure, testée sans DOM.
 *
 * La validation est CELLE DU SERVEUR (`parseIdentite` / `parseCoordonnees`,
 * partagées par `@fn`) : l'écran ne redéfinit aucune règle, il traduit en
 * message la liste des champs en défaut. Le serveur reste juge ; ses `champs`
 * (en cas de refus) passent par la même table.
 */
import {
  type Civilite,
  parseCoordonnees,
  parseIdentite,
  type Profil,
  type ProfilChamp,
  type ProfilCoordonnees,
  type ProfilIdentite,
} from "@fn/_shared/domain/profil.ts";
import type { StringKey } from "@/i18n/strings.ts";
import type { AccountClientFailure } from "@/services/portal/accountClient.ts";
import type { ProfilClientFailure } from "@/services/portal/profilClient.ts";

/** Ce que l'usager a tapé : des chaînes, jamais `null`. */
export interface IdentiteDraft {
  civilite: Civilite | "";
  prenom: string;
  nom: string;
  nomUsage: string;
  dateNaissance: string;
  mobile: string;
  fixe: string;
  adresse1: string;
  adresse2: string;
  codePostal: string;
  ville: string;
}

export type CoordonneesDraft = Pick<
  IdentiteDraft,
  "nomUsage" | "mobile" | "fixe" | "adresse1" | "adresse2" | "codePostal" | "ville"
>;

export type ProfilErrors = Partial<Record<ProfilChamp, StringKey>>;

export const EMPTY_IDENTITE: IdentiteDraft = {
  civilite: "",
  prenom: "",
  nom: "",
  nomUsage: "",
  dateNaissance: "",
  mobile: "",
  fixe: "",
  adresse1: "",
  adresse2: "",
  codePostal: "",
  ville: "",
};

/** Les coordonnées actuelles, à corriger. */
export function coordonneesDraftOf(profil: Profil): CoordonneesDraft {
  return {
    nomUsage: profil.nomUsage ?? "",
    mobile: profil.mobile ?? "",
    fixe: profil.fixe ?? "",
    adresse1: profil.adresse1 ?? "",
    adresse2: profil.adresse2 ?? "",
    codePostal: profil.codePostal ?? "",
    ville: profil.ville ?? "",
  };
}

/** Le message d'un champ en défaut : la nature de la règle, pas le champ, fait le texte. */
export function profilErrorKey(champ: ProfilChamp): StringKey {
  switch (champ) {
    case "civilite":
      return "compte.profil.error.civilite";
    case "codePostal":
      return "compte.profil.error.codePostal";
    case "mobile":
    case "fixe":
      return "compte.profil.error.phone";
    case "dateNaissance":
      return "compte.profil.error.date";
    default:
      return "compte.profil.error.required";
  }
}

export function errorsOf(champs: readonly ProfilChamp[]): ProfilErrors {
  const errors: ProfilErrors = {};
  for (const champ of champs) errors[champ] = profilErrorKey(champ);
  return errors;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: ProfilErrors };

export function validateIdentite(draft: IdentiteDraft): Validated<ProfilIdentite> {
  const parsed = parseIdentite(draft);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, errors: errorsOf(parsed.champs) };
}

export function validateCoordonnees(draft: CoordonneesDraft): Validated<ProfilCoordonnees> {
  const parsed = parseCoordonnees(draft);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false, errors: errorsOf(parsed.champs) };
}

/**
 * Un échec d'écriture dit avec les mots du compte (une seule table de messages).
 * `profil_refuse` et `profil_invalide` sans champ fautif partagent « bad_request »,
 * que l'écran remplace par son propre texte (`PROFIL_MESSAGES`).
 */
export function profilFailureAsAccount(failure: ProfilClientFailure): AccountClientFailure {
  switch (failure) {
    case "profil_invalide":
    case "profil_refuse":
      return "bad_request";
    case "profil_indisponible":
      return "account_unavailable";
    default:
      return failure;
  }
}

export const PROFIL_MESSAGES: Partial<Record<AccountClientFailure, StringKey>> = {
  bad_request: "compte.profil.error.refused",
  account_unavailable: "compte.profil.error.unavailable",
};
