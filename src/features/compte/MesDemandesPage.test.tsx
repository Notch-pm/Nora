// @vitest-environment jsdom
/**
 * « Mes demandes » (`/compte/demandes`, `/compte/demandes/:id`) : états vide,
 * chargement, erreur, session perdue, profil à compléter, pagination, détail ;
 * et ce que l'écran ne montre JAMAIS (HTML venu d'un message, champs internes).
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SuiviDemande } from "@fn/_shared/domain/suivi.ts";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";
import { LocationProbe } from "@/test/location.tsx";

vi.mock("./AccountFrame.tsx", async (original) => (await import("@/test/plainFrame.tsx")).withPlainFrame(await original<object>()));
vi.mock("./sessionKind.ts", () => ({ useSessionKind: () => "account", forgetSessionKind: vi.fn() }));
vi.mock("@/services/portal/mesDemandesClient.ts", async (original) => ({
  ...(await original<typeof import("@/services/portal/mesDemandesClient.ts")>()),
  fetchMesDemandes: vi.fn(),
  fetchMaDemande: vi.fn(),
}));

import { fetchMaDemande, fetchMesDemandes } from "@/services/portal/mesDemandesClient.ts";
import { forgetSessionKind } from "./sessionKind.ts";
import { MaDemandePage, MesDemandesPage } from "./MesDemandesPage.tsx";

const fr = (key: Parameters<typeof t>[1]) => t("fr", key);

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

const resume = (id: string, reference: string, extra: Record<string, unknown> = {}) => ({
  id,
  reference,
  subject: "Signaler un problème de voirie",
  demarcheName: "Voirie",
  status: "en_cours" as const,
  receivedAt: "2026-10-01T08:00:00.000Z",
  updatedAt: "2026-10-02T08:00:00.000Z",
  closedAt: null,
  ...extra,
});

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/compte/demandes" element={<MesDemandesPage />} />
        <Route path="/compte/demandes/:id" element={<MaDemandePage />} />
        <Route path="/compte/connexion" element={<p>page de connexion</p>} />
        <Route path="/compte" element={<p>mon compte</p>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchMesDemandes).mockReset();
  vi.mocked(fetchMaDemande).mockReset();
  vi.mocked(forgetSessionKind).mockReset();
});
afterEach(cleanup);

describe("liste", () => {
  it("chargement : un statut annoncé, pas une liste vide", async () => {
    vi.mocked(fetchMesDemandes).mockReturnValue(new Promise(() => {}));
    renderAt("/compte/demandes");
    expect(screen.getByRole("status").textContent).toBe(fr("page.loading"));
    expect(screen.queryByText(fr("compte.demandes.empty"))).toBeNull();
  });

  it("aucune demande : le dit, sans liste", async () => {
    vi.mocked(fetchMesDemandes).mockResolvedValue({ ok: true, value: { demandes: [], suivante: null, profilRequis: false } });
    renderAt("/compte/demandes");
    expect(await screen.findByText(fr("compte.demandes.empty"))).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("profil à compléter : invite à remplir « Mes informations » (et ne prétend pas qu'il n'y a rien)", async () => {
    vi.mocked(fetchMesDemandes).mockResolvedValue({ ok: true, value: { demandes: [], suivante: null, profilRequis: true } });
    renderAt("/compte/demandes");
    expect(await screen.findByText(fr("compte.demandes.profilRequis"))).toBeTruthy();
    expect(screen.queryByText(fr("compte.demandes.empty"))).toBeNull();
    expect(screen.getByRole("link", { name: fr("compte.demandes.profilLink") }).getAttribute("href")).toBe("/compte");
  });

  it("une ligne par demande, avec référence-lien, statut lisible et dates", async () => {
    vi.mocked(fetchMesDemandes).mockResolvedValue({
      ok: true,
      value: { demandes: [resume(ID_A, "DEM-2026-000001"), resume(ID_B, "DEM-2026-000002", { status: "traitee", closedAt: "2026-10-03T08:00:00.000Z" })], suivante: null, profilRequis: false },
    });
    const { container } = renderAt("/compte/demandes");
    const link = await screen.findByRole("link", { name: "DEM-2026-000001" });
    expect(link.getAttribute("href")).toBe("/compte/demandes/" + ID_A);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(fr("suivi.status.traitee"))).toBeTruthy();
    expect(await a11yViolations(container)).toEqual([]);
  });

  it("n'affiche que ce que le client rend : un champ interne glissé dans les données n'apparaît pas", async () => {
    const hostile = { ...resume(ID_A, "DEM-2026-000001"), closure_motif: "MOTIF INTERNE", assignedTo: "Agent Martin", internal_notes: ["NOTE INTERNE"] };
    vi.mocked(fetchMesDemandes).mockResolvedValue({ ok: true, value: { demandes: [hostile], suivante: null, profilRequis: false } });
    renderAt("/compte/demandes");
    await screen.findByRole("link", { name: "DEM-2026-000001" });
    expect(document.body.textContent).not.toMatch(/MOTIF INTERNE|Agent Martin|NOTE INTERNE/);
  });

  it("pagination : « Afficher plus » ajoute la suite sans doublon, et le curseur est celui du serveur", async () => {
    vi.mocked(fetchMesDemandes)
      .mockResolvedValueOnce({ ok: true, value: { demandes: [resume(ID_A, "DEM-2026-000001")], suivante: "CURSEUR-1", profilRequis: false } })
      .mockResolvedValueOnce({ ok: true, value: { demandes: [resume(ID_A, "DEM-2026-000001"), resume(ID_B, "DEM-2026-000002")], suivante: null, profilRequis: false } });
    renderAt("/compte/demandes");
    await userEvent.setup({ delay: null }).click(await screen.findByRole("button", { name: fr("compte.demandes.more") }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(fetchMesDemandes).toHaveBeenLastCalledWith("CURSEUR-1");
    expect(screen.queryByRole("button", { name: fr("compte.demandes.more") })).toBeNull();
  });

  it("session perdue : retour à la connexion, la mémoire de session est oubliée", async () => {
    vi.mocked(fetchMesDemandes).mockResolvedValue({ ok: false, reason: "session_required" });
    renderAt("/compte/demandes");
    expect(await screen.findByText("page de connexion")).toBeTruthy();
    expect(forgetSessionKind).toHaveBeenCalled();
  });

  it("panne : alerte, et « Réessayer » relance la lecture", async () => {
    vi.mocked(fetchMesDemandes)
      .mockResolvedValueOnce({ ok: false, reason: "suivi_unavailable" })
      .mockResolvedValueOnce({ ok: true, value: { demandes: [resume(ID_A, "DEM-2026-000001")], suivante: null, profilRequis: false } });
    renderAt("/compte/demandes");
    expect((await screen.findByRole("alert")).textContent).toContain(fr("suivi.error.unavailable"));
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: fr("page.retry") }));
    expect(await screen.findByRole("link", { name: "DEM-2026-000001" })).toBeTruthy();
  });

  it("réseau coupé : message réseau, nouvel essai possible", async () => {
    vi.mocked(fetchMesDemandes).mockResolvedValue({ ok: false, reason: "network" });
    renderAt("/compte/demandes");
    expect((await screen.findByRole("alert")).textContent).toContain(fr("suivi.error.network"));
    expect(screen.getByRole("button", { name: fr("page.retry") })).toBeTruthy();
  });
});

describe("détail", () => {
  const demande = (extra: Partial<SuiviDemande> = {}): SuiviDemande => ({
    reference: "DEM-2026-000001",
    subject: "Signaler un problème de voirie",
    demarcheName: "Voirie",
    status: "en_cours",
    receivedAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-02T08:00:00.000Z",
    closedAt: null,
    closureText: null,
    pieces: [{ id: ID_B, fileName: "justificatif.pdf", mimeType: "application/pdf", size: 2048 }],
    messages: [],
    ...extra,
  });

  it("montre la demande, ses pièces (liens signés par le serveur) et un retour vers la liste", async () => {
    vi.mocked(fetchMaDemande).mockResolvedValue({ ok: true, value: demande() });
    const { container } = renderAt("/compte/demandes/" + ID_A);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "justificatif.pdf" }).getAttribute("href"))
      .toBe(`/api/v1/compte/demandes/${ID_A}/pieces/${ID_B}`);
    expect(screen.getByRole("link", { name: fr("compte.demandes.back") }).getAttribute("href")).toBe("/compte/demandes");
    expect(screen.queryByRole("button", { name: fr("suivi.quit") })).toBeNull(); // le compte reste ouvert
    expect(fetchMaDemande).toHaveBeenCalledWith(ID_A);
    expect(await a11yViolations(container)).toEqual([]);
  });

  it("le corps d'un message est du TEXTE : aucun HTML, aucun script n'est interprété", async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><a href="javascript:alert(1)">cliquez</a>';
    vi.mocked(fetchMaDemande).mockResolvedValue({
      ok: true,
      value: demande({
        closureText: evil,
        messages: [{ id: "m1", subject: evil, body: evil, sentAt: "2026-10-02T09:00:00.000Z", pieces: [] }],
      }),
    });
    const { container } = renderAt("/compte/demandes/" + ID_A);
    await screen.findByRole("heading", { level: 1 });
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(container.textContent).toContain("<img src=x");
  });

  it("une demande qui n'est pas la sienne : refus générique, aucun détail", async () => {
    vi.mocked(fetchMaDemande).mockResolvedValue({ ok: false, reason: "suivi_refused" });
    renderAt("/compte/demandes/" + ID_B);
    expect((await screen.findByRole("alert")).textContent).toContain(fr("suivi.error.refused"));
    expect(screen.queryByRole("button", { name: fr("page.retry") })).toBeNull(); // un refus ne se « réessaie » pas
  });

  it("session perdue sur le détail : retour à la connexion", async () => {
    vi.mocked(fetchMaDemande).mockResolvedValue({ ok: false, reason: "session_required" });
    renderAt("/compte/demandes/" + ID_A);
    expect(await screen.findByText("page de connexion")).toBeTruthy();
  });

  it("demande en attente de l'usager : le dit, sans promettre une réponse en ligne", async () => {
    vi.mocked(fetchMaDemande).mockResolvedValue({ ok: true, value: demande({ status: "en_attente" }) });
    renderAt("/compte/demandes/" + ID_A);
    expect(await screen.findByText(fr("suivi.waiting"))).toBeTruthy();
  });

  it("messages du plus ancien au plus récent", async () => {
    vi.mocked(fetchMaDemande).mockResolvedValue({
      ok: true,
      value: demande({
        messages: [
          { id: "m2", subject: "Second", body: "b", sentAt: "2026-10-05T09:00:00.000Z", pieces: [] },
          { id: "m1", subject: "Premier", body: "a", sentAt: "2026-10-02T09:00:00.000Z", pieces: [] },
        ],
      }),
    });
    renderAt("/compte/demandes/" + ID_A);
    await screen.findByRole("heading", { level: 1 });
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Premier", "Second"]);
  });
});
