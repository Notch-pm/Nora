import { afterEach, describe, expect, it, vi } from "vitest";
import { contactsApiUrl, createCitizenContacts } from "./citizenContacts.ts";

const TENANT = "8f1e0d3a-0000-4000-8000-0000000000a1";
const ACCOUNT = "11111111-1111-4111-8111-111111111111";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(async () => new Response(body === undefined ? "not json" : JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

const client = () => createCitizenContacts({ baseUrl: "https://socle.test/functions/v1/contacts-api/", apiKey: "sk_key" });

describe("contactsApiUrl", () => {
  it("le réglage explicite passe devant, sans barre finale", () => {
    expect(contactsApiUrl("https://x.test/contacts-api/", "https://socle.test/functions/v1/public-api")).toBe("https://x.test/contacts-api");
  });
  it("sinon contacts-api est déduite de public-api", () => {
    expect(contactsApiUrl(undefined, "https://socle.test/functions/v1/public-api/")).toBe("https://socle.test/functions/v1/contacts-api");
  });
  it("sans rien : null (le profil se dit indisponible)", () => {
    expect(contactsApiUrl(undefined, undefined)).toBeNull();
    expect(contactsApiUrl("", "")).toBeNull();
  });
});

describe("createCitizenContacts — ce que Nora envoie", () => {
  it("lecture : la clé en Bearer, la collectivité en en-tête, le compte dans le chemin, jamais de corps", async () => {
    const mock = stubFetch(200, { contact: { id: "c1" } });
    await client().get(TENANT, ACCOUNT);
    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://socle.test/functions/v1/contacts-api/v1/citizen/contacts/${ACCOUNT}`);
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: "Bearer sk_key", "X-Organization-Id": TENANT });
    expect(init.body).toBeUndefined();
  });

  it("le compte est encodé dans le chemin : aucune remontée possible", async () => {
    const mock = stubFetch(200, { contact: {} });
    await client().get(TENANT, "../../contacts/x?y=1");
    const [url] = mock.mock.calls[0] as unknown as [string];
    expect(url).not.toContain("../");
    expect(url).toContain("..%2F..%2Fcontacts%2Fx%3Fy%3D1");
  });

  it("rattachement, coordonnées et consentement : bonnes routes, bonnes méthodes, corps JSON", async () => {
    const mock = stubFetch(200, { contact: {} });
    const c = client();
    await c.link(TENANT, ACCOUNT, { first_name: "Camille" });
    await c.update(TENANT, ACCOUNT, { mobile_phone: "0612345678" });
    await c.consent(TENANT, ACCOUNT, { kind: "partage", granted: true });
    const calls = mock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => `${init.method} ${url.split("/contacts/")[1].replace(ACCOUNT, "{id}")}`)).toEqual([
      "POST {id}/link",
      "PATCH {id}",
      "POST {id}/consents",
    ]);
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ kind: "partage", granted: true });
    expect((calls[0][1].headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("createCitizenContacts — ce que Nora comprend", () => {
  it("200/201 avec un corps → ok ; 404 → not_found", async () => {
    stubFetch(201, { contact: { id: "c1" }, outcome: "created" });
    expect(await client().link(TENANT, ACCOUNT, {})).toEqual({ kind: "ok", status: 201, body: { contact: { id: "c1" }, outcome: "created" } });
    stubFetch(404, { error: { code: "not_found" } });
    expect(await client().get(TENANT, ACCOUNT)).toEqual({ kind: "not_found" });
  });

  it("400 → refus avec le message du Socle (pour l'écran), jamais une panne", async () => {
    stubFetch(400, { error: { message: "postal_code : 5 chiffres." } });
    expect(await client().link(TENANT, ACCOUNT, {})).toEqual({ kind: "rejected", message: "postal_code : 5 chiffres." });
    stubFetch(400, {});
    expect(await client().link(TENANT, ACCOUNT, {})).toEqual({ kind: "rejected", message: null });
  });

  it("401/403 (scope citizen absent) → indisponible, et le journal le dit sans citer de secret", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [401, 403]) {
      stubFetch(status, {});
      expect(await client().get(TENANT, ACCOUNT)).toEqual({ kind: "unavailable" });
    }
    expect(spy.mock.calls.flat().join(" ")).toContain("scope citizen");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("sk_key");
    spy.mockRestore();
  });

  it("5xx, corps illisible, réponse vide, réseau coupé → indisponible (jamais « pas de fiche »)", async () => {
    stubFetch(500, { error: {} });
    expect(await client().get(TENANT, ACCOUNT)).toEqual({ kind: "unavailable" });
    stubFetch(200, undefined);
    expect(await client().get(TENANT, ACCOUNT)).toEqual({ kind: "unavailable" });
    stubFetch(200, null);
    expect(await client().get(TENANT, ACCOUNT)).toEqual({ kind: "unavailable" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await client().get(TENANT, ACCOUNT)).toEqual({ kind: "unavailable" });
  });
});
