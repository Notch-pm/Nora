/**
 * La composition publiée de la page d'accueil, traduite dans le modèle du
 * portail.
 *
 * Deux règles de traduction, voulues :
 *   - **on ne garde que ce qu'on sait rendre.** `actus` (rien à afficher) et
 *     tout kind inconnu sont ignorés — le contrat du Socle le demande, et
 *     c'est ce qui permet au Socle d'apprendre une section avant ce portail.
 *   - **absence n'est pas panne.** Un 404 signifie « jamais publiée » : la
 *     collectivité existe, elle n'a pas encore composé sa page, et le portail
 *     rend sa mise en page par défaut. Ce n'est pas une erreur à afficher.
 *
 * Les références (`pinned`, `shortcuts`) arrivent déjà résolues par le Socle ;
 * on les recopie sans les revérifier — le rendu joint sur `demarches`.
 *
 * ⚠️ LA LANGUE EST RÉSOLUE ICI, comme pour les démarches : plus loin,
 * `section.title` est un titre à afficher, pas un français dont il faudrait
 * chercher la traduction. `domain/page.ts` n'a pas bougé d'une ligne, et c'est
 * exactement ce que cette frontière est censée produire. Le repli se fait champ
 * par champ : un titre traduit sans son paragraphe reste un titre traduit.
 */
import type { PortalFailure } from "../domain/failure.ts";
import { localizedText } from "../domain/languages.ts";
import type { FooterColumns, GridColumns, HomePage, HomeSection, TexteSection } from "../domain/page.ts";
import type { SocleClient } from "./socleClient.ts";
import { httpsUrl } from "./urls.ts";

export type PageResult =
  | { ok: true; page: HomePage | null }
  | { ok: false; reason: PortalFailure };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function columns(value: unknown): GridColumns {
  return value === 2 || value === 4 ? value : 3;
}

function footerColumns(value: unknown): FooterColumns {
  return value === 1 || value === 2 ? value : 3;
}

/** Une couleur est une valeur CSS injectée dans la page : `#rrggbb` ou le sombre par défaut. */
const HEX_COLOR = /^#[0-9a-f]{6}$/;
const DEFAULT_FOOTER_BACKGROUND = "#0f1f18";

function background(value: unknown): string {
  const lower = text(value).trim().toLowerCase();
  return HEX_COLOR.test(lower) ? lower : DEFAULT_FOOTER_BACKGROUND;
}

function toSection(raw: unknown, lang: string): HomeSection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  if (id === "") return null;
  // ⚠️ `localizedText` rend `null` quand ni la traduction ni le français
  // n'existent ; les champs de section sont des chaînes, d'où le `?? ""`.
  const tr = row.translations;
  const title = localizedText(text(row.title), tr, lang, "title") ?? "";
  switch (row.kind) {
    case "recherche":
      return {
        id,
        kind: "recherche",
        title,
        subtitle: localizedText(text(row.subtitle), tr, lang, "subtitle") ?? "",
        placeholder: localizedText(text(row.placeholder), tr, lang, "placeholder") ?? "",
        // Raccourcis masqués = pas de raccourcis : le rendu n'a pas à
        // connaître l'existence du commutateur.
        shortcuts: row.show_shortcuts === true ? ids(row.shortcuts) : [],
      };
    case "demarches":
      return {
        id,
        kind: "demarches",
        title,
        columns: columns(row.columns),
        pinnedFirst: row.pinned_first === true,
        pinned: ids(row.pinned),
        // Absent = pas de filtre : c'est ce que sert le Socle pour les pages
        // composées avant qu'il existe, et le rendu n'a pas à le savoir.
        audienceFilter: row.audience_filter === true,
      };
    case "compte":
      return {
        id,
        kind: "compte",
        title,
        subtitle: localizedText(text(row.subtitle), tr, lang, "subtitle") ?? "",
      };
    case "texte":
      return {
        id,
        kind: "texte",
        title,
        body: localizedText(text(row.body), tr, lang, "body") ?? "",
        align: row.align === "center" ? "center" : "left",
      };
    case "texte-image":
      return {
        id,
        kind: "texte-image",
        title,
        body: localizedText(text(row.body), tr, lang, "body") ?? "",
        // ⚠️ `https` absolue ou rien (voir `urls.ts`) : plus strict que le
        // Socle, qui accepte aussi `http://` et les chemins absolus — ni l'un
        // ni l'autre ne peut s'afficher sur une page publique servie en https.
        // Le bloc reste rendu, sans image : le texte de la collectivité n'a pas
        // à disparaître avec son illustration.
        imageUrl: httpsUrl(row.image_url),
        // Traduit comme le reste : une synthèse vocale lit ce texte-là.
        alt: localizedText(text(row.alt), tr, lang, "alt") ?? "",
        layout: row.layout === "image-first" ? "image-first" : "text-first",
      };
    case "footer": {
      const children: TexteSection[] = [];
      if (Array.isArray(row.children)) {
        for (const child of row.children) {
          const section = toSection(child, lang);
          if (section && section.kind === "texte") children.push(section);
        }
      }
      return {
        id,
        kind: "footer",
        title,
        background: background(row.background),
        columns: footerColumns(row.columns),
        children,
      };
    }
    default:
      return null;
  }
}

function toHomePage(body: unknown, lang: string): HomePage | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  const publishedAt = text(raw.published_at);
  if (publishedAt === "") return null;
  const sections: HomeSection[] = [];
  if (Array.isArray(raw.sections)) {
    for (const candidate of raw.sections) {
      const section = toSection(candidate, lang);
      if (section) sections.push(section);
    }
  }
  return { publishedAt, sections };
}

/**
 * La page d'accueil publiée de la collectivité, ou `null` si elle n'a jamais
 * rien publié. `tenantId` vient toujours d'un `resolveTenant`.
 */
export async function getPublishedPage(
  tenantId: string,
  socle: SocleClient,
  lang: string,
): Promise<PageResult> {
  const reply = await socle.get(
    "/v1/portal/page?tenant_id=" + encodeURIComponent(tenantId) + "&slug=accueil",
  );
  switch (reply.kind) {
    case "not_found":
      return { ok: true, page: null };
    case "auth_failed":
      return { ok: false, reason: "socle_misconfigured" };
    case "unreachable":
    case "unexpected":
      return { ok: false, reason: "socle_unavailable" };
  }
  const page = toHomePage(reply.body, lang);
  if (page === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, page };
}
