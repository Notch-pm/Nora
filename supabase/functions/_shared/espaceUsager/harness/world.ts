/**
 * Le « monde » d'un test de flux : portal-api RÉEL (son `index.ts`, chargé avec
 * un `Deno` minimal), derrière le VRAI Worker de relais (`worker/proxy.ts`),
 * sur la VRAIE base Nora (migrations rejouées sur PGlite), face à un Socle, un
 * Iris et un GoTrue simulés.
 *
 * Un test écrit donc comme un navigateur : `browser.send("/v1/compte/connexion", …)`.
 * Le cookie de session, les en-têtes certifiés, le filtrage des en-têtes de
 * retour sont ceux de la production.
 */
import type { PGlite } from "@electric-sql/pglite";
import { vi } from "vitest";
import { downstreamResponse, upstreamRequest } from "../../../../../worker/proxy.ts";
import { clearMailbox, lastLinkToken, mailbox } from "./mailbox.ts";
import { type Call, FakeGoTrue, FakeIris, FakeSocle, headersOf, bodyOf, json } from "./fakes.ts";
import { createRpc, freshNoraDb } from "./noraDb.ts";

export const SCEAUX = { id: "8f1e0d3a-0000-4000-8000-0000000000a1", name: "Ville de Sceaux", slug: "sceaux", hostname: "sceaux.edilumen.fr" };
export const ANTONY = { id: "8f1e0d3a-0000-4000-8000-0000000000b2", name: "Ville d'Antony", slug: "antony", hostname: "antony.edilumen.fr" };

export const PROC_LIBRE = { id: "p-libre", name: "Signaler un problème de voirie", fieldKey: "message" };
export const PROC_RESERVEE = { id: "p-reservee", name: "Carte famille", accessMode: "authentifie", fieldKey: "message" };
export const PROC_FUTUR = { id: "p-futur", name: "Démarche à mode inconnu", accessMode: "bientot" };

const PORTAL_API_ENTRY = "../../../portal-api/index.ts";
const PORTAL_API_URL = "https://nora.test/portal-api";
export const PROXY_SECRET = "p".repeat(40);
export const IRIS_TOKEN_SECRET = "i".repeat(48);

export const BASE_ENV: Record<string, string> = {
  SOCLE_API_URL: "https://socle.test/functions/v1/public-api",
  SOCLE_API_KEY: "sk_test_nora",
  IRIS_API_URL: "https://iris.test/functions/v1/requests-api",
  IRIS_API_KEY: "irs_test_nora",
  SUPABASE_URL: "https://nora.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-for-tests",
  NORA_PROXY_SECRET: PROXY_SECRET,
  NORA_AUTH_SECRET: "a".repeat(48),
  NORA_IRIS_TOKEN_SECRET: IRIS_TOKEN_SECRET,
  PORTAL_CACHE_TTL_SECONDS: "0",
};

type Handler = (request: Request) => Promise<Response>;

export interface Reply {
  status: number;
  body: any;
  headers: Headers;
  /** Les cookies posés par la réponse, tels que le navigateur les recevrait (après le filtre du Worker). */
  setCookies: string[];
}

export interface SendOptions {
  method?: string;
  json?: unknown;
  body?: BodyInit;
  /** Corps en flux, sans Content-Length : un envoi qui ment sur sa taille. */
  stream?: ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
  /** Par défaut vrai pour tout sauf GET : l'en-tête que seule une page du portail pose. */
  mutationHeader?: boolean;
  /** Origine déclarée par le navigateur ; par défaut celle du portail visité. */
  origin?: string | null;
  /** Sans cookie, même si le navigateur en a un. */
  noCookie?: boolean;
}

export class Browser {
  jar = new Map<string, string>();

  constructor(
    private world: World,
    readonly host: string,
    readonly ip: string,
  ) {}

  /** Le jeton de session que ce navigateur détient (pour le rejouer ailleurs). */
  get sessionCookie(): string | null {
    return this.jar.get("__Host-nora_sid") ?? null;
  }

  set sessionCookie(value: string | null) {
    if (value === null) this.jar.delete("__Host-nora_sid");
    else this.jar.set("__Host-nora_sid", value);
  }

  async send(path: string, options: SendOptions = {}): Promise<Reply> {
    const method = options.method ?? (options.json !== undefined || options.body !== undefined || options.stream !== undefined ? "POST" : "GET");
    const headers = new Headers({ "user-agent": "Mozilla/5.0 (test)", "cf-connecting-ip": this.ip, ...options.headers });
    if (options.json !== undefined) headers.set("content-type", "application/json");
    if (method !== "GET" && options.mutationHeader !== false) headers.set("x-nora-request", "1");
    const origin = options.origin === undefined ? `https://${this.host}` : options.origin;
    if (origin !== null && method !== "GET") headers.set("origin", origin);
    if (!options.noCookie && this.jar.size > 0) {
      headers.set("cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
    }
    const request = new Request(`https://${this.host}/api${path}`, {
      method,
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : (options.stream ?? options.body ?? null),
      ...(options.stream ? { duplex: "half" } : {}),
    } as RequestInit);
    const reply = await this.world.relay(request);
    for (const cookie of reply.setCookies) {
      const [pair] = cookie.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === "" || /Max-Age=0/i.test(cookie)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return reply;
  }
}

export class World {
  db!: PGlite;
  gotrue!: FakeGoTrue;
  socle = new FakeSocle();
  iris = new FakeIris();
  calls: Call[] = [];
  private handler!: Handler;
  private pending: Promise<unknown>[] = [];
  env: Record<string, string | undefined> = { ...BASE_ENV };
  /**
   * Sans `realTime`, les attentes de durée plancher (900 ms) sont exécutées
   * aussitôt et seulement NOTÉES (`floorWaits`) : les tests restent rapides et
   * déterministes. Avec `realTime`, elles durent vraiment.
   */
  realTime = false;
  floorWaits: number[] = [];
  /** Toutes les réponses rendues au navigateur (après le Worker) : pour relire les fuites en bloc. */
  allReplies: Reply[] = [];
  private realSetTimeout = globalThis.setTimeout;

  /** Démarre un monde neuf : base vierge, deux collectivités, portal-api rechargé (limiteurs vierges). */
  static async create(envOverrides: Record<string, string | undefined> = {}, options: { realTime?: boolean } = {}): Promise<World> {
    const world = new World();
    world.realTime = options.realTime === true;
    world.db = await freshNoraDb();
    world.gotrue = new FakeGoTrue(world.db);
    world.env = { ...BASE_ENV, ...envOverrides };
    world.socle.addTenant(SCEAUX, [PROC_LIBRE, PROC_RESERVEE, PROC_FUTUR]);
    world.socle.addTenant(ANTONY, [PROC_LIBRE, PROC_RESERVEE]);
    world.iris.tokenSecret = IRIS_TOKEN_SECRET;
    world.iris.tenantSources.add(SCEAUX.id);
    world.iris.tenantSources.add(ANTONY.id);
    clearMailbox();
    await world.boot();
    return world;
  }

  private async boot(): Promise<void> {
    // Un monde à la fois : les doublures globales d'un monde précédent (fetch, minuteur) sont levées.
    vi.unstubAllGlobals();
    const rpc = createRpc(this.db);
    const knownTenants = (id: string) => [...this.socle.tenants.values()].some((t) => t.id === id);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = headersOf(init);
      const body = await bodyOf(init);
      const record = (service: Call["service"]) => this.calls.push({ service, method, path: url.pathname + url.search, headers, body });

      if (url.hostname === "nora.test" && url.pathname.startsWith("/rest/v1/rpc/")) {
        record("nora-db");
        if (headers.authorization !== `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`) return json(401, { message: "Invalid API key" });
        const result = await rpc(url.pathname.replace("/rest/v1/rpc/", ""), (body ?? {}) as Record<string, unknown>);
        return result.status === 204 ? new Response(null, { status: 204 }) : json(result.status, result.body);
      }
      if (url.hostname === "nora.test" && url.pathname.startsWith("/auth/v1/")) {
        record("gotrue");
        return this.gotrue.handle(method, url.pathname.replace("/auth/v1", "") + "", body as Record<string, unknown> | null);
      }
      if (url.hostname === "socle.test" && url.pathname.includes("/public-api")) {
        record("socle");
        return this.socle.handlePublic(method, url, headers);
      }
      if (url.hostname === "socle.test" && url.pathname.includes("/contacts-api")) {
        record("contacts");
        return this.socle.handleContacts(method, url, headers, body);
      }
      if (url.hostname === "iris.test") {
        record("iris");
        return this.iris.handle(method, url, headers, body, knownTenants);
      }
      throw new Error(`fetch non prévu dans le test : ${method} ${url.href}`);
    });

    if (!this.realTime) {
      const real = this.realSetTimeout;
      vi.stubGlobal("setTimeout", (fn: () => void, ms?: number, ...args: unknown[]) => {
        if (typeof ms === "number" && ms >= 100) {
          this.floorWaits.push(ms);
          return real(fn, 0, ...args);
        }
        return real(fn, ms, ...args);
      });
    }

    // Les courriels et la mesure partent « après la réponse » : on les attend à la demande.
    (globalThis as Record<string, unknown>).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => this.pending.push(p) };
    (globalThis as Record<string, unknown>).Deno = {
      env: { get: (name: string) => this.env[name] },
      serve: (handler: Handler) => {
        this.handler = handler;
      },
    };
    vi.resetModules();
    // Chemin en variable : le compilateur ne suit pas l'import (index.ts est écrit pour Deno), Vitest le charge.
    const entry = PORTAL_API_ENTRY;
    await import(/* @vite-ignore */ entry);
  }

  /** Le navigateur d'un visiteur, sur le domaine d'une collectivité, depuis une adresse IP. */
  browser(tenant: { hostname: string } = SCEAUX, ip = "198.51.100.10"): Browser {
    return new Browser(this, tenant.hostname, ip);
  }

  /** Requête de navigateur → Worker → portal-api → Worker → navigateur. */
  async relay(request: Request): Promise<Reply> {
    const upstream = upstreamRequest(request, {
      PORTAL_API_URL,
      NORA_PROXY_SECRET: this.env.NORA_PROXY_SECRET,
    });
    const reply = await toReply(upstream instanceof Response ? upstream : downstreamResponse(await this.handler(upstream)));
    this.allReplies.push(reply);
    return reply;
  }

  /** Un appel direct à portal-api, sans le Worker (client hors navigateur, ou attaquant). */
  async direct(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Reply> {
    const headers = new Headers(init.headers);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    const response = await this.handler(
      new Request(`${PORTAL_API_URL}${path}`, {
        method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      }),
    );
    return toReply(response);
  }

  /** Attend les courriels et autres travaux différés. */
  async flush(): Promise<void> {
    while (this.pending.length > 0) await Promise.allSettled(this.pending.splice(0));
  }

  get mails() {
    return mailbox;
  }

  mailsTo(address: string) {
    return mailbox.filter((m) => m.to === address);
  }

  linkToken(address: string): string | null {
    return lastLinkToken(address);
  }

  async sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
    return (await this.db.query<T>(query, params)).rows;
  }

  callsTo(service: Call["service"]): Call[] {
    return this.calls.filter((c) => c.service === service);
  }

  async close(): Promise<void> {
    await this.flush();
    vi.unstubAllGlobals();
    delete (globalThis as Record<string, unknown>).Deno;
    delete (globalThis as Record<string, unknown>).EdgeRuntime;
  }
}

async function toReply(response: Response): Promise<Reply> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text === "" ? null : JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers, setCookies: response.headers.getSetCookie() };
}

// ── Parcours réutilisés par les tests ───────────────────────────────────────

export const PASSWORD = "Un-Mot-De-Passe-12!";

/** Inscription → lien → mot de passe choisi : un compte confirmé, rien de plus. */
export async function registerConfirmed(world: World, browser: Browser, email: string, password = PASSWORD): Promise<void> {
  const signup = await browser.send("/v1/compte/inscription", { json: { email, cguAccepted: true } });
  if (signup.status !== 200) throw new Error("inscription : " + JSON.stringify(signup.body));
  await world.flush();
  const token = world.linkToken(email);
  if (!token) throw new Error("aucun lien reçu par " + email);
  const confirm = await browser.send("/v1/compte/confirmation", { json: { jeton: token, password } });
  if (confirm.status !== 200) throw new Error("confirmation : " + JSON.stringify(confirm.body));
}

export async function login(browser: Browser, email: string, password = PASSWORD): Promise<Reply> {
  return browser.send("/v1/compte/connexion", { json: { email, password } });
}

/** Un compte confirmé ET connecté dans ce navigateur. */
export async function signedIn(world: World, browser: Browser, email: string): Promise<void> {
  await registerConfirmed(world, browser, email);
  const reply = await login(browser, email);
  if (reply.status !== 200 || reply.body.authenticated !== true) throw new Error("connexion : " + JSON.stringify(reply.body));
}

export const IDENTITE = {
  civilite: "madame",
  prenom: "Camille",
  nom: "Durand",
  adresse1: "12 rue Houdan",
  codePostal: "92330",
  ville: "Sceaux",
};

/** Connecté + profil rempli : l'espace a sa fiche du Socle. Rend l'id de la fiche. */
export async function withProfile(world: World, browser: Browser, email: string, identite: Record<string, unknown> = IDENTITE): Promise<string> {
  await signedIn(world, browser, email);
  const reply = await browser.send("/v1/compte/profil", { json: identite });
  if (reply.status !== 200) throw new Error("profil : " + JSON.stringify(reply.body));
  const [row] = await world.sql<{ socle_contact_id: string }>(
    "select s.socle_contact_id from citizen_spaces s join citizen_accounts a on a.id = s.account_id where a.email_hash = $1 and s.socle_contact_id is not null",
    [await sha256(`email:${email}`)],
  );
  return row.socle_contact_id;
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
