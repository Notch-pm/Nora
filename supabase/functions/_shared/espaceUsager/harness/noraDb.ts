/**
 * Base Nora de test : les VRAIES migrations de l'espace usager rejouées sur
 * PGlite (Postgres en WebAssembly, en mémoire), et un adaptateur qui répond aux
 * appels `POST /rest/v1/rpc/<fonction>` de portal-api en exécutant la vraie
 * fonction SQL. Les tests de flux traversent ainsi le code de production ET le
 * SQL de production, sans réseau.
 *
 * Ce que PGlite ne reproduit pas : les rôles réels de Supabase (créés ici à
 * vide), `auth.users` (réduit à une table d'identifiants — GoTrue est simulé à
 * part), la concurrence entre connexions (une seule session SQL).
 *
 * Lancer : `npx vitest run supabase/functions/_shared/espaceUsager`.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "..", "..", "migrations");

/** Les migrations de l'espace usager, dans l'ordre de leur horodatage. */
export function espaceUsagerMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && /espace_usager/.test(name))
    .sort();
}

export async function createNoraDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
  `);
  for (const file of espaceUsagerMigrations()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return db;
}

let shared: PGlite | null = null;

/**
 * Une seule base par fichier de test (démarrer PGlite et rejouer les
 * migrations coûte ~0,7 s) : entre deux tests, les tables sont vidées. Les
 * fonctions, droits et contraintes — ce que les tests vérifient — restent ceux
 * des migrations.
 */
export async function freshNoraDb(): Promise<PGlite> {
  if (shared === null) {
    shared = await createNoraDb();
    return shared;
  }
  await shared.exec(`truncate table public.citizen_accounts, public.citizen_spaces, public.citizen_sessions,
    public.citizen_auth_events, public.citizen_login_guards, public.citizen_mail_quota, public.citizen_totp,
    public.citizen_cgu_acceptances, auth.users restart identity cascade`);
  return shared;
}

interface ProcInfo {
  names: string[];
  returnsSet: boolean;
  returnType: string;
}

/** Tableau PostgreSQL → littéral `{a,b}` (PGlite reçoit les tableaux en texte). */
function toParam(value: unknown): unknown {
  if (Array.isArray(value)) {
    return "{" + value.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`).join(",") + "}";
  }
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

/**
 * Répond comme PostgREST : une fonction `returns table` rend un tableau de
 * lignes, une fonction scalaire rend la valeur, `void` rend un corps vide.
 */
export function createRpc(db: PGlite) {
  const cache = new Map<string, ProcInfo | null>();

  async function describe(name: string): Promise<ProcInfo | null> {
    if (cache.has(name)) return cache.get(name) ?? null;
    const res = await db.query<{ names: string[] | null; retset: boolean; rettype: string }>(
      `select p.proargnames as names, p.proretset as retset, format_type(p.prorettype, null) as rettype
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    const row = res.rows[0];
    const info = row ? { names: row.names ?? [], returnsSet: row.retset, returnType: row.rettype } : null;
    cache.set(name, info);
    return info;
  }

  return async function rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const info = await describe(name);
    if (info === null) return { status: 404, body: { code: "PGRST202", message: `function ${name} not found` } };
    const keys = Object.keys(args);
    const unknown = keys.filter((k) => !info.names.includes(k));
    if (unknown.length > 0) return { status: 404, body: { code: "PGRST202", message: `unknown args ${unknown.join(",")}` } };
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    try {
      if (info.returnsSet) {
        const res = await db.query(`select * from ${call}`, keys.map((k) => toParam(args[k])));
        return { status: 200, body: res.rows };
      }
      const res = await db.query<{ r: unknown }>(`select ${call} as r`, keys.map((k) => toParam(args[k])));
      if (info.returnType === "void") return { status: 204, body: null };
      return { status: 200, body: res.rows[0]?.r ?? null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code ?? "P0001";
      return { status: code === "23505" ? 409 : 400, body: { code, message } };
    }
  };
}

export type Rpc = ReturnType<typeof createRpc>;
