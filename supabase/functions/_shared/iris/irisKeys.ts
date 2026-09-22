/**
 * La clé Iris de LA collectivité qui dépose — choisie d'après le domaine visité.
 *
 * Une clé Iris est liée à UNE source, elle-même liée à UNE collectivité : Iris
 * refuse en 403 toute enveloppe dont la racine diffère. Avec une clé unique
 * (`IRIS_API_KEY`), l'instance était multi-collectivités en lecture et
 * MONO-collectivité en dépôt — constaté sur test2 : formulaire rempli,
 * identité saisie, envoi refusé.
 *
 * `IRIS_API_KEYS` est un secret JSON : `{ "<id Socle de la collectivité>": "irs_…" }`.
 * Une clé par collectivité, et non une clé « plateforme » : une fuite n'ouvre
 * qu'une collectivité, et elle se révoque sans toucher aux autres.
 *
 * ⚠️ **Le registre, une fois posé, fait foi SEUL.** Une collectivité qui n'y
 * figure pas n'a pas de clé — on ne retombe pas sur `IRIS_API_KEY`, qui est
 * la clé de quelqu'un d'autre : ce serait un 403 garanti, après que l'usager a
 * tout rempli. `IRIS_API_KEY` ne sert que tant que le registre n'existe pas,
 * pour que le déploiement de ce fichier ne change rien à lui seul.
 *
 * ⚠️ Rien n'est journalisé d'une clé, ni du contenu du registre.
 */
export type IrisKeyResolution =
  | { ok: true; apiKey: string }
  /** `no_key` : cette collectivité n'a pas de clé. `unreadable` : le registre est illisible. */
  | { ok: false; reason: "no_key" | "unreadable" | "not_configured" };

export interface IrisKeyEnv {
  /** `IRIS_API_KEYS` — le registre JSON. */
  registry: string | undefined;
  /** `IRIS_API_KEY` — la clé unique d'avant le registre. */
  legacyKey: string | undefined;
}

export function resolveIrisKey(tenantId: string, env: IrisKeyEnv): IrisKeyResolution {
  const registry = env.registry?.trim() ?? "";
  if (registry === "") {
    const legacy = env.legacyKey?.trim() ?? "";
    return legacy === "" ? { ok: false, reason: "not_configured" } : { ok: true, apiKey: legacy };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(registry);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: "unreadable" };
  }
  // Les identifiants du Socle sont des UUID : la casse ne doit pas décider.
  const wanted = tenantId.toLowerCase();
  for (const [id, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (id.trim().toLowerCase() !== wanted) continue;
    return typeof key === "string" && key.trim() !== ""
      ? { ok: true, apiKey: key.trim() }
      : { ok: false, reason: "no_key" };
  }
  return { ok: false, reason: "no_key" };
}
