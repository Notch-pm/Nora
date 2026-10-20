/**
 * Les partenaires de portal-api, simulés au niveau HTTP : Supabase Auth
 * (GoTrue), le Socle (public-api et contacts-api, scope `citizen`) et Iris
 * (requests-api, ingestion et vue usager).
 *
 * Ce sont des MODÈLES du contrat, écrits pour ces tests : leur fidélité au
 * vrai Socle et au vrai Iris est vérifiée dans les dépôts de ces projets
 * (branche `test/espace-usager`). Ici, on vérifie ce que NORA fait de leurs
 * réponses — et ce qu'il leur envoie.
 *
 * Deux dispositions volontaires :
 *   · le faux Iris peut être « hostile » (`leakExtras`) : il ajoute à ses
 *     réponses des champs internes (motif de clôture, notes, agents) que le
 *     vrai Iris ne sert pas. Nora doit les écarter (liste blanche à nouveau) ;
 *   · chaque appel sortant est consigné (`calls`) pour vérifier qu'aucun
 *     identifiant de fiche ne vient du navigateur.
 */
import type { PGlite } from "@electric-sql/pglite";

export interface Call {
  service: "gotrue" | "socle" | "contacts" | "iris" | "nora-db";
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => (out[k.toLowerCase()] = v));
  return out;
}

async function bodyOf(init: RequestInit | undefined): Promise<unknown> {
  if (typeof init?.body !== "string") return init?.body ?? null;
  try {
    return JSON.parse(init.body);
  } catch {
    return init.body;
  }
}

// ── Supabase Auth ───────────────────────────────────────────────────────────

interface GUser {
  id: string;
  email: string;
  password: string;
  confirmed: boolean;
}

export class FakeGoTrue {
  users = new Map<string, GUser>();
  private links = new Map<string, { userId: string; type: "email" | "recovery" }>();
  /** Panne simulée : toute demande de mot de passe répond ce statut (429 = frein par IP de GoTrue). */
  tokenStatus: number | null = null;

  constructor(private db: PGlite) {}

  byEmail(email: string): GUser | undefined {
    return [...this.users.values()].find((u) => u.email === email);
  }

  async handle(method: string, path: string, body: Record<string, unknown> | null): Promise<Response> {
    if (method === "POST" && path === "/admin/users") {
      const email = String(body?.email ?? "").toLowerCase();
      if (this.byEmail(email)) return json(422, { error_code: "email_exists", msg: "A user with this email address has already been registered" });
      const user: GUser = { id: crypto.randomUUID(), email, password: String(body?.password ?? ""), confirmed: false };
      this.users.set(user.id, user);
      await this.db.query("insert into auth.users (id, email) values ($1, $2)", [user.id, email]);
      return json(200, { id: user.id, email });
    }
    if (method === "POST" && path === "/admin/generate_link") {
      const user = this.byEmail(String(body?.email ?? "").toLowerCase());
      if (!user) return json(404, { error_code: "user_not_found" });
      const type = body?.type === "recovery" ? "recovery" : "email";
      const hashed = randomToken();
      this.links.set(hashed, { userId: user.id, type });
      return json(200, { properties: { hashed_token: hashed } });
    }
    if (method === "POST" && path === "/verify") {
      const link = this.links.get(String(body?.token_hash ?? ""));
      // Un lien ne sert qu'une fois, et pour son type.
      if (!link || link.type !== body?.type) return json(403, { error_code: "otp_expired" });
      this.links.delete(String(body?.token_hash));
      const user = this.users.get(link.userId)!;
      if (link.type === "email") user.confirmed = true;
      return json(200, { access_token: "gotrue-" + randomToken(), user: { id: user.id } });
    }
    if (method === "POST" && path.startsWith("/token")) {
      if (this.tokenStatus !== null) return json(this.tokenStatus, { error_code: "over_request_rate_limit" });
      const user = this.byEmail(String(body?.email ?? "").toLowerCase());
      if (!user || user.password !== body?.password) return json(400, { error_code: "invalid_credentials" });
      if (!user.confirmed) return json(400, { error_code: "email_not_confirmed" });
      return json(200, { access_token: "gotrue-" + randomToken(), user: { id: user.id } });
    }
    if (method === "POST" && path.startsWith("/logout")) return new Response(null, { status: 204 });
    const adminUser = path.match(/^\/admin\/users\/([^/]+)$/);
    if (adminUser) {
      const user = this.users.get(decodeURIComponent(adminUser[1]));
      if (!user) return json(404, { error_code: "user_not_found" });
      if (method === "PUT") {
        user.password = String(body?.password ?? "");
        return json(200, { id: user.id });
      }
      if (method === "GET") return json(200, { id: user.id, email: user.email });
    }
    return json(404, { error_code: "not_found", path });
  }
}

// ── Socle ───────────────────────────────────────────────────────────────────

export interface FakeTenant {
  id: string;
  name: string;
  slug: string;
  hostname: string;
}

export interface FakeProcedure {
  id: string;
  name: string;
  accessMode?: string;
  /** Champ texte déclaré au formulaire (clé de réponse). */
  fieldKey?: string;
}

export interface FakeContact {
  id: string;
  civility: string | null;
  first_name: string;
  last_name: string;
  usage_name: string | null;
  birth_date: string | null;
  email: string;
  mobile_phone: string | null;
  landline_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  status: "active" | "archived";
  /** Champs INTERNES du référentiel, qui ne doivent jamais atteindre l'usager. */
  internal_notes: string;
  consents: { kind: string; granted: boolean; at: string; statement: string }[];
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export class FakeSocle {
  tenants = new Map<string, FakeTenant>();
  procedures = new Map<string, FakeProcedure[]>();
  smtp = new Map<string, Record<string, unknown> | null>();
  contacts = new Map<string, Map<string, FakeContact>>();
  /** `${tenant}|${accountId}` → fiche. */
  refs = new Map<string, string>();
  /** Scopes de la clé de Nora : retirer `citizen` pour simuler une clé mal réglée. */
  scopes = new Set(["read", "citizen", "smtp", "audience"]);
  readonly key = "sk_test_nora";

  addTenant(tenant: FakeTenant, procedures: FakeProcedure[], smtp = true): void {
    this.tenants.set(tenant.hostname, tenant);
    this.procedures.set(tenant.id, procedures);
    this.contacts.set(tenant.id, new Map());
    this.smtp.set(
      tenant.id,
      smtp ? { configured: true, host: `smtp.${tenant.slug}.test`, port: 587, from_email: `no-reply@${tenant.hostname}`, from_name: tenant.name } : null,
    );
  }

  /** Une fiche déjà présente au référentiel (saisie d'agent, dépôt antérieur…). */
  seedContact(tenantId: string, partial: Partial<FakeContact> & Pick<FakeContact, "first_name" | "last_name" | "email">): FakeContact {
    const contact: FakeContact = {
      id: crypto.randomUUID(),
      civility: "madame",
      usage_name: null,
      birth_date: null,
      mobile_phone: null,
      landline_phone: null,
      address_line1: "1 rue des Écoles",
      address_line2: null,
      postal_code: "92330",
      city: "Sceaux",
      country: "France",
      status: "active",
      internal_notes: "NOTE INTERNE : usager difficile, ne pas rappeler",
      consents: [],
      ...partial,
    };
    this.contacts.get(tenantId)!.set(contact.id, contact);
    return contact;
  }

  contactOf(tenantId: string, accountId: string): FakeContact | null {
    const id = this.refs.get(`${tenantId}|${accountId}`);
    return id ? (this.contacts.get(tenantId)?.get(id) ?? null) : null;
  }

  private dto(c: FakeContact) {
    const last = (kind: string) => c.consents.filter((x) => x.kind === kind).at(-1);
    const t = last("traitement");
    const p = last("partage");
    return {
      id: c.id,
      civility: c.civility,
      first_name: c.first_name,
      last_name: c.last_name,
      usage_name: c.usage_name,
      birth_date: c.birth_date,
      email: c.email,
      mobile_phone: c.mobile_phone,
      landline_phone: c.landline_phone,
      address_line1: c.address_line1,
      address_line2: c.address_line2,
      postal_code: c.postal_code,
      city: c.city,
      country: c.country,
      consent_traitement: t?.granted ?? null,
      consent_traitement_at: t?.at ?? null,
      consent_partage: p?.granted ?? null,
      consent_partage_at: p?.at ?? null,
    };
  }

  /** public-api : tenant, démarches, serveur d'envoi. */
  async handlePublic(method: string, url: URL, headers: Record<string, string>): Promise<Response> {
    if (headers.authorization !== `Bearer ${this.key}`) return json(401, { error: { code: "unauthorized" } });
    const path = url.pathname.replace(/^.*\/public-api/, "");
    if (method !== "GET") return json(405, {});
    if (path === "/v1/portal/tenant") {
      const t = this.tenants.get(url.searchParams.get("hostname") ?? "");
      return t ? json(200, { ...t, languages: ["fr"] }) : json(404, { error: { code: "not_found" } });
    }
    const tenantId = url.searchParams.get("tenant_id") ?? "";
    const list = this.procedures.get(tenantId);
    if (path === "/v1/portal/procedures") {
      return list ? json(200, list.map((p) => this.procedureRow(p, tenantId))) : json(404, {});
    }
    const detail = path.match(/^\/v1\/portal\/procedures\/([^/]+)$/);
    if (detail) {
      const p = list?.find((x) => x.id === decodeURIComponent(detail[1]));
      return p ? json(200, this.procedureRow(p, tenantId, true)) : json(404, {});
    }
    const smtp = path.match(/^\/v1\/organizations\/([^/]+)\/smtp$/);
    if (smtp) {
      if (!this.scopes.has("smtp")) return json(403, {});
      const cfg = this.smtp.get(smtp[1]);
      return cfg === undefined ? json(404, {}) : json(200, cfg ?? { configured: false });
    }
    return json(404, { error: { code: "not_found", path } });
  }

  private procedureRow(p: FakeProcedure, tenantId: string, detail = false) {
    const tenant = [...this.tenants.values()].find((t) => t.id === tenantId)!;
    return {
      id: p.id,
      name: p.name,
      organizations: [{ id: tenant.id, name: tenant.name, slug: tenant.slug }],
      ...(p.accessMode === undefined ? {} : { access_mode: p.accessMode }),
      ...(detail
        ? {
            form_schema: p.fieldKey
              ? { version: 1, content: [{ id: "f1", key: p.fieldKey, type: "text", label: "Votre message" }] }
              : null,
          }
        : {}),
    };
  }

  /** contacts-api, routes `/v1/citizen/*` (scope `citizen`). */
  async handleContacts(method: string, url: URL, headers: Record<string, string>, body: unknown): Promise<Response> {
    if (headers.authorization !== `Bearer ${this.key}`) return json(401, {});
    if (!this.scopes.has("citizen")) return json(403, { error: { code: "forbidden" } });
    const tenantId = headers["x-organization-id"] ?? "";
    if (!this.contacts.has(tenantId)) return json(404, { error: { code: "not_found" } });
    const m = url.pathname.match(/\/v1\/citizen\/contacts\/([0-9a-f-]{36})(?:\/(link|consents))?$/i);
    if (!m) return json(404, {});
    const [, accountId, action] = m;
    const refKey = `${tenantId}|${accountId}`;
    const bag = this.contacts.get(tenantId)!;
    const current = this.contactOf(tenantId, accountId);

    if (action === "link" && method === "POST") {
      const f = body as Record<string, string>;
      if (!f.first_name || !f.last_name || !f.email || !f.postal_code) return json(400, { error: { message: "Identité incomplète." } });
      if (current) return json(200, { contact: this.dto(current), outcome: "already_linked" });
      const taken = new Set(this.refs.values());
      const candidates = [...bag.values()].filter(
        (c) =>
          c.status === "active" &&
          c.email.toLowerCase() === f.email.toLowerCase() &&
          norm(c.first_name) === norm(f.first_name) &&
          (norm(c.last_name) === norm(f.last_name) || norm(c.usage_name) === norm(f.last_name)) &&
          (c.postal_code ?? "").replace(/ /g, "") === f.postal_code.replace(/ /g, "") &&
          (c.birth_date === null || c.birth_date === (f.birth_date ?? null)) &&
          !taken.has(c.id),
      );
      if (candidates.length === 1) {
        this.refs.set(refKey, candidates[0].id);
        return json(200, { contact: this.dto(candidates[0]), outcome: "existing" });
      }
      const created = this.seedContact(tenantId, {
        civility: f.civility ?? null,
        first_name: f.first_name,
        last_name: f.last_name,
        email: f.email.toLowerCase(),
        birth_date: f.birth_date ?? null,
        address_line1: f.address_line1 ?? null,
        postal_code: f.postal_code,
        city: f.city ?? null,
        internal_notes: "",
      });
      this.refs.set(refKey, created.id);
      return json(201, { contact: this.dto(created), outcome: "created" });
    }
    if (!current || current.status !== "active") return json(404, { error: { code: "not_found" } });
    if (action === "consents" && method === "POST") {
      const b = body as { kind: string; granted: boolean };
      current.consents.push({ kind: b.kind, granted: b.granted, at: new Date().toISOString(), statement: "phrase composée par le Socle" });
      return json(201, { contact: this.dto(current) });
    }
    if (!action && method === "GET") return json(200, { contact: this.dto(current) });
    if (!action && method === "PATCH") {
      Object.assign(current, body as object);
      return json(200, { contact: this.dto(current) });
    }
    return json(405, {});
  }
}

// ── Iris ────────────────────────────────────────────────────────────────────

export interface IrisRequest {
  id: string;
  tenantId: string;
  reference: string;
  source: string;
  contactId: string | null;
  citizenVisible: boolean;
  status: string;
  subject: string;
  procedureName: string | null;
  receivedAt: string;
  updatedAt: string;
  closedAt: string | null;
  closureText: string | null;
  // Données INTERNES : ne doivent jamais atteindre l'usager.
  closureMotif: string | null;
  internalNotes: string[];
  assignedTo: string | null;
  // Accès invité.
  declaredEmail: string | null;
  codeHash: string | null;
  failures: number;
  /** Version de l'accès (Iris 2.8.0) : +1 à chaque nouveau code ou coupure. */
  accessVersion: number;
  revoked: boolean;
  emails: { id: string; to: string; subject: string; body: string; sentAt: string }[];
  attachments: { id: string; fileName: string; kind: "demande" | "instruction_interne" }[];
}

export class FakeIris {
  requests = new Map<string, IrisRequest>();
  /** `X-Citizen-Token` : secret partagé avec Nora (`NORA_IRIS_TOKEN_SECRET`). */
  tokenSecret: string | null = null;
  tenantSources = new Set<string>();
  leakExtras = false;
  readonly key = "irs_test_nora";
  private counter = 0;
  /** Tout ce qu'Iris a reçu — pour vérifier ce que Nora envoie. */
  ingested: Record<string, unknown>[] = [];
  uploads: { name: string; size: number }[] = [];
  /** Jetons reçus sur les lectures `/v1/citizen/*`. */
  tokensSeen: (string | null)[] = [];
  /** « Code perdu » reçus (Iris 2.8.0). */
  resends: { reference: string; email: string }[] = [];

  /** Ce que fait l'agent dans Iris : couper l'accès, ou envoyer un nouveau code (lot L4a). */
  revoke(r: IrisRequest): void {
    r.revoked = true;
    r.accessVersion += 1;
  }
  reissue(r: IrisRequest, code: string): void {
    r.codeHash = code;
    r.revoked = false;
    r.failures = 0;
    r.accessVersion += 1;
  }

  addRequest(partial: Partial<IrisRequest> & Pick<IrisRequest, "tenantId">): IrisRequest {
    this.counter += 1;
    const r: IrisRequest = {
      id: crypto.randomUUID(),
      reference: `DEM-2026-${String(this.counter).padStart(6, "0")}`,
      source: "portail-citoyen",
      contactId: null,
      citizenVisible: true,
      status: "a_traiter",
      subject: "Signaler un problème",
      procedureName: "Signaler un problème",
      receivedAt: new Date(Date.now() - 1000 * (100 - this.counter)).toISOString(),
      updatedAt: new Date().toISOString(),
      closedAt: null,
      closureText: null,
      closureMotif: "MOTIF INTERNE : doublon, usager multi-récidiviste",
      internalNotes: ["NOTE INTERNE : à surveiller"],
      assignedTo: "Agent Martin Dupont",
      declaredEmail: null,
      codeHash: null,
      failures: 0,
      accessVersion: 1,
      revoked: false,
      emails: [],
      attachments: [],
      ...partial,
    };
    this.requests.set(r.id, r);
    return r;
  }

  private async hmac(text: string): Promise<string> {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(this.tokenSecret!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text)));
    let binary = "";
    for (const b of mac) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** Équivalent de `verifyCitizenToken` d'Iris : signature, tenant, expiration, durée maximale de 3 minutes. */
  private async subject(
    token: string | null,
    tenantId: string,
  ): Promise<{ kind: "request" | "contact"; id: string; email: string | null; version: number | null } | null> {
    if (this.tokenSecret === null || !token) return null;
    const [body, mac] = token.split(".");
    if (!body || !mac || (await this.hmac(body)) !== mac) return null;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    } catch {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== 1 || payload.t !== tenantId || typeof payload.exp !== "number") return null;
    if (payload.exp <= now || payload.exp > now + 180) return null;
    const [kind, id] = String(payload.sub).split(":");
    if (kind !== "request" && kind !== "contact") return null;
    return {
      kind,
      id,
      email: typeof payload.e === "string" ? payload.e.toLowerCase() : null,
      version: Number.isInteger(payload.g) ? (payload.g as number) : null,
    };
  }

  async handle(method: string, url: URL, headers: Record<string, string>, body: unknown, tenantIdOf: (root: string) => boolean): Promise<Response> {
    if (headers.authorization !== `Bearer ${this.key}`) return json(401, {});
    const tenantId = headers["x-socle-root-organization-id"] ?? "";
    if (!tenantIdOf(tenantId) || !this.tenantSources.has(tenantId)) return json(403, {});
    const path = url.pathname.replace(/^.*\/requests-api/, "");

    if (method === "POST" && path === "/v1/requests") {
      const env = body as Record<string, any>;
      this.ingested.push(env);
      const created = this.addRequest({
        tenantId,
        contactId: env.socle_contact_id ?? null,
        subject: env.subject,
        procedureName: env.subject,
        declaredEmail: env.requester?.courriel ?? null,
        codeHash: env.guest_access ? "ABCD-EFGH-JK" : null,
      });
      return json(201, {
        created: true,
        request: { reference: created.reference, status: created.status },
        ...(env.guest_access ? { guest_access: { code: "ABCD-EFGH-JK" } } : {}),
      });
    }

    if (method === "POST" && path === "/v1/uploads") {
      const file = body instanceof FormData ? body.get("file") : null;
      if (!(file instanceof File)) return json(400, { error: { code: "bad_request" } });
      if (file.size > 25 * 1024 * 1024) return json(413, { error: { code: "payload_too_large" } });
      this.uploads.push({ name: file.name, size: file.size });
      return json(201, { upload: { upload_id: crypto.randomUUID(), file_name: file.name, mime_type: file.type || "application/pdf", size_bytes: file.size } });
    }

    if (method === "POST" && path === "/v1/citizen/access") {
      const { reference, email, code } = body as Record<string, string>;
      const r = [...this.requests.values()].find((x) => x.tenantId === tenantId && x.reference === reference && x.source === "portail-citoyen");
      if (!r || r.codeHash === null || (r.declaredEmail ?? "").toLowerCase() !== String(email).toLowerCase()) {
        return json(404, { error: { code: "not_found" } });
      }
      if (r.failures >= 5 || r.revoked) return json(404, { error: { code: "not_found" } });
      if (code !== r.codeHash) {
        r.failures += 1;
        return json(404, { error: { code: "not_found" } });
      }
      return json(200, { request_id: r.id, access_version: r.accessVersion });
    }

    if (method === "POST" && path === "/v1/citizen/access/resend") {
      const { reference, email } = body as Record<string, string>;
      this.resends.push({ reference, email });
      return json(202, { accepted: true });
    }

    const one = path.match(/^\/v1\/citizen\/requests\/([0-9a-f-]{36})$/i);
    const file = path.match(/^\/v1\/citizen\/requests\/([0-9a-f-]{36})\/attachments\/([0-9a-f-]{36})$/i);
    const list = path.match(/^\/v1\/citizen\/contacts\/([0-9a-f-]{36})\/requests$/i);
    if (method === "GET" && (one || file || list)) {
      const token = headers["x-citizen-token"] ?? null;
      this.tokensSeen.push(token);
      const subject = await this.subject(token, tenantId);
      if (this.tokenSecret !== null && subject === null) return json(404, { error: { code: "not_found" } });

      if (list) {
        if (!subject || subject.kind !== "contact" || subject.id !== list[1]) return json(404, { error: { code: "not_found" } });
        const rows = [...this.requests.values()]
          .filter((r) => r.tenantId === tenantId && r.contactId === subject.id && r.citizenVisible)
          .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
        return json(200, { requests: rows.map((r) => this.summary(r)), next_before: null });
      }
      const id = (one ?? file)![1];
      const r = this.requests.get(id);
      if (!r || r.tenantId !== tenantId) return json(404, { error: { code: "not_found" } });
      let own = false;
      if (subject?.kind === "contact") own = r.contactId === subject.id && r.citizenVisible;
      else if (subject?.kind === "request") {
        own = subject.id === r.id && r.source === "portail-citoyen" && r.codeHash !== null && !r.revoked
          && (subject.version === null || subject.version === r.accessVersion);
      }
      if (!own) return json(404, { error: { code: "not_found" } });
      if (file) {
        const a = r.attachments.find((x) => x.id === file[2]);
        if (!a || a.kind === "instruction_interne") return json(404, { error: { code: "not_found" } });
        return json(200, { url: `https://storage.iris.test/signed/${a.id}?exp=60`, expires_in: 60 });
      }
      const emails = r.emails.filter((e) => subject?.kind !== "contact" || e.to.toLowerCase() === subject.email);
      return json(200, {
        request: {
          ...this.summary(r),
          closure_text: r.closedAt ? r.closureText : null,
          attachments: r.attachments.filter((a) => a.kind === "demande").map((a) => ({ id: a.id, file_name: a.fileName, mime_type: "application/pdf", size: 10 })),
          messages: emails.map((e) => ({ id: e.id, subject: e.subject, body: e.body, sent_at: e.sentAt, attachments: [] })),
          ...(this.leakExtras
            ? { closure_motif: r.closureMotif, internal_notes: r.internalNotes, assigned_to: r.assignedTo, request_messages: r.internalNotes, storage_path: "org/x/y.pdf" }
            : {}),
        },
      });
    }
    return json(404, { error: { code: "not_found", path } });
  }

  private summary(r: IrisRequest) {
    return {
      id: r.id,
      reference: r.reference,
      subject: r.subject,
      procedure_name: r.procedureName,
      status: r.status,
      received_at: r.receivedAt,
      updated_at: r.updatedAt,
      closed_at: r.closedAt,
      ...(this.leakExtras ? { assigned_to: r.assignedTo, closure_motif: r.closureMotif } : {}),
    };
  }
}

export { bodyOf, headersOf, json };
