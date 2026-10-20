/**
 * Les migrations de l'espace usager, rejouées sur PGlite (Postgres réel en
 * mémoire) : `20261019120000_espace_usager_sessions.sql`,
 * `20261020090000_espace_usager_comptes.sql`, `20261020160000_espace_usager_fiche.sql`.
 *
 * Quatre familles : (1) fermeture — RLS « tout refuser », aucun droit pour
 * anon/authenticated, RPC réservées au service_role ; (2) sessions ; (3) compte
 * (verrou, quota, TOTP, déclencheur t10) ; (4) fiche de l'espace.
 *
 * Lancer : `npx vitest run supabase/functions/_shared/espaceUsager/migrations.sql.test.ts`
 * (aucun Postgres à installer : PGlite est une dépendance de développement).
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { espaceUsagerMigrations, freshNoraDb } from "./harness/noraDb.ts";

let db: PGlite;
const q = async <T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> => (await db.query<T>(sql, params)).rows;
const one = async <T = any>(sql: string, params: unknown[] = []): Promise<T> => (await q<{ r: T }>(`select ${sql} as r`, params))[0].r;

const T1 = "aaaaaaaa-0000-4000-8000-000000000001";
const T2 = "aaaaaaaa-0000-4000-8000-000000000002";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const H = (c: string) => c.repeat(64);

beforeAll(async () => {
  db = await freshNoraDb();
});
beforeEach(async () => {
  db = await freshNoraDb();
});

async function account(id: string, hash: string, tenant = T1) {
  await db.query("insert into auth.users (id) values ($1)", [id]);
  return one<boolean>("public.citizen_account_register($1,$2,$3,'2026-10','203.0.113.9','FF')", [id, hash, tenant]);
}
const open = (idHash: string, accountId: string, tenant = T1, remember = false, idle = 1800, life = 43200) =>
  q("select public.citizen_session_open($1,'account',$2,null,$3,'{pwd}',$4,$5,$6,'203.0.113.9','FF')", [idHash, accountId, tenant, remember, idle, life]);

describe("les migrations", () => {
  it("sont trois, dans l'ordre, et se rejouent sur une base vierge sans erreur", () => {
    expect(espaceUsagerMigrations()).toEqual([
      "20261019120000_espace_usager_sessions.sql",
      "20261020090000_espace_usager_comptes.sql",
      "20261020160000_espace_usager_fiche.sql",
    ]);
  });
});

describe("fermeture : personne d'autre que le service_role", () => {
  it("RLS activée sur toutes les tables citoyennes, et AUCUNE politique", async () => {
    const tables = await q<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' order by 1",
    );
    expect(tables.map((t) => t.relname)).toEqual([
      "citizen_accounts", "citizen_auth_events", "citizen_cgu_acceptances", "citizen_login_guards",
      "citizen_mail_quota", "citizen_sessions", "citizen_spaces", "citizen_totp",
    ]);
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    expect(await q("select * from pg_policies where schemaname = 'public'")).toEqual([]);
  });

  it("anon et authenticated n'ont aucun droit sur aucune table (lecture, écriture, suppression)", async () => {
    for (const role of ["anon", "authenticated"]) {
      const rows = await q<{ t: string; priv: string }>(
        `select c.relname t, p.priv from pg_class c cross join (values ('select'),('insert'),('update'),('delete'),('truncate'),('references')) p(priv)
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege($1, c.oid, p.priv)`,
        [role],
      );
      expect(rows, role).toEqual([]);
    }
  });

  it("aucune fonction citoyenne n'est exécutable par public, anon ou authenticated ; toutes le sont par service_role", async () => {
    const fns = await q<{ sig: string; anon: boolean; auth: boolean; pub: boolean; svc: boolean }>(
      `select p.oid::regprocedure::text sig,
              has_function_privilege('anon', p.oid, 'execute') anon,
              has_function_privilege('authenticated', p.oid, 'execute') auth,
              has_function_privilege('public', p.oid, 'execute') pub,
              has_function_privilege('service_role', p.oid, 'execute') svc
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'citizen_%'`,
    );
    expect(fns.length).toBe(23);
    for (const f of fns) {
      expect(f.anon, `${f.sig} exécutable par anon`).toBe(false);
      expect(f.auth, `${f.sig} exécutable par authenticated`).toBe(false);
      expect(f.pub, `${f.sig} exécutable par public`).toBe(false);
      expect(f.svc, `${f.sig} non exécutable par service_role`).toBe(true);
    }
  });

  it("aucune fonction citoyenne n'est SECURITY DEFINER, et toutes figent leur search_path", async () => {
    const fns = await q<{ proname: string; prosecdef: boolean; cfg: string[] | null }>(
      "select proname, prosecdef, proconfig cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname like 'citizen_%'",
    );
    for (const f of fns) {
      expect(f.prosecdef, f.proname).toBe(false);
      expect((f.cfg ?? []).join(","), f.proname).toMatch(/search_path=""/);
    }
  });
});

describe("sessions", () => {
  beforeEach(async () => {
    await account(A, H("a"));
  });

  it("le journal consigne l'ouverture avec l'IP, l'agent et la nature", async () => {
    await open(H("1"), A);
    const [e] = await q("select event, host(ip) ip, user_agent, detail from citizen_auth_events where event = 'session_opened'");
    expect(e).toMatchObject({ ip: "203.0.113.9", user_agent: "FF" });
    expect(e.detail).toMatchObject({ kind: "account", amr: ["pwd"], remember: false });
  });

  it("résolution : valable sous SA collectivité, invisible sous une autre (et consignée, sans clore)", async () => {
    await open(H("1"), A, T1);
    expect(await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("1"), T1])).toHaveLength(1);
    expect(await q("select * from public.citizen_session_resolve($1,$2,'203.0.113.9','FF')", [H("1"), T2])).toEqual([]);
    expect((await q("select event from citizen_auth_events where event = 'session_tenant_mismatch'")).length).toBe(1);
    expect(await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("1"), T1])).toHaveLength(1);
  });

  it("une session inconnue, ou close, ne résout rien", async () => {
    expect(await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("9"), T1])).toEqual([]);
    await open(H("1"), A);
    expect(await one<boolean>("public.citizen_session_close($1,'logout',null,null)", [H("1")])).toBe(true);
    expect(await one<boolean>("public.citizen_session_close($1,'logout',null,null)", [H("1")])).toBe(false);
    expect(await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("1"), T1])).toEqual([]);
  });

  it("inactivité (idle_seconds) : close avec le motif « idle » ; fin de vie : « expired » ; chacune consignée", async () => {
    await open(H("1"), A, T1, false, 1800);
    await db.exec("update citizen_sessions set last_seen_at = now() - interval '1801 seconds'");
    expect(await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("1"), T1])).toEqual([]);
    await open(H("2"), A, T1, false, 1800, 60);
    await db.exec("update citizen_sessions set expires_at = now() - interval '1 second' where id_hash = '" + H("2") + "'");
    expect(await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("2"), T1])).toEqual([]);
    const reasons = await q("select id_hash, end_reason from citizen_sessions order by created_at");
    expect(reasons.map((r) => r.end_reason).sort()).toEqual(["expired", "idle"]);
    const events = (await q("select event from citizen_auth_events")).map((e) => e.event);
    expect(events).toEqual(expect.arrayContaining(["session_idle", "session_expired"]));
  });

  it("juste sous le seuil d'inactivité, la session vit ; l'échéance rendue est bornée par la fin de vie", async () => {
    await open(H("1"), A, T1, false, 1800, 600);
    await db.exec("update citizen_sessions set last_seen_at = now() - interval '300 seconds'");
    const [row] = await q("select expires_at, idle_expires_at from public.citizen_session_resolve($1,$2,null,null)", [H("1"), T1]);
    expect(row.idle_expires_at.getTime()).toBeLessThanOrEqual(row.expires_at.getTime());
  });

  it("l'activité n'est réécrite qu'à la minute, et rafraîchit le compte", async () => {
    await open(H("1"), A);
    const [{ t0 }] = await q("select last_seen_at::text t0 from citizen_sessions");
    await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("1"), T1]);
    expect((await q("select last_seen_at::text t from citizen_sessions"))[0].t).toBe(t0);
    await db.exec("update citizen_sessions set last_seen_at = now() - interval '90 seconds'; update citizen_accounts set last_seen_at = now() - interval '10 days'");
    await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("1"), T1]);
    expect((await q("select now() - last_seen_at < interval '5 seconds' ok from citizen_accounts"))[0].ok).toBe(true);
  });

  it("révocation d'un compte : toutes les sessions sauf la gardée ; chaque retrait consigné", async () => {
    await open(H("1"), A);
    await open(H("2"), A);
    await open(H("3"), A);
    expect(await one<number>("public.citizen_sessions_revoke_account($1,$2)", [A, H("2")])).toBe(2);
    expect((await q("select id_hash from citizen_sessions where ended_at is null")).map((r) => r.id_hash)).toEqual([H("2")]);
    expect((await q("select count(*)::int n from citizen_auth_events where event = 'session_revoked'"))[0].n).toBe(2);
    expect(await one<number>("public.citizen_sessions_revoke_account($1,null)", [A])).toBe(1);
  });

  it("contraintes : jeton haché sur 64 hex, sujet cohérent avec la nature, durées bornées", async () => {
    await expect(open("pas-un-hash", A)).rejects.toThrow();
    await expect(q("select public.citizen_session_open($1,'guest',null,null,$2,'{}',false,1800,7200,null,null)", [H("e"), T1])).rejects.toThrow();
    await expect(q("select public.citizen_session_open($1,'account',null,null,$2,'{}',false,1800,7200,null,null)", [H("e"), T1])).rejects.toThrow();
    await expect(q("select public.citizen_session_open($1,'account',$2,'DEM-1',$3,'{}',false,1800,7200,null,null)", [H("e"), A, T1])).rejects.toThrow();
    await expect(open(H("f"), A, T1, false, 59)).rejects.toThrow();
    await expect(open(H("f"), A, T1, false, 2592001)).rejects.toThrow();
    await expect(open(H("a"), A)).resolves.toBeDefined();
    await expect(open(H("a"), A)).rejects.toThrow(); // le même jeton ne s'ouvre pas deux fois
  });

  it("session invitée : elle porte la demande, jamais un compte", async () => {
    await q("select public.citizen_session_open($1,'guest',null,'req-1',$2,'{code}',false,1800,7200,null,null)", [H("b"), T1]);
    const [row] = await q("select * from public.citizen_session_resolve($1,$2,null,null)", [H("b"), T1]);
    expect(row).toMatchObject({ kind: "guest", account_id: null, guest_request_id: "req-1" });
  });

  it("agent utilisateur tronqué à 512 caractères en base", async () => {
    await q("select public.citizen_session_open($1,'account',$2,null,$3,'{}',false,1800,7200,null,$4)", [H("d"), A, T1, "x".repeat(900)]);
    expect((await q("select length(user_agent) n from citizen_sessions"))[0].n).toBe(512);
  });

  it("le journal refuse un événement inconnu", async () => {
    await expect(q("select public.citizen_event('piratage', $1, $2, null, null)", [T1, A])).rejects.toThrow();
  });
});

describe("compte", () => {
  it("inscription : une seule fois par identifiant, avec espace, CGU datées et événement", async () => {
    expect(await account(A, H("a"))).toBe(true);
    expect(await one<boolean>("public.citizen_account_register($1,$2,$3,'2026-10',null,null)", [A, H("a"), T1])).toBe(false);
    expect((await q("select count(*)::int n from citizen_spaces"))[0].n).toBe(1);
    expect((await q("select version from citizen_cgu_acceptances"))[0].version).toBe("2026-10");
    expect((await q("select event from citizen_auth_events"))[0].event).toBe("account_registered");
  });

  it("deux comptes ne partagent pas une adresse (empreinte unique)", async () => {
    await account(A, H("a"));
    await db.query("insert into auth.users (id) values ($1)", [B]);
    await expect(q("select public.citizen_account_register($1,$2,$3,'2026-10',null,null)", [B, H("a"), T1])).rejects.toThrow();
  });

  it("CGU : seule une version « AAAA-MM » est acceptée", async () => {
    await db.query("insert into auth.users (id) values ($1)", [A]);
    await expect(q("select public.citizen_account_register($1,$2,$3,'dernière',null,null)", [A, H("a"), T1])).rejects.toThrow();
  });

  it("par adresse : confirmé/actif, et un espace SEULEMENT dans la collectivité d'inscription", async () => {
    await account(A, H("a"), T1);
    expect((await q("select * from public.citizen_account_by_email($1,$2)", [H("a"), T1]))[0]).toMatchObject({ account_id: A, confirmed: false, active: true, has_space: true });
    expect((await q("select * from public.citizen_account_by_email($1,$2)", [H("a"), T2]))[0].has_space).toBe(false);
    expect(await q("select * from public.citizen_account_by_email($1,$2)", [H("z"), T1])).toEqual([]);
  });

  it("confirmation : idempotente, refusée pour un compte désactivé", async () => {
    await account(A, H("a"));
    expect(await one<boolean>("public.citizen_account_confirm($1,$2,null,null)", [A, T1])).toBe(true);
    const [{ c1 }] = await q("select confirmed_at::text c1 from citizen_accounts");
    expect(await one<boolean>("public.citizen_account_confirm($1,$2,null,null)", [A, T1])).toBe(true);
    expect((await q("select confirmed_at::text c from citizen_accounts"))[0].c).toBe(c1);
    await db.exec("update citizen_accounts set status = 'disabled'");
    expect(await one<boolean>("public.citizen_account_confirm($1,$2,null,null)", [A, T1])).toBe(false);
  });

  it("connexion : lecture seule — l'espace d'une autre collectivité n'est créé qu'à l'authentification complète", async () => {
    await account(A, H("a"), T1);
    await q("select public.citizen_account_confirm($1,$2,null,null)", [A, T1]);
    expect((await q("select * from public.citizen_account_for_login($1)", [A]))[0]).toMatchObject({ confirmed: true, active: true, totp_enabled: false });
    expect((await q("select count(*)::int n from citizen_spaces"))[0].n).toBe(1);
    await q("select public.citizen_space_ensure($1,$2)", [A, T2]);
    await q("select public.citizen_space_ensure($1,$2)", [A, T2]); // idempotent
    expect((await q("select count(*)::int n from citizen_spaces"))[0].n).toBe(2);
    // Un compte inexistant n'obtient pas d'espace.
    await q("select public.citizen_space_ensure($1,$2)", [B, T1]);
    expect((await q("select count(*)::int n from citizen_spaces where account_id = $1", [B]))[0].n).toBe(0);
  });

  it("verrou : 10 tentatives permises, la 11e verrouille (compte ou non) ; le verrou tient 15 minutes", async () => {
    const attempts: boolean[] = [];
    for (let i = 0; i < 12; i++) attempts.push(await one<boolean>("public.citizen_login_attempt($1,$2,null,null)", [H("9"), T1]));
    expect(attempts.slice(0, 10).every(Boolean)).toBe(true);
    expect(attempts.slice(10)).toEqual([false, false]);
    const [g] = await q("select locked_until > now() + interval '14 minutes' ok from citizen_login_guards");
    expect(g.ok).toBe(true);
    expect((await q("select count(*)::int n from citizen_auth_events where event = 'login_locked'"))[0].n).toBe(1);
    await db.exec("update citizen_login_guards set locked_until = now() - interval '1 second'");
    expect(await one<boolean>("public.citizen_login_attempt($1,$2,null,null)", [H("9"), T1])).toBe(true);
  });

  it("fenêtre glissante : les tentatives de plus de 15 minutes ne comptent plus", async () => {
    for (let i = 0; i < 9; i++) await q("select public.citizen_login_attempt($1,$2,null,null)", [H("8"), T1]);
    await db.exec("update citizen_login_guards set window_start = now() - interval '16 minutes'");
    await q("select public.citizen_login_attempt($1,$2,null,null)", [H("8"), T1]);
    expect((await q("select attempts from citizen_login_guards"))[0].attempts).toBe(1);
  });

  it("une connexion réussie efface le compteur ; deux adresses ne partagent pas leur compteur", async () => {
    for (let i = 0; i < 5; i++) await q("select public.citizen_login_attempt($1,$2,null,null)", [H("7"), T1]);
    await q("select public.citizen_login_attempt($1,$2,null,null)", [H("6"), T1]);
    await q("select public.citizen_login_succeeded($1)", [H("7")]);
    expect((await q("select email_hash from citizen_login_guards")).map((r) => r.email_hash)).toEqual([H("6")]);
  });

  it("quota de courriels : 5 par heure et par adresse, renouvelé après une heure", async () => {
    const r: boolean[] = [];
    for (let i = 0; i < 6; i++) r.push(await one<boolean>("public.citizen_mail_allowed($1)", [H("5")]));
    expect(r).toEqual([true, true, true, true, true, false]);
    expect(await one<boolean>("public.citizen_mail_allowed($1)", [H("4")])).toBe(true);
    await db.exec("update citizen_mail_quota set window_start = now() - interval '61 minutes' where email_hash = '" + H("5") + "'");
    expect(await one<boolean>("public.citizen_mail_allowed($1)", [H("5")])).toBe(true);
  });

  it("mot de passe changé : les autres sessions sont fermées, la courante gardée, le verrou levé", async () => {
    await account(A, H("a"));
    await open(H("1"), A);
    await open(H("2"), A);
    await db.exec(`insert into citizen_login_guards(email_hash, attempts, locked_until) values ('${H("a")}', 0, now() + interval '10 minutes')`);
    expect(await one<number>("public.citizen_password_changed($1,$2,null,null,$3)", [A, T1, H("2")])).toBe(1);
    expect((await q("select count(*)::int n from citizen_login_guards"))[0].n).toBe(0);
    expect((await q("select count(*)::int n from citizen_sessions where ended_at is null"))[0].n).toBe(1);
    expect((await q("select event from citizen_auth_events where event = 'password_changed'")).length).toBe(1);
  });

  it("t10 : désactiver un compte ferme toutes ses sessions, une seule fois, et seulement pour ce motif", async () => {
    await account(A, H("a"));
    await account(B, H("b"));
    await open(H("1"), A);
    await open(H("2"), A);
    await open(H("3"), B);
    await db.exec(`update citizen_accounts set last_seen_at = now() where id = '${A}'`); // pas un changement de statut
    expect((await q("select count(*)::int n from citizen_sessions where ended_at is null"))[0].n).toBe(3);
    await db.exec(`update citizen_accounts set status = 'disabled' where id = '${A}'`);
    expect((await q("select account_id, count(*)::int n from citizen_sessions where ended_at is null group by 1")).map((r) => [r.account_id, r.n])).toEqual([[B, 1]]);
    const revoked = (await q("select count(*)::int n from citizen_auth_events where event = 'session_revoked'"))[0].n;
    await db.exec(`update citizen_accounts set status = 'disabled' where id = '${A}'`); // déjà désactivé : rien de plus
    expect((await q("select count(*)::int n from citizen_auth_events where event = 'session_revoked'"))[0].n).toBe(revoked);
    await expect(db.exec(`update citizen_accounts set status = 'banni' where id = '${A}'`)).rejects.toThrow();
  });

  it("TOTP : activation sur secret en attente (15 min), pas de rejeu, retrait", async () => {
    await account(A, H("a"));
    expect(await one<boolean>("public.citizen_totp_enable($1,100,$2,null,null)", [A, T1])).toBe(false); // rien en attente
    await q("select public.citizen_totp_set_pending($1,'enc-1')", [A]);
    await db.exec("update citizen_totp set pending_at = now() - interval '16 minutes'");
    expect(await one<boolean>("public.citizen_totp_enable($1,100,$2,null,null)", [A, T1])).toBe(false); // expiré
    await q("select public.citizen_totp_set_pending($1,'enc-2')", [A]);
    expect(await one<boolean>("public.citizen_totp_enable($1,100,$2,null,null)", [A, T1])).toBe(true);
    expect((await q("select secret_enc, pending_enc from public.citizen_totp_get($1)", [A]))[0]).toMatchObject({ secret_enc: "enc-2", pending_enc: null });
    expect(await one<boolean>("public.citizen_totp_use_step($1,100)", [A])).toBe(false);
    expect(await one<boolean>("public.citizen_totp_use_step($1,99)", [A])).toBe(false); // jamais en arrière
    expect(await one<boolean>("public.citizen_totp_use_step($1,101)", [A])).toBe(true);
    expect((await q("select * from public.citizen_account_for_login($1)", [A]))[0].totp_enabled).toBe(true);
    expect(await one<boolean>("public.citizen_totp_disable($1,$2,null,null)", [A, T1])).toBe(true);
    expect(await one<boolean>("public.citizen_totp_disable($1,$2,null,null)", [A, T1])).toBe(false);
  });

  it("TOTP : un changement d'appareil garde l'ancien secret actif jusqu'à confirmation", async () => {
    await account(A, H("a"));
    await q("select public.citizen_totp_set_pending($1,'enc-old')", [A]);
    await q("select public.citizen_totp_enable($1,1,$2,null,null)", [A, T1]);
    await q("select public.citizen_totp_set_pending($1,'enc-new')", [A]);
    expect((await q("select secret_enc, pending_enc from public.citizen_totp_get($1)", [A]))[0]).toMatchObject({ secret_enc: "enc-old", pending_enc: "enc-new" });
  });

  it("suppression d'un compte (auth.users) : tout part en cascade, le journal reste", async () => {
    await account(A, H("a"));
    await open(H("1"), A);
    await q("select public.citizen_totp_set_pending($1,'enc')", [A]);
    await db.exec(`delete from auth.users where id = '${A}'`);
    for (const t of ["citizen_accounts", "citizen_spaces", "citizen_sessions", "citizen_totp", "citizen_cgu_acceptances"]) {
      expect((await q(`select count(*)::int n from ${t}`))[0].n, t).toBe(0);
    }
    expect((await q("select count(*)::int n from citizen_auth_events"))[0].n).toBeGreaterThan(0);
  });

  it("purge : sessions closes depuis 30 jours, journal de plus d'un an, gardes et quotas périmés", async () => {
    await account(A, H("a"));
    await open(H("1"), A);
    await open(H("2"), A);
    await db.exec("update citizen_sessions set ended_at = now() - interval '31 days', end_reason = 'logout' where id_hash = '" + H("1") + "'");
    await db.exec("update citizen_auth_events set occurred_at = now() - interval '13 months' where event = 'account_registered'");
    await db.exec(`insert into citizen_login_guards(email_hash, attempts, window_start) values ('${H("c")}', 1, now() - interval '3 days')`);
    await db.exec(`insert into citizen_mail_quota(email_hash, sent, window_start) values ('${H("d")}', 1, now() - interval '3 days')`);
    const result = await one<Record<string, number>>("public.citizen_purge_auth_data()");
    expect(result).toEqual({ sessions: 1, events: 1, guards: 1, mail_quota: 1 });
    expect((await q("select count(*)::int n from citizen_sessions"))[0].n).toBe(1);
  });
});

describe("fiche de l'espace (frontière de « Mes demandes »)", () => {
  const C1 = "cccccccc-0000-4000-8000-000000000001";
  const C2 = "cccccccc-0000-4000-8000-000000000002";

  beforeEach(async () => {
    await account(A, H("a"), T1);
    await account(B, H("b"), T1);
  });

  it("sans fiche : null ; posée une seule fois ; une autre fiche est refusée", async () => {
    expect(await one("public.citizen_space_contact($1,$2)", [A, T1])).toBeNull();
    expect(await one<boolean>("public.citizen_space_set_contact($1,$2,$3,'203.0.113.9','FF')", [A, T1, C1])).toBe(true);
    expect(await one("public.citizen_space_contact($1,$2)", [A, T1])).toBe(C1);
    expect(await one<boolean>("public.citizen_space_set_contact($1,$2,$3,null,null)", [A, T1, C1])).toBe(true); // même fiche : idempotent
    expect(await one<boolean>("public.citizen_space_set_contact($1,$2,$3,null,null)", [A, T1, C2])).toBe(false); // jamais remplacée
    expect(await one("public.citizen_space_contact($1,$2)", [A, T1])).toBe(C1);
    const [e] = await q("select detail from citizen_auth_events where event = 'contact_linked' limit 1");
    expect(e.detail).toEqual({ socle_contact_id: C1 });
  });

  it("une fiche = un seul compte par collectivité : la reprendre pour un autre compte échoue", async () => {
    await q("select public.citizen_space_set_contact($1,$2,$3,null,null)", [A, T1, C1]);
    await expect(q("select public.citizen_space_set_contact($1,$2,$3,null,null)", [B, T1, C1])).rejects.toThrow(/unique|duplicate/i);
    expect(await one("public.citizen_space_contact($1,$2)", [B, T1])).toBeNull();
  });

  it("la même fiche peut exister dans une autre collectivité (identifiants indépendants)", async () => {
    await q("select public.citizen_space_ensure($1,$2)", [B, T2]);
    await q("select public.citizen_space_set_contact($1,$2,$3,null,null)", [A, T1, C1]);
    expect(await one<boolean>("public.citizen_space_set_contact($1,$2,$3,null,null)", [B, T2, C1])).toBe(true);
  });

  it("l'espace d'une collectivité ne livre jamais la fiche d'une autre", async () => {
    await q("select public.citizen_space_ensure($1,$2)", [A, T2]);
    await q("select public.citizen_space_set_contact($1,$2,$3,null,null)", [A, T1, C1]);
    expect(await one("public.citizen_space_contact($1,$2)", [A, T2])).toBeNull();
    expect(await one("public.citizen_space_contact($1,'aaaaaaaa-0000-4000-8000-0000000000ff')", [A])).toBeNull();
    expect(await one("public.citizen_space_contact($1,$2)", [B, T1])).toBeNull();
  });

  it("poser une fiche pour une collectivité sans espace ne fait rien (pas d'espace créé en douce)", async () => {
    expect(await one<boolean>("public.citizen_space_set_contact($1,$2,$3,null,null)", [A, T2, C1])).toBe(false);
    expect((await q("select count(*)::int n from citizen_spaces where tenant_id = $1", [T2]))[0].n).toBe(0);
  });
});
