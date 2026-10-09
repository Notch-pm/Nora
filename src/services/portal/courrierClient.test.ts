/**
 * Le courrier libre côté navigateur : la page (`fetchCourrier`), l'envoi
 * (`sendCourrier`), et l'accueil d'une fonction d'avant le courrier libre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCourrier, fetchPortal, sendCourrier } from "./portalClient.ts";

const TENANT = { id: "org-1", name: "ACCM", slug: "laurentville", hostname: "laurentville.edilumen.fr" };

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => vi.stubEnv("VITE_PORTAL_API_URL", "https://portal-api.example/"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("l'accueil et le courrier libre", () => {
  it("⚠️ une fonction d'avant le courrier libre le laisse FERMÉ", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ lang: "fr", tenant: TENANT, demarches: [] })));
    const result = await fetchPortal("fr");
    expect(result.ok && result.snapshot.freeMail).toEqual({ enabled: false, title: null });
  });
});

describe("fetchCourrier", () => {
  it("demande la page de l'organisme par son slug, et la lit", async () => {
    const fetchImpl = vi.fn(async () =>
      respond({
        lang: "fr",
        tenant: TENANT,
        villes: [],
        organisme: { id: "o1", name: "Mairie d'Arles", slug: "mairie-d-arles", isTenant: false },
        freeMail: { enabled: true, title: "Écrire au maire" },
        branding: null,
        tenantBranding: null,
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const result = await fetchCourrier("mairie-d-arles", "en");
    expect(fetchImpl).toHaveBeenCalledWith("https://portal-api.example/v1/courrier?lang=en&organisme=mairie-d-arles");
    expect(result.ok && result.snapshot.freeMail.title).toBe("Écrire au maire");
  });

  it("un organisme fermé est `courrier_unavailable`", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "courrier_unavailable" } }, 404)));
    expect(await fetchCourrier(null, "fr")).toEqual({ ok: false, reason: "courrier_unavailable" });
  });
});

describe("sendCourrier", () => {
  const envoi = {
    organisme: "mairie-d-arles",
    submissionId: "6f1c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f",
    courrier: {
      subject: "Objet",
      body: "Message",
      senderCategory: "citoyen" as const,
      senderCivilite: "",
      senderFirstName: "Camille",
      senderLastName: "Martin",
      senderEmail: "camille@example.org",
      senderPhone: "",
    },
    consents: [
      { kind: "traitement" as const, granted: true },
      { kind: "partage" as const, granted: true },
    ],
    files: [new File(["x"], "lettre.pdf")],
  };

  it("envoie le courrier ET ses fichiers en un seul multipart, puis lit l'accusé", async () => {
    let sent: FormData | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = init.body as FormData;
        return respond({ receipt: { reference: "COU-1", duplicate: false, organismeName: "Mairie d'Arles" } });
      }),
    );
    const result = await sendCourrier(envoi, null);
    expect(result).toEqual({ ok: true, receipt: { reference: "COU-1", duplicate: false, organismeName: "Mairie d'Arles" } });
    const form = sent as unknown as FormData;
    expect(form.get("organisme")).toBe("mairie-d-arles");
    expect(form.get("sender_last_name")).toBe("Martin");
    expect(JSON.parse(String(form.get("consents")))).toEqual(envoi.consents);
    expect((form.getAll("files") as File[]).map((f) => f.name)).toEqual(["lettre.pdf"]);
    expect(form.has("challenge")).toBe(false);
  });

  it("lit le code d'un refus ; un code inconnu vaut « réessayez »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "too_many_courriers" } }, 429)));
    expect(await sendCourrier(envoi)).toEqual({ ok: false, reason: "too_many_courriers" });
    vi.stubGlobal("fetch", vi.fn(async () => respond({ error: { code: "on_ne_sait_quoi" } }, 500)));
    expect(await sendCourrier(envoi)).toEqual({ ok: false, reason: "clara_unavailable" });
  });
});
