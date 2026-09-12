/**
 * La mesure de fréquentation, côté règles — pure, testable sans réseau.
 *
 * Le portail compte ce qu'il affiche, et le confie au Socle, qui est le seul à
 * avoir une base. Ce module décide de trois choses, et de rien d'autre :
 * ce que le navigateur a le droit d'annoncer (`parseAudienceBeacon`), si
 * l'appelant est un robot (`isBot`), et sur quel genre d'appareil la page a
 * été vue (`deviceClass`).
 *
 * ⚠️ CE QUI NE SORT JAMAIS D'ICI : le User-Agent. Il entre, il donne un mot
 * parmi trois, et il est jeté. Même chose pour l'adresse IP, qui ne traverse
 * même pas ce module — elle sert au frein anti-abus d'`index.ts`, haché, et
 * n'est jamais transmise. Le Socle, lui, ne voit ni l'un ni l'autre : ses deux
 * tables de compteurs n'ont aucune colonne capable de les porter.
 *
 * ⚠️ LE RÉFÉRENT N'ENTRE PAS NON PLUS. Le navigateur le lit, en tire un
 * oui/non (« est-ce une arrivée sur le site ? ») et n'envoie que ce booléen.
 * Le serveur ne peut donc pas savoir d'où vient un visiteur, et c'est
 * volontaire : la provenance a été écartée du périmètre.
 */

/** Les trois écrans du portail qui se comptent. */
export const AUDIENCE_PAGES = ["accueil", "demarche", "formulaire"] as const;
export type AudiencePage = (typeof AUDIENCE_PAGES)[number];

/** Les trois classes d'appareil. */
export const DEVICE_CLASSES = ["mobile", "tablette", "ordinateur"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export interface AudienceBeacon {
  page: AudiencePage;
  /** Requis si et seulement si la page n'est pas l'accueil. */
  demarcheId: string | null;
  /** L'arrivée sur le site — décidée par le navigateur, jamais recalculée ici. */
  entry: boolean;
}

/** Bornes de forme : un identifiant de démarche est un uuid, rien de plus long. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ce que le navigateur a le droit d'annoncer.
 *
 * ⚠️ WHITELIST STRICTE : une clé inconnue fait échouer la lecture entière. Le
 * corps arrive d'un navigateur, donc de n'importe qui ; accepter une clé de
 * plus « au cas où » serait accepter que quelqu'un pousse un jour un
 * identifiant dans le tuyau. Il n'y a rien à ignorer poliment ici.
 *
 * Rend `null` plutôt que de lever : un beacon illisible ne fait pas de bruit,
 * la page du visiteur n'en dépend pas.
 */
export function parseAudienceBeacon(raw: unknown): AudienceBeacon | null {
  if (!isRecord(raw)) return null;
  for (const key of Object.keys(raw)) {
    if (!["page", "demarcheId", "entry"].includes(key)) return null;
  }

  const page = typeof raw.page === "string" ? raw.page.trim() : "";
  if (!(AUDIENCE_PAGES as readonly string[]).includes(page)) return null;

  const hasDemarche = raw.demarcheId !== undefined && raw.demarcheId !== null;
  if (page === "accueil") {
    if (hasDemarche) return null;
  } else if (!hasDemarche) {
    return null;
  }
  const demarcheId = hasDemarche ? String(raw.demarcheId).trim() : null;
  if (demarcheId !== null && !UUID_RE.test(demarcheId)) return null;

  if (raw.entry !== undefined && typeof raw.entry !== "boolean") return null;

  return { page: page as AudiencePage, demarcheId, entry: raw.entry === true };
}

/**
 * Un robot ? Détection GROSSIÈRE et assumée.
 *
 * ⚠️ Elle n'existe pas pour se défendre — un robot qui veut fausser les
 * chiffres se déclare navigateur, et aucune liste ne l'attrapera. Elle existe
 * parce que les robots HONNÊTES se nomment (Googlebot, les moniteurs de
 * disponibilité, les aperçus de lien), et qu'ils visitent une page d'accueil
 * de collectivité plusieurs fois par jour. Sans ce filtre, une commune sans
 * visiteur afficherait un trafic régulier qui n'est que de la surveillance.
 *
 * ⚠️ Elle ne tourne QUE côté serveur : la faire dans le navigateur
 * n'arrêterait aucun des robots qui n'exécutent pas de JavaScript — donc la
 * plupart.
 */
const BOT_MARKERS = [
  "bot", "crawler", "spider", "scraper", "curl", "wget", "python-requests",
  "headlesschrome", "phantomjs", "slurp", "monitor", "uptime", "pingdom",
  "facebookexternalhit", "whatsapp", "preview", "lighthouse", "gtmetrix",
];

export function isBot(userAgent: string | null | undefined): boolean {
  if (typeof userAgent !== "string" || userAgent.trim() === "") {
    // Un navigateur envoie toujours un User-Agent : son absence est le fait
    // d'un script. Compter ces visites gonflerait les chiffres de la surveillance.
    return true;
  }
  const ua = userAgent.toLowerCase();
  return BOT_MARKERS.some((marker) => ua.includes(marker));
}

/**
 * Sur quel genre d'appareil la page a été vue.
 *
 * ⚠️ LIMITE CONNUE, ET ASSUMÉE : un iPad récent s'annonce comme un Macintosh
 * (Apple l'a voulu ainsi depuis iPadOS 13) et sera compté « ordinateur ». On
 * ne cherche pas à le rattraper : les contournements connus (tailles d'écran,
 * points tactiles) demandent du JavaScript dans la page et rapprochent
 * dangereusement de l'empreinte de navigateur, précisément ce que cette mesure
 * refuse de faire. Une tablette de moins se lit comme un ordinateur ; on ne
 * dira pas mieux que ce qu'on sait.
 *
 * L'ordre des tests compte : « Android » est présent sur les tablettes ET les
 * téléphones, et c'est l'absence de « Mobile » qui les distingue.
 */
export function deviceClass(userAgent: string | null | undefined): DeviceClass {
  const ua = typeof userAgent === "string" ? userAgent.toLowerCase() : "";
  if (ua.includes("ipad") || ua.includes("tablet") || ua.includes("kindle") || ua.includes("playbook")) {
    return "tablette";
  }
  if (ua.includes("android")) return ua.includes("mobile") ? "mobile" : "tablette";
  if (/iphone|ipod|windows phone|iemobile|blackberry|opera mini|mobile safari/.test(ua)) {
    return "mobile";
  }
  // Le défaut est l'ordinateur : c'est ce qu'on sert quand on ne sait pas, et
  // le poste de bureau reste le cas le plus courant hors marqueur explicite.
  return "ordinateur";
}
