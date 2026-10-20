// @vitest-environment jsdom
/**
 * « Mes consentements » : les TROIS états (accordé / refusé / jamais demandé),
 * la date qui tranche, le retrait du traitement qui se confirme, le serveur qui
 * reste juge (la phrase n'est jamais envoyée).
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profil } from "@fn/_shared/domain/profil.ts";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";

vi.mock("@/services/portal/profilClient.ts", async (original) => ({
  ...(await original<typeof import("@/services/portal/profilClient.ts")>()),
  saveConsentement: vi.fn(),
}));

import { saveConsentement } from "@/services/portal/profilClient.ts";
import { ConsentementsSection } from "./ConsentementsSection.tsx";

const fr = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t("fr", key, params);

const profil = (consentements: Profil["consentements"]): Profil => ({
  civilite: "madame",
  prenom: "Camille",
  nom: "Durand",
  nomUsage: null,
  dateNaissance: null,
  courriel: "camille@example.org",
  mobile: null,
  fixe: null,
  adresse1: "12 rue Houdan",
  adresse2: null,
  codePostal: "92330",
  ville: "Sceaux",
  consentements,
});

function mount(p: Profil, extra: { onChanged?: (p: Profil) => void; onSessionLost?: () => void } = {}) {
  const onChanged = extra.onChanged ?? vi.fn();
  const onSessionLost = extra.onSessionLost ?? vi.fn();
  const view = render(<ConsentementsSection profil={p} tenantName="Ville de Sceaux" onChanged={onChanged} onSessionLost={onSessionLost} />);
  return { ...view, onChanged, onSessionLost };
}

const item = (kind: "traitement" | "partage") => {
  const status = document.getElementById("consentement-etat-" + kind)!;
  return within(status.closest("li")!);
};

beforeEach(() => vi.mocked(saveConsentement).mockReset());
afterEach(cleanup);

describe("trois états", () => {
  it("jamais demandé : ni « accordé » ni « refusé », et un seul geste possible, accorder", () => {
    mount(profil({ traitement: null, partage: null }));
    for (const kind of ["traitement", "partage"] as const) {
      expect(document.getElementById("consentement-etat-" + kind)!.textContent).toBe(fr("compte.consents.never"));
      expect(item(kind).getByRole("button").textContent).toContain(fr("compte.consents.grant"));
    }
  });

  it("accordé le jour J : la date est dite, le geste est de retirer", () => {
    mount(profil({ traitement: { accorde: true, le: "2026-10-05T09:00:00.000Z" }, partage: { accorde: true, le: "2026-10-06T09:00:00.000Z" } }));
    expect(document.getElementById("consentement-etat-partage")!.textContent).toMatch(/06\/10\/2026|6 octobre 2026/);
    expect(document.getElementById("consentement-etat-partage")!.textContent).not.toBe(fr("compte.consents.never"));
    expect(item("partage").getByRole("button").textContent).toContain(fr("compte.consents.withdraw"));
  });

  it("refusé : daté lui aussi (un retrait n'efface rien), le geste est d'accorder à nouveau", () => {
    mount(profil({ traitement: null, partage: { accorde: false, le: "2026-10-06T09:00:00.000Z" } }));
    const text = document.getElementById("consentement-etat-partage")!.textContent!;
    expect(text).toMatch(/06\/10\/2026|6 octobre 2026/);
    expect(text).not.toBe(fr("compte.consents.never"));
    expect(item("partage").getByRole("button").textContent).toContain(fr("compte.consents.grant"));
  });

  it("c'est la DATE qui tranche : un refus sans date vaut « jamais demandé »", () => {
    mount(profil({ traitement: null, partage: { accorde: false, le: "" } }));
    expect(document.getElementById("consentement-etat-partage")!.textContent).toBe(fr("compte.consents.never"));
  });

  it("la phrase affichée est celle du dictionnaire, avec le nom de la collectivité", () => {
    mount(profil({ traitement: null, partage: null }));
    expect(document.body.textContent).toContain("Ville de Sceaux");
    expect(document.body.textContent).toContain(fr("consent.traitement.short", { organisme: "Ville de Sceaux" }).slice(0, 15));
  });
});

describe("écritures", () => {
  it("accorder envoie { kind, granted } et rien d'autre, puis reprend le profil rendu par le serveur", async () => {
    const updated = profil({ traitement: null, partage: { accorde: true, le: "2026-10-20T10:00:00.000Z" } });
    vi.mocked(saveConsentement).mockResolvedValue({ ok: true, value: updated });
    const { onChanged } = mount(profil({ traitement: null, partage: null }));
    await userEvent.setup({ delay: null }).click(item("partage").getByRole("button"));
    expect(saveConsentement).toHaveBeenCalledWith("partage", true);
    expect(onChanged).toHaveBeenCalledWith(updated);
    expect(await screen.findByText(fr("compte.consents.doneGranted"))).toBeTruthy();
  });

  it("retirer le partage : immédiat ; retirer le TRAITEMENT : confirmation d'abord", async () => {
    vi.mocked(saveConsentement).mockResolvedValue({ ok: true, value: profil({ traitement: null, partage: null }) });
    const user = userEvent.setup({ delay: null });
    mount(profil({ traitement: { accorde: true, le: "2026-10-05T09:00:00.000Z" }, partage: { accorde: true, le: "2026-10-05T09:00:00.000Z" } }));

    await user.click(item("partage").getByRole("button"));
    expect(saveConsentement).toHaveBeenCalledWith("partage", false);
    vi.mocked(saveConsentement).mockClear();

    await user.click(item("traitement").getByRole("button"));
    expect(saveConsentement).not.toHaveBeenCalled();
    expect(screen.getByText(fr("compte.consents.confirmWithdraw"))).toBeTruthy();
    // Annuler ne retire rien ; confirmer retire.
    await user.click(screen.getByRole("button", { name: fr("compte.profil.cancel") }));
    expect(saveConsentement).not.toHaveBeenCalled();
    await user.click(item("traitement").getByRole("button"));
    await user.click(screen.getByRole("button", { name: fr("compte.consents.confirmYes") }));
    expect(saveConsentement).toHaveBeenCalledWith("traitement", false);
  });

  it("session perdue pendant l'écriture : l'écran en est informé (retour à la connexion)", async () => {
    vi.mocked(saveConsentement).mockResolvedValue({ ok: false, reason: "session_required" });
    const { onSessionLost, onChanged } = mount(profil({ traitement: null, partage: null }));
    await userEvent.setup({ delay: null }).click(item("partage").getByRole("button"));
    await waitFor(() => expect(onSessionLost).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("refus ou panne du Socle : alerte, l'état affiché ne change pas", async () => {
    vi.mocked(saveConsentement).mockResolvedValue({ ok: false, reason: "profil_indisponible" });
    const { onChanged } = mount(profil({ traitement: null, partage: null }));
    await userEvent.setup({ delay: null }).click(item("partage").getByRole("button"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    expect(document.getElementById("consentement-etat-partage")!.textContent).toBe(fr("compte.consents.never"));
  });

  it("un seul envoi à la fois par consentement (bouton désactivé pendant l'écriture)", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof saveConsentement>>) => void;
    vi.mocked(saveConsentement).mockReturnValue(new Promise((r) => (resolve = r)));
    mount(profil({ traitement: null, partage: null }));
    const user = userEvent.setup({ delay: null });
    await user.click(item("partage").getByRole("button"));
    expect((item("partage").getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    await user.click(item("partage").getByRole("button"));
    expect(saveConsentement).toHaveBeenCalledTimes(1);
    resolve({ ok: true, value: profil({ traitement: null, partage: null }) });
  });
});

describe("accessibilité", () => {
  it("aucune violation WCAG A/AA détectable ; chaque bouton nomme son consentement", async () => {
    const { container } = mount(profil({ traitement: { accorde: true, le: "2026-10-05T09:00:00.000Z" }, partage: null }));
    expect(await a11yViolations(container)).toEqual([]);
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(new Set(names).size).toBe(names.length); // deux boutons « Accorder » ne se confondent pas
  });
});
