// @vitest-environment jsdom
/**
 * La connexion (`/compte/connexion`) : validation avant tout envoi, refus
 * génériques, second facteur, `?retour=` (anti redirection ouverte), mot de
 * passe jamais conservé, accessibilité de base.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";
import { LocationProbe } from "@/test/location.tsx";

vi.mock("./AccountFrame.tsx", async (original) => (await import("@/test/plainFrame.tsx")).withPlainFrame(await original<object>()));
vi.mock("./sessionKind.ts", () => ({ useSessionKind: () => null, forgetSessionKind: vi.fn() }));
vi.mock("@/services/portal/accountClient.ts", async (original) => ({
  ...(await original<typeof import("@/services/portal/accountClient.ts")>()),
  login: vi.fn(),
  loginTotp: vi.fn(),
  resendConfirmation: vi.fn(),
}));

import { login, loginTotp, resendConfirmation } from "@/services/portal/accountClient.ts";
import { ConnexionPage } from "./ConnexionPage.tsx";

const fr = (key: Parameters<typeof t>[1]) => t("fr", key);

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/compte/connexion" element={<ConnexionPage />} />
        <Route path="*" element={<p>ailleurs</p>} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const here = () => screen.getByTestId("location").textContent;
const passwordInput = () => document.getElementById("connexion-password") as HTMLInputElement;
const emailInput = () => screen.getByLabelText(new RegExp(fr("compte.email")));

async function fill(email: string, password: string) {
  const user = userEvent.setup({ delay: null });
  await user.type(emailInput(), email);
  await user.type(passwordInput(), password);
  await user.click(screen.getByRole("button", { name: fr("compte.login.submit") }));
  return user;
}

beforeEach(() => {
  vi.mocked(login).mockReset();
  vi.mocked(loginTotp).mockReset();
  vi.mocked(resendConfirmation).mockReset();
});
afterEach(cleanup);

describe("ConnexionPage", () => {
  it("n'envoie rien tant que l'adresse ou le mot de passe manque ou est mal formé, et le dit champ par champ", async () => {
    renderAt("/compte/connexion");
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: fr("compte.login.submit") }));
    expect(login).not.toHaveBeenCalled();
    expect(screen.getAllByText(fr("compte.required.email")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(fr("compte.required.password")).length).toBeGreaterThan(0);

    await user.type(emailInput(), "pas-une-adresse");
    await user.type(passwordInput(), "x");
    await user.click(screen.getByRole("button", { name: fr("compte.login.submit") }));
    expect(login).not.toHaveBeenCalled();
    expect(screen.getAllByText(fr("compte.error.emailInvalid")).length).toBeGreaterThan(0);
  });

  it("connexion réussie : va à « Mon compte » par défaut", async () => {
    vi.mocked(login).mockResolvedValue({ ok: true, value: { kind: "session" } });
    renderAt("/compte/connexion");
    await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    await waitFor(() => expect(here()).toBe("/compte"));
    expect(login).toHaveBeenCalledWith({ email: "camille@example.org", password: "Un-Mot-De-Passe-12!", remember: false });
  });

  it("le mot de passe est vidé du champ dès l'envoi et n'entre jamais dans le stockage du navigateur", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof login>>) => void;
    vi.mocked(login).mockReturnValue(new Promise((r) => (resolve = r)));
    renderAt("/compte/connexion");
    await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    expect(passwordInput().value).toBe("");
    resolve({ ok: false, reason: "credentials_invalid" });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    for (const store of [localStorage, sessionStorage]) {
      expect(JSON.stringify({ ...store })).not.toContain("Un-Mot-De-Passe-12!");
    }
  });

  it("le champ du mot de passe est masqué et se complète comme un mot de passe existant", () => {
    renderAt("/compte/connexion");
    expect(passwordInput().type).toBe("password");
    expect(passwordInput().autocomplete).toBe("current-password");
  });

  it("?retour= interne : on y revient après la connexion", async () => {
    vi.mocked(login).mockResolvedValue({ ok: true, value: { kind: "session" } });
    renderAt("/compte/connexion?retour=" + encodeURIComponent("/demarches/abc/formulaire?x=1"));
    await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    await waitFor(() => expect(here()).toBe("/demarches/abc/formulaire?x=1"));
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "evil.example/chemin",
    "/ok\r\nLocation: https://evil.example",
    "/" + "a".repeat(600),
  ])("?retour=%j : refusé, retombe sur « Mon compte » (redirection ouverte)", async (retour) => {
    vi.mocked(login).mockResolvedValue({ ok: true, value: { kind: "session" } });
    renderAt("/compte/connexion?retour=" + encodeURIComponent(retour));
    await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    await waitFor(() => expect(here()).toBe("/compte"));
  });

  it("refus générique : même phrase pour une adresse inconnue et un mauvais mot de passe, annoncée en alerte", async () => {
    vi.mocked(login).mockResolvedValue({ ok: false, reason: "credentials_invalid" });
    renderAt("/compte/connexion");
    await fill("inconnu@example.org", "Mauvais-Mot-De-Passe-1!");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(fr("compte.error.credentials"));
    expect(document.body.textContent).not.toMatch(/n'existe pas|introuvable|aucun compte/i);
    expect(here()).toBe("/compte/connexion");
  });

  it("compte verrouillé : message de verrouillage", async () => {
    vi.mocked(login).mockResolvedValue({ ok: false, reason: "account_locked" });
    renderAt("/compte/connexion");
    await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    expect((await screen.findByRole("alert")).textContent).toContain(fr("compte.error.locked"));
  });

  it("adresse non confirmée : propose de renvoyer le lien", async () => {
    vi.mocked(login).mockResolvedValue({ ok: false, reason: "account_unconfirmed" });
    vi.mocked(resendConfirmation).mockResolvedValue({ ok: true, value: null });
    renderAt("/compte/connexion");
    const user = await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    await user.click(await screen.findByRole("button", { name: fr("compte.login.resend") }));
    expect(resendConfirmation).toHaveBeenCalledWith("camille@example.org");
    expect(await screen.findByText(fr("compte.resend.sent"))).toBeTruthy();
  });

  it("double authentification : 6 chiffres exigés, ticket jamais affiché, retour à la saisie si le ticket expire", async () => {
    vi.mocked(login).mockResolvedValue({ ok: true, value: { kind: "mfa", ticket: "TICKET-SECRET-ABC" } });
    renderAt("/compte/connexion?retour=" + encodeURIComponent("/compte/demandes"));
    const user = await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    expect(await screen.findByRole("heading", { name: fr("compte.login.totpTitle") })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("TICKET-SECRET-ABC");

    const code = document.getElementById("connexion-code") as HTMLInputElement;
    await user.type(code, "12ab");
    await user.click(screen.getByRole("button", { name: fr("compte.login.totpSubmit") }));
    expect(loginTotp).not.toHaveBeenCalled();
    expect(screen.getAllByText(fr("compte.required.code")).length).toBeGreaterThan(0);

    vi.mocked(loginTotp).mockResolvedValueOnce({ ok: false, reason: "mfa_expired" });
    await user.clear(code);
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: fr("compte.login.totpSubmit") }));
    expect(loginTotp).toHaveBeenCalledWith({ ticket: "TICKET-SECRET-ABC", code: "123456" });
    expect(await screen.findByRole("heading", { name: fr("compte.login.title") })).toBeTruthy();
  });

  it("double authentification réussie : va au retour demandé", async () => {
    vi.mocked(login).mockResolvedValue({ ok: true, value: { kind: "mfa", ticket: "T" } });
    vi.mocked(loginTotp).mockResolvedValue({ ok: true, value: null });
    renderAt("/compte/connexion?retour=" + encodeURIComponent("/compte/demandes"));
    const user = await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    await screen.findByRole("heading", { name: fr("compte.login.totpTitle") });
    await user.type(document.getElementById("connexion-code") as HTMLInputElement, "654321");
    await user.click(screen.getByRole("button", { name: fr("compte.login.totpSubmit") }));
    await waitFor(() => expect(here()).toBe("/compte/demandes"));
  });

  it("un seul envoi à la fois : le double clic ne lance pas deux connexions", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof login>>) => void;
    vi.mocked(login).mockReturnValue(new Promise((r) => (resolve = r)));
    renderAt("/compte/connexion");
    const user = userEvent.setup({ delay: null });
    await user.type(emailInput(), "camille@example.org");
    await user.type(passwordInput(), "Un-Mot-De-Passe-12!");
    const submit = screen.getByRole("button", { name: fr("compte.login.submit") });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest("form")!);
    expect(login).toHaveBeenCalledTimes(1);
    resolve({ ok: false, reason: "network" });
  });

  it("accessibilité de base : aucune violation WCAG A/AA détectable, erreurs reliées aux champs", async () => {
    const { container } = renderAt("/compte/connexion");
    expect(await a11yViolations(container)).toEqual([]);
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: fr("compte.login.submit") }));
    expect(await a11yViolations(container)).toEqual([]);
    expect(emailInput().getAttribute("aria-invalid")).toBe("true");
  });

  it("l'étape du code est accessible aussi", async () => {
    vi.mocked(login).mockResolvedValue({ ok: true, value: { kind: "mfa", ticket: "T" } });
    const { container } = renderAt("/compte/connexion");
    await fill("camille@example.org", "Un-Mot-De-Passe-12!");
    await screen.findByRole("heading", { name: fr("compte.login.totpTitle") });
    expect(await a11yViolations(container)).toEqual([]);
  });
});
