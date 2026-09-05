/**
 * Mise en forme du nom d'hôte visité — la SEULE donnée qui désigne un tenant
 * dans tout le portail.
 *
 * Elle vient d'un navigateur : elle est traitée comme **non fiable**. Ce module
 * ne fait que la mettre en forme ; il ne décide de rien. C'est le Socle qui dit
 * si un domaine correspond à une collectivité, et lui seul — un nom d'hôte bien
 * formé n'est pas un nom d'hôte connu.
 *
 * Aucune dépendance : importable par l'edge function (Deno) comme par les tests.
 */

/**
 * FQDN en minuscules, au moins deux labels — **miroir** de la contrainte
 * `organization_domains_hostname_check` du Socle. Une valeur qui ne peut pas
 * exister en base est écartée ici, sans appel réseau.
 */
const FQDN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Longueur maximale d'un nom de domaine (RFC 1035). */
const MAX_LENGTH = 253;

/** Hôtes de bouclage nus — jamais un domaine de collectivité. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** Suffixe réservé au développement : `*.localhost` résout vers la machine locale. */
const LOCALHOST_SUFFIX = ".localhost";

/** Retire le port, y compris sur une forme IPv6 littérale `[::1]:8080`. */
function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  // ⚠️ Une adresse IPv6 NUE (`::1`) contient plusieurs « : », et son dernier
  // groupe n'est pas un port : couper aveuglément `:\d+$` la réduirait à « : ».
  // On ne coupe donc que s'il n'y a qu'un seul « : » — le cas d'un nom d'hôte.
  const first = host.indexOf(":");
  if (first === -1 || first !== host.lastIndexOf(":")) return host;
  return host.replace(/:\d+$/, "");
}

/**
 * Forme canonique d'un nom d'hôte, ou `null` s'il ne peut désigner aucun
 * domaine : minuscules, sans espaces, sans port, sans point final.
 *
 * La normalisation est faite **avant** la recherche parce que le Socle stocke
 * déjà la forme canonique (trigger `normalize_organization_domain`).
 * Normaliser des deux côtés d'une comparaison est une source d'écart
 * permanente ; ici, un seul côté bouge.
 */
export function normalizeHostname(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const host = stripPort(raw.trim().toLowerCase()).replace(/\.+$/, "");
  if (host.length === 0 || host.length > MAX_LENGTH) return null;
  return FQDN_RE.test(host) ? host : null;
}

/**
 * Hôte porté par un en-tête `Origin` (`https://nantes.edilumen.fr` →
 * `nantes.edilumen.fr`), ou `null` si l'en-tête est absent, opaque (`null`) ou
 * illisible.
 *
 * ⚠️ `Origin` est posé par le NAVIGATEUR et fait partie des en-têtes interdits
 * à `fetch` : le JavaScript de la page ne peut pas le réécrire. C'est ce qui en
 * fait, dans cette architecture, la meilleure source disponible pour le domaine
 * visité — l'edge function ne voit pas le `Host` du portail, terminé par
 * l'hébergeur du site.
 *
 * Un client hors navigateur pose évidemment l'`Origin` qu'il veut. Cela ne lui
 * ouvre rien : il obtient le catalogue **public** d'une collectivité, celui que
 * son propre portail sert à tout visiteur.
 */
export function hostFromOrigin(origin: string | null | undefined): string | null {
  if (typeof origin !== "string" || origin === "" || origin === "null") return null;
  try {
    const host = stripPort(new URL(origin).host.toLowerCase());
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/**
 * Hôte de développement local — bouclage nu (`localhost`, `127.0.0.1`) ou
 * sous-domaine de `.localhost`.
 *
 * Sert à décider si l'on peut substituer un domaine de simulation. En
 * production, aucun hôte ne répond vrai : la substitution ne peut donc pas s'y
 * déclencher, même si sa configuration était posée par erreur.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (typeof host !== "string") return false;
  const h = stripPort(host.trim().toLowerCase());
  return LOOPBACK.has(h) || h.endsWith(LOCALHOST_SUFFIX);
}

/**
 * Partie utile d'un hôte `*.localhost` : `nantes.localhost` → `nantes`.
 * `null` pour un bouclage nu, qui ne désigne aucune collectivité en
 * particulier.
 *
 * C'est ce qui permet de tester plusieurs collectivités en local sans rien
 * changer : les navigateurs résolvent tout `*.localhost` vers la machine, il
 * suffit donc d'ouvrir `nantes.localhost:5175` puis `angers.localhost:5175`.
 */
export function localhostLabel(host: string | null | undefined): string | null {
  if (typeof host !== "string") return null;
  const h = stripPort(host.trim().toLowerCase());
  if (!h.endsWith(LOCALHOST_SUFFIX)) return null;
  const label = h.slice(0, -LOCALHOST_SUFFIX.length);
  return label === "" ? null : label;
}
