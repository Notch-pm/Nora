/**
 * Les informations usagers des organismes — modèle du PORTAIL.
 *
 * Chaque organisme les rédige dans l'onglet « Informations usagers » du Socle :
 * un descriptif, ses horaires d'accueil jour par jour, des remarques sur ces
 * horaires, une FAQ. S'y ajoutent le téléphone et le courriel de sa fiche
 * (contrat 1.31.0). Le Socle les sert toutes en une lecture
 * (`GET /v1/portal/organizations?tenant_id=…`, contrat 1.30.0). Enregistré =
 * publié : il n'y a pas de brouillon.
 *
 * Aujourd'hui, seul l'assistant les lit : c'est là qu'il trouve « à quelle
 * heure ouvre la mairie ? ».
 *
 * Défini ici plutôt que recopié du DTO du Socle, comme `Tenant` et `Demarche` :
 * `socle/organismeInfoService.ts` est le seul endroit qui connaisse la forme de
 * la réponse.
 *
 * ⚠️ Trois règles du contrat, qu'un lecteur pressé inverserait :
 *  • **Pas d'héritage** : un organisme absent de la liste n'a rien dit. On ne
 *    lui prête pas les horaires de son parent.
 *  • **Un jour absent est fermé**, mais une grille **vide** veut dire « horaires
 *    non renseignés » — jamais « fermé toute la semaine ».
 *  • **Les remarques nuancent la grille** (jours fériés, fermetures, été) : elles
 *    se lisent avant d'affirmer qu'un organisme est ouvert un jour donné.
 *
 * Module PUR : pas de Deno, pas de réseau.
 */

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayOpeningHours {
  day: Weekday;
  morningOpen: string;
  /** Pause de midi — `null` avec `afternoonOpen` quand l'accueil est continu. */
  morningClose: string | null;
  afternoonOpen: string | null;
  afternoonClose: string;
}

export interface OrganismeInfo {
  id: string;
  name: string;
  /** La collectivité elle-même (en tête de liste), plutôt qu'un de ses organismes. */
  isTenant: boolean;
  /** Téléphone et courriel de sa fiche au Socle (contrat 1.31.0) — `null` si non renseignés. */
  phone: string | null;
  email: string | null;
  /** Markdown, `""` si rien n'est écrit. */
  description: string;
  /** Un élément par jour d'ouverture, dans l'ordre de la semaine. Vide = non renseigné. */
  openingHours: DayOpeningHours[];
  /** Markdown, `""` si rien n'est à signaler. */
  openingHoursNotes: string;
  faq: { question: string; answer: string }[];
}

type Row = Record<string, unknown>;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Une coordonnée : du texte non vide, borné ; `null` sinon (et face à un Socle d'avant 1.31.0). */
function contact(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean !== "" && clean.length <= 200 ? clean : null;
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/**
 * Un jour lu avec la même exigence que le Socle : ce qui est incohérent (jour
 * inconnu ou en double, pause à moitié, heures dans le désordre) est ÉCARTÉ,
 * jamais réparé — un horaire deviné est pire qu'un horaire absent.
 */
function parseDay(raw: unknown): DayOpeningHours | null {
  if (!isRecord(raw)) return null;
  const day = raw.day as Weekday;
  if (!WEEKDAYS.includes(day)) return null;
  if (!isTime(raw.morningOpen) || !isTime(raw.afternoonClose)) return null;
  const morningClose = raw.morningClose ?? null;
  const afternoonOpen = raw.afternoonOpen ?? null;
  if ((morningClose === null) !== (afternoonOpen === null)) return null;
  if (morningClose !== null && (!isTime(morningClose) || !isTime(afternoonOpen))) return null;
  const sequence =
    morningClose !== null
      ? [raw.morningOpen, morningClose as string, afternoonOpen as string, raw.afternoonClose]
      : [raw.morningOpen, raw.afternoonClose];
  if (sequence.some((time, i) => i > 0 && time <= sequence[i - 1])) return null;
  return {
    day,
    morningOpen: raw.morningOpen,
    morningClose: morningClose as string | null,
    afternoonOpen: afternoonOpen as string | null,
    afternoonClose: raw.afternoonClose,
  };
}

function parseOpeningHours(raw: unknown): DayOpeningHours[] {
  const byDay = new Map<Weekday, DayOpeningHours>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const day = parseDay(item);
    if (day !== null && !byDay.has(day.day)) byDay.set(day.day, day);
  }
  return WEEKDAYS.filter((day) => byDay.has(day)).map((day) => byDay.get(day)!);
}

function parseOrganisme(raw: unknown): OrganismeInfo | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const info = isRecord(raw.info) ? raw.info : {};
  const organisme: OrganismeInfo = {
    id: raw.id,
    name: raw.name,
    isTenant: raw.is_tenant === true,
    phone: contact(raw.phone),
    email: contact(raw.email),
    description: text(info.description),
    openingHours: parseOpeningHours(info.openingHours),
    openingHoursNotes: text(info.openingHoursNotes),
    faq: (Array.isArray(info.faq) ? info.faq : [])
      .filter(isRecord)
      .map((item) => ({ question: text(item.question).trim(), answer: text(item.answer).trim() }))
      .filter((item) => item.question !== "" && item.answer !== ""),
  };
  const empty =
    organisme.phone === null &&
    organisme.email === null &&
    organisme.description.trim() === "" &&
    organisme.openingHours.length === 0 &&
    organisme.openingHoursNotes.trim() === "" &&
    organisme.faq.length === 0;
  return empty ? null : organisme;
}

/**
 * La réponse du Socle, lue avec tolérance : un organisme illisible ou vide est
 * écarté, les autres restent. Une réponse qui n'est pas une liste vaut « rien
 * d'écrit » — l'assistant dira qu'il ne sait pas, il ne tombe pas en panne.
 */
export function parseOrganismesInfo(value: unknown): OrganismeInfo[] {
  if (!Array.isArray(value)) return [];
  const out: OrganismeInfo[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const organisme = parseOrganisme(raw);
    if (organisme === null || seen.has(organisme.id)) continue;
    seen.add(organisme.id);
    out.push(organisme);
  }
  return out;
}
