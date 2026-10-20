/**
 * La base du compte citoyen (projet Nora), vue par portal-api : un PORT, et son
 * implémentation par les RPC PostgREST de la migration
 * `20261020090000_espace_usager_comptes.sql` (clé service_role, motif de
 * `session/sessionStore.ts`). Les flux du compte (`accountService.ts`) se
 * testent contre une base en mémoire.
 */
import type { RequestTrace, StoreResult } from "../session/sessionStore.ts";

export interface AccountByEmail {
  accountId: string;
  confirmed: boolean;
  active: boolean;
}

export interface LoginState {
  confirmed: boolean;
  active: boolean;
  totpEnabled: boolean;
}

export interface TotpState {
  secretEnc: string | null;
  pendingEnc: string | null;
  enabled: boolean;
}

export interface AccountStore {
  register(accountId: string, emailHash: string, tenantId: string, cguVersion: string, trace: RequestTrace): Promise<StoreResult<boolean>>;
  byEmail(emailHash: string): Promise<StoreResult<AccountByEmail | null>>;
  confirm(accountId: string, tenantId: string, trace: RequestTrace): Promise<StoreResult<boolean>>;
  forLogin(accountId: string, tenantId: string): Promise<StoreResult<LoginState | null>>;
  loginLocked(emailHash: string): Promise<StoreResult<boolean>>;
  loginFailed(emailHash: string, tenantId: string, trace: RequestTrace): Promise<StoreResult<boolean>>;
  loginSucceeded(emailHash: string): Promise<StoreResult<null>>;
  passwordChanged(accountId: string, tenantId: string, trace: RequestTrace, keepIdHash: string | null): Promise<StoreResult<number>>;
  event(event: string, tenantId: string, accountId: string | null, trace: RequestTrace): Promise<StoreResult<null>>;
  totp(accountId: string): Promise<StoreResult<TotpState>>;
  totpSetPending(accountId: string, pendingEnc: string): Promise<StoreResult<null>>;
  totpEnable(accountId: string, step: number, tenantId: string, trace: RequestTrace): Promise<StoreResult<boolean>>;
  totpUseStep(accountId: string, step: number): Promise<StoreResult<boolean>>;
  totpDisable(accountId: string, tenantId: string, trace: RequestTrace): Promise<StoreResult<boolean>>;
}

export interface AccountStoreConfig {
  url: string;
  serviceKey: string;
  timeoutMs?: number;
}

function first(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>) : null;
}

export function createAccountStore(config: AccountStoreConfig): AccountStore {
  const base = config.url.replace(/\/+$/, "") + "/rest/v1/rpc/";
  const timeoutMs = config.timeoutMs ?? 5_000;

  async function rpc(name: string, args: Record<string, unknown>): Promise<StoreResult<unknown>> {
    let response: Response;
    try {
      response = await fetch(base + name, {
        method: "POST",
        headers: {
          apikey: config.serviceKey,
          Authorization: "Bearer " + config.serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false };
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`portal-api : ${name} a répondu ${response.status}`, detail.slice(0, 300));
      return { ok: false };
    }
    // Une fonction `void` répond 204 ou un corps vide.
    const text = await response.text().catch(() => "");
    try {
      return { ok: true, value: text === "" ? null : JSON.parse(text) };
    } catch {
      return { ok: false };
    }
  }

  const bool = async (name: string, args: Record<string, unknown>): Promise<StoreResult<boolean>> => {
    const r = await rpc(name, args);
    return r.ok ? { ok: true, value: r.value === true } : r;
  };
  const nothing = async (name: string, args: Record<string, unknown>): Promise<StoreResult<null>> => {
    const r = await rpc(name, args);
    return r.ok ? { ok: true, value: null } : r;
  };
  const trace = (t: RequestTrace) => ({ p_ip: t.ip, p_user_agent: t.userAgent });

  return {
    register: (accountId, emailHash, tenantId, cguVersion, t) =>
      bool("citizen_account_register", {
        p_account_id: accountId,
        p_email_hash: emailHash,
        p_tenant_id: tenantId,
        p_cgu_version: cguVersion,
        ...trace(t),
      }),
    async byEmail(emailHash) {
      const r = await rpc("citizen_account_by_email", { p_email_hash: emailHash });
      if (!r.ok) return r;
      const row = first(r.value);
      if (row === null || typeof row.account_id !== "string") return { ok: true, value: null };
      return { ok: true, value: { accountId: row.account_id, confirmed: row.confirmed === true, active: row.active === true } };
    },
    confirm: (accountId, tenantId, t) =>
      bool("citizen_account_confirm", { p_account_id: accountId, p_tenant_id: tenantId, ...trace(t) }),
    async forLogin(accountId, tenantId) {
      const r = await rpc("citizen_account_for_login", { p_account_id: accountId, p_tenant_id: tenantId });
      if (!r.ok) return r;
      const row = first(r.value);
      if (row === null) return { ok: true, value: null };
      return {
        ok: true,
        value: { confirmed: row.confirmed === true, active: row.active === true, totpEnabled: row.totp_enabled === true },
      };
    },
    loginLocked: (emailHash) => bool("citizen_login_locked", { p_email_hash: emailHash }),
    loginFailed: (emailHash, tenantId, t) =>
      bool("citizen_login_failed", { p_email_hash: emailHash, p_tenant_id: tenantId, ...trace(t) }),
    loginSucceeded: (emailHash) => nothing("citizen_login_succeeded", { p_email_hash: emailHash }),
    async passwordChanged(accountId, tenantId, t, keepIdHash) {
      const r = await rpc("citizen_password_changed", {
        p_account_id: accountId,
        p_tenant_id: tenantId,
        p_keep_id_hash: keepIdHash,
        ...trace(t),
      });
      return r.ok ? { ok: true, value: typeof r.value === "number" ? r.value : 0 } : r;
    },
    event: (event, tenantId, accountId, t) =>
      nothing("citizen_event", { p_event: event, p_tenant_id: tenantId, p_account_id: accountId, p_detail: {}, ...trace(t) }),
    async totp(accountId) {
      const r = await rpc("citizen_totp_get", { p_account_id: accountId });
      if (!r.ok) return r;
      const row = first(r.value);
      return {
        ok: true,
        value: {
          secretEnc: typeof row?.secret_enc === "string" ? row.secret_enc : null,
          pendingEnc: typeof row?.pending_enc === "string" ? row.pending_enc : null,
          enabled: typeof row?.enabled_at === "string",
        },
      };
    },
    totpSetPending: (accountId, pendingEnc) =>
      nothing("citizen_totp_set_pending", { p_account_id: accountId, p_pending_enc: pendingEnc }),
    totpEnable: (accountId, step, tenantId, t) =>
      bool("citizen_totp_enable", { p_account_id: accountId, p_step: step, p_tenant_id: tenantId, ...trace(t) }),
    totpUseStep: (accountId, step) => bool("citizen_totp_use_step", { p_account_id: accountId, p_step: step }),
    totpDisable: (accountId, tenantId, t) =>
      bool("citizen_totp_disable", { p_account_id: accountId, p_tenant_id: tenantId, ...trace(t) }),
  };
}
