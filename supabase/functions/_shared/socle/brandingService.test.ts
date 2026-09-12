import { describe, expect, it } from "vitest";
import { color, getBranding, logoUrl, toBranding } from "./brandingService.ts";
import type { SocleClient, SocleReply } from "./socleClient.ts";

const replying = (reply: SocleReply): SocleClient => ({ get: async () => reply });

const SOCLE_BRANDING = {
  organization_id: "org-1",
  source_organization_id: "org-1",
  inherited: false,
  configured: true,
  logo_url: "https://cdn.example/accm.png",
  logo_white_url: null,
  favicon_url: "https://cdn.example/favicon.png",
  primary_color: "#1F8A5B",
  secondary_color: "#ffcd57",
};

describe("color — une couleur est une valeur CSS, elle n'entre que bien formée", () => {
  it("accepte #rrggbb, quelle que soit la casse, et normalise en minuscules", () => {
    expect(color("#1F8A5B")).toBe("#1f8a5b");
    expect(color("  #ffcd57 ")).toBe("#ffcd57");
  });

  it("écarte tout ce qui n'est pas une couleur, sans essayer de la réparer", () => {
    for (const raw of ["#fff", "1f8a5b", "red", "#1f8a5b; background:url(x)", "hsl(1 2% 3%)", null, 42]) {
      expect(color(raw), String(raw)).toBeNull();
    }
  });
});

describe("logoUrl — un logo n'entre qu'en https", () => {
  it("accepte une URL https absolue", () => {
    expect(logoUrl("https://cdn.example/logo.svg")).toBe("https://cdn.example/logo.svg");
  });

  it("écarte http, les chemins relatifs et les schémas exotiques", () => {
    for (const raw of ["http://cdn.example/logo.png", "/logo.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "", null]) {
      expect(logoUrl(raw), String(raw)).toBeNull();
    }
  });
});

describe("toBranding", () => {
  it("traduit champ par champ, chaque champ pouvant manquer", () => {
    expect(toBranding(SOCLE_BRANDING)).toEqual({
      logoUrl: "https://cdn.example/accm.png",
      logoWhiteUrl: null,
      faviconUrl: "https://cdn.example/favicon.png",
      primaryColor: "#1f8a5b",
      secondaryColor: "#ffcd57",
    });
  });

  it("rend null quand rien n'est configuré, ou rien d'exploitable", () => {
    expect(toBranding({ ...SOCLE_BRANDING, configured: false })).toBeNull();
    expect(toBranding({ configured: true, logo_url: "http://clair.example/l.png", primary_color: "rouge" })).toBeNull();
    expect(toBranding(null)).toBeNull();
  });
});

describe("getBranding — la charte est décorative", () => {
  it("rend la charte quand le Socle la sert", async () => {
    const result = await getBranding("org-1", replying({ kind: "ok", body: SOCLE_BRANDING }));
    expect(result).toEqual({ ok: true, branding: toBranding(SOCLE_BRANDING) });
  });

  it("dégrade en défauts plutôt qu'en erreur quand elle manque ou que le Socle ne répond pas", async () => {
    for (const kind of ["not_found", "unreachable", "unexpected"] as const) {
      expect(await getBranding("org-1", replying({ kind })), kind).toEqual({ ok: true, branding: null });
    }
  });

  it("remonte seulement un refus de la clé — une panne de configuration", async () => {
    expect(await getBranding("org-1", replying({ kind: "auth_failed" }))).toEqual({
      ok: false,
      reason: "socle_misconfigured",
    });
  });

  it("demande la charte de la collectivité résolue", async () => {
    const asked: string[] = [];
    await getBranding("org-1", { get: async (p) => { asked.push(p); return { kind: "not_found" }; } });
    expect(asked).toEqual(["/v1/organizations/org-1/branding"]);
  });
});
