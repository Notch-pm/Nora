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
 */
import type { PortalFailure } from "../domain/failure.ts";
import type { GridColumns, HomePage, HomeSection } from "../domain/page.ts";
import type { SocleClient } from "./socleClient.ts";

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

function toSection(raw: unknown): HomeSection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const id = text(row.id);
  if (id === "") return null;
  const title = text(row.title);
  switch (row.kind) {
    case "recherche":
      return {
        id,
        kind: "recherche",
        title,
        subtitle: text(row.subtitle),
        placeholder: text(row.placeholder),
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
      };
    case "compte":
      return { id, kind: "compte", title, subtitle: text(row.subtitle) };
    case "texte":
      return {
        id,
        kind: "texte",
        title,
        body: text(row.body),
        align: row.align === "center" ? "center" : "left",
      };
    default:
      return null;
  }
}

function toHomePage(body: unknown): HomePage | null {
  if (typeof body !== "object" || body === null) return null;
  const raw = body as Record<string, unknown>;
  const publishedAt = text(raw.published_at);
  if (publishedAt === "") return null;
  const sections: HomeSection[] = [];
  if (Array.isArray(raw.sections)) {
    for (const candidate of raw.sections) {
      const section = toSection(candidate);
      if (section) sections.push(section);
    }
  }
  return { publishedAt, sections };
}

/**
 * La page d'accueil publiée de la collectivité, ou `null` si elle n'a jamais
 * rien publié. `tenantId` vient toujours d'un `resolveTenant`.
 */
export async function getPublishedPage(tenantId: string, socle: SocleClient): Promise<PageResult> {
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
  const page = toHomePage(reply.body);
  if (page === null) return { ok: false, reason: "socle_unavailable" };
  return { ok: true, page };
}
