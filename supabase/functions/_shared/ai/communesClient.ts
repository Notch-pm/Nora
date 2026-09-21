/**
 * Le référentiel des codes postaux — `geo.api.gouv.fr`, API publique de l'État,
 * sans clé ni compte.
 *
 * ⚠️ **Seul un code postal sort d'ici** : cinq chiffres, revalidés juste avant
 * l'appel. Ni le message de l'usager, ni son adresse, ni la collectivité.
 *
 * ⚠️ Délai COURT : l'usager attend déjà le modèle, sans affichage progressif.
 * Un référentiel lent ne doit rien coûter de visible — on rend `null`, et la
 * ville se demande comme avant.
 */
import { readCommunes } from "./postalCity.ts";

const GEO_API_URL = "https://geo.api.gouv.fr/communes";
const TIMEOUT_MS = 1500;

export async function lookupCommunes(
  postalCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  if (!/^\d{5}$/.test(postalCode)) return null;
  try {
    const response = await fetchImpl(
      `${GEO_API_URL}?codePostal=${postalCode}&fields=nom&format=json`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!response.ok) return null;
    return readCommunes(await response.json());
  } catch {
    return null;
  }
}
