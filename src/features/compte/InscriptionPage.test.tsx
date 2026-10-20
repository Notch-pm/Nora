// @vitest-environment jsdom
/**
 * L'inscription (`/compte/inscription`) : adresse + CGU, rien d'autre ; l'écran
 * de fin est le MÊME pour toute adresse (jamais « déjà inscrite » ni
 * « acceptée »), les erreurs sont reliées aux champs.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";

vi.mock("./AccountFrame.tsx", async (original) => (await import("@/test/plainFrame.tsx")).withPlainFrame(await original<object>()));
vi.mock("@/services/portal/accountClient.ts", async (original) => ({
  ...(await original<typeof import("@/services/portal/accountClient.ts")>()),
  registerAccount: vi.fn(),
}));

import { registerAccount } from "@/services/portal/accountClient.ts";
import { InscriptionPage } from "./InscriptionPage.tsx";

const fr = (key: Parameters<typeof t>[1]) => t("fr", key);
const emailInput = () => screen.getByLabelText(new RegExp(fr("compte.email")));
const cgu = () => document.getElementById("inscription-cgu") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: fr("compte.register.submit") });

const mount = () => render(<MemoryRouter><InscriptionPage /></MemoryRouter>);

beforeEach(() => vi.mocked(registerAccount).mockReset());
afterEach(cleanup);

describe("InscriptionPage", () => {
  it("ne demande ni mot de passe ni identité : adresse et CGU seulement", () => {
    mount();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(document.querySelectorAll("input:not([type=checkbox])")).toHaveLength(1);
    expect(screen.getByText(fr("compte.register.identityLater"))).toBeTruthy();
  });

  it("CGU non cochées ou adresse invalide : rien n'est envoyé, erreurs reliées aux champs", async () => {
    const { container } = mount();
    const user = userEvent.setup({ delay: null });
    await user.click(submit());
    expect(registerAccount).not.toHaveBeenCalled();
    expect(screen.getAllByText(fr("compte.required.email")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(fr("compte.required.cgu")).length).toBeGreaterThan(0);
    expect(cgu().getAttribute("aria-invalid")).toBe("true");
    await user.type(emailInput(), "a@b");
    await user.click(submit());
    expect(registerAccount).not.toHaveBeenCalled();
    expect(await a11yViolations(container)).toEqual([]);
  });

  it("les CGU s'ouvrent dans un nouvel onglet SANS donner accès à la page d'origine, et le dit", () => {
    mount();
    const link = screen.getByRole("link", { name: new RegExp(fr("compte.register.cguLink")) });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link.textContent).toContain(fr("compte.newTab"));
  });

  it("envoi : adresse nettoyée, CGU acceptées ; l'écran de fin ne dit rien de l'existence du compte", async () => {
    vi.mocked(registerAccount).mockResolvedValue({ ok: true, value: null });
    mount();
    const user = userEvent.setup({ delay: null });
    await user.type(emailInput(), "  Camille@Example.org ");
    await user.click(cgu());
    await user.click(submit());
    expect(registerAccount).toHaveBeenCalledWith({ email: "Camille@Example.org", cguAccepted: true });
    expect(await screen.findByText(fr("compte.register.sent"))).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/déjà|existe|nouveau compte créé|adresse acceptée/i);
  });

  it("l'écran de fin est identique que l'adresse ait un compte ou non (le client ne distingue pas)", async () => {
    const render1 = async () => {
      vi.mocked(registerAccount).mockResolvedValue({ ok: true, value: null });
      const view = mount();
      const user = userEvent.setup({ delay: null });
      await user.type(emailInput(), "x@example.org");
      await user.click(cgu());
      await user.click(submit());
      await screen.findByText(fr("compte.register.sent"));
      const html = view.container.innerHTML;
      cleanup();
      return html;
    };
    expect(await render1()).toBe(await render1());
  });

  it.each([
    ["too_many_emails", "compte.error.tooManyEmails"],
    ["mail_unavailable", "compte.error.mailUnavailable"],
    ["challenge_required", "compte.error.challenge"],
    ["network", "compte.error.network"],
    ["account_unavailable", "compte.error.unavailable"],
  ] as const)("échec %s : message dédié en alerte, la saisie est conservée pour réessayer", async (reason, key) => {
    vi.mocked(registerAccount).mockResolvedValue({ ok: false, reason });
    mount();
    const user = userEvent.setup({ delay: null });
    await user.type(emailInput(), "x@example.org");
    await user.click(cgu());
    await user.click(submit());
    expect((await screen.findByRole("alert")).textContent).toContain(fr(key));
    expect((emailInput() as HTMLInputElement).value).toBe("x@example.org");
    expect(cgu().checked).toBe(true);
  });

  it("un seul envoi à la fois", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof registerAccount>>) => void;
    vi.mocked(registerAccount).mockReturnValue(new Promise((r) => (resolve = r)));
    mount();
    const user = userEvent.setup({ delay: null });
    await user.type(emailInput(), "x@example.org");
    await user.click(cgu());
    await user.click(submit());
    await user.click(screen.getByRole("button", { name: fr("compte.submitting") }));
    expect(registerAccount).toHaveBeenCalledTimes(1);
    resolve({ ok: true, value: null });
  });
});
