// @vitest-environment jsdom
/**
 * Le lien reçu par courriel (`/compte/confirmer#jeton=…`) et le mot de passe
 * oublié : le jeton vit dans le FRAGMENT, est effacé de l'adresse avant tout
 * appel, ne s'affiche jamais, ne sert qu'une fois ; aucun appel tant qu'un mot
 * de passe accepté n'est pas validé ; la réponse « mot de passe oublié » est
 * la même pour toute adresse.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";

vi.mock("./AccountFrame.tsx", async (original) => (await import("@/test/plainFrame.tsx")).withPlainFrame(await original<object>()));
vi.mock("@/services/portal/accountClient.ts", async (original) => ({
  ...(await original<typeof import("@/services/portal/accountClient.ts")>()),
  confirmAccount: vi.fn(),
  resendConfirmation: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

import { confirmAccount, requestPasswordReset, resendConfirmation } from "@/services/portal/accountClient.ts";
import { ConfirmerPage } from "./ConfirmerPage.tsx";
import { MotDePasseOubliePage } from "./MotDePasseOubliePage.tsx";

const fr = (key: Parameters<typeof t>[1]) => t("fr", key);
const GOOD = "Un-Mot-De-Passe-12!";
const TOKEN = "JETON-SECRET-DU-LIEN-0123456789";

const mountConfirmer = (hash = `#jeton=${TOKEN}`) => {
  window.history.replaceState(null, "", "/compte/confirmer" + hash);
  return render(<MemoryRouter><ConfirmerPage /></MemoryRouter>);
};
const pw = () => document.getElementById("confirmer-password") as HTMLInputElement;
const pwc = () => document.getElementById("confirmer-confirmation") as HTMLInputElement;
const submit = () => screen.getByRole("button", { name: fr("compte.confirm.submit") });

beforeEach(() => {
  vi.mocked(confirmAccount).mockReset();
  vi.mocked(resendConfirmation).mockReset();
  vi.mocked(requestPasswordReset).mockReset();
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("ConfirmerPage — le jeton du lien", () => {
  it("le fragment est effacé de la barre d'adresse dès l'arrivée, et le jeton n'est écrit nulle part dans la page", async () => {
    mountConfirmer();
    await screen.findByRole("heading", { name: fr("compte.confirm.title") });
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(TOKEN);
  });

  it("sans jeton (lien tronqué, adresse tapée à la main) : lien invalide, aucune saisie de mot de passe, renvoi possible", async () => {
    mountConfirmer("");
    expect(await screen.findByText(fr("compte.confirm.invalid"))).toBeTruthy();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(screen.getByLabelText(new RegExp(fr("compte.email")))).toBeTruthy();
    expect(confirmAccount).not.toHaveBeenCalled();
  });

  it.each(["#jeton=", "#jeton=%20%20", "#autre=1", "#"])("fragment %j : traité comme absent", async (hash) => {
    mountConfirmer(hash);
    expect(await screen.findByText(fr("compte.confirm.invalid"))).toBeTruthy();
  });

  it("aucun appel tant que le mot de passe n'est pas accepté : règles non tenues, confirmation différente", async () => {
    mountConfirmer();
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole("button", { name: fr("compte.confirm.submit") }));
    await user.type(pw(), "court");
    await user.type(pwc(), "autre");
    await user.click(submit());
    expect(confirmAccount).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").length + document.querySelectorAll("[aria-invalid=true]").length).toBeGreaterThan(0);
    // Le jeton n'a pas été consommé : un mot de passe corrigé part ensuite.
    vi.mocked(confirmAccount).mockResolvedValue({ ok: true, value: null });
    await user.clear(pw());
    await user.clear(pwc());
    await user.type(pw(), GOOD);
    await user.type(pwc(), GOOD);
    await user.click(submit());
    await waitFor(() => expect(confirmAccount).toHaveBeenCalledWith(TOKEN, GOOD));
    expect(await screen.findByText(fr("compte.confirm.done"))).toBeTruthy();
  });

  it("le mot de passe est vidé des champs dès l'envoi", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof confirmAccount>>) => void;
    vi.mocked(confirmAccount).mockReturnValue(new Promise((r) => (resolve = r)));
    mountConfirmer();
    const user = userEvent.setup({ delay: null });
    await screen.findByRole("heading", { name: fr("compte.confirm.title") });
    await user.type(pw(), GOOD);
    await user.type(pwc(), GOOD);
    await user.click(submit());
    expect(pw().value).toBe("");
    expect(pwc().value).toBe("");
    resolve({ ok: false, reason: "account_unavailable" });
  });

  it("lien déjà utilisé ou expiré (link_invalid) : bascule en « lien invalide » ; le jeton est oublié", async () => {
    vi.mocked(confirmAccount).mockResolvedValue({ ok: false, reason: "link_invalid" });
    mountConfirmer();
    const user = userEvent.setup({ delay: null });
    await screen.findByRole("heading", { name: fr("compte.confirm.title") });
    await user.type(pw(), GOOD);
    await user.type(pwc(), GOOD);
    await user.click(submit());
    expect(await screen.findByText(fr("compte.confirm.invalid"))).toBeTruthy();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it("panne (autre que lien invalide) : le jeton reste en mémoire, l'usager peut réessayer sans redemander un lien", async () => {
    vi.mocked(confirmAccount).mockResolvedValueOnce({ ok: false, reason: "account_unavailable" }).mockResolvedValueOnce({ ok: true, value: null });
    mountConfirmer();
    const user = userEvent.setup({ delay: null });
    await screen.findByRole("heading", { name: fr("compte.confirm.title") });
    await user.type(pw(), GOOD);
    await user.type(pwc(), GOOD);
    await user.click(submit());
    expect((await screen.findByRole("alert")).textContent).toContain(fr("compte.error.unavailable"));
    await user.type(pw(), GOOD);
    await user.type(pwc(), GOOD);
    await user.click(submit());
    await waitFor(() => expect(confirmAccount).toHaveBeenLastCalledWith(TOKEN, GOOD));
    expect(await screen.findByText(fr("compte.confirm.done"))).toBeTruthy();
  });

  it("le renvoi du lien : la même confirmation pour toute adresse bien formée", async () => {
    vi.mocked(resendConfirmation).mockResolvedValue({ ok: true, value: null });
    mountConfirmer("");
    const user = userEvent.setup({ delay: null });
    await user.type(await screen.findByLabelText(new RegExp(fr("compte.email"))), "n-importe-qui@example.org");
    await user.click(screen.getByRole("button", { name: fr("compte.resend.submit") }));
    expect(await screen.findByText(fr("compte.resend.sent"))).toBeTruthy();
  });

  it("accessibilité de base", async () => {
    const { container } = mountConfirmer();
    await screen.findByRole("heading", { name: fr("compte.confirm.title") });
    expect(await a11yViolations(container)).toEqual([]);
  });
});

describe("MotDePasseOubliePage", () => {
  const mount = () => render(<MemoryRouter><MotDePasseOubliePage /></MemoryRouter>);
  const emailInput = () => screen.getByLabelText(new RegExp(fr("compte.email")));

  it("adresse vide ou mal formée : rien n'est envoyé", async () => {
    mount();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: fr("compte.forgot.submit") }));
    await user.type(emailInput(), "pas-une-adresse");
    await user.click(screen.getByRole("button", { name: fr("compte.forgot.submit") }));
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it("la même phrase de fin quelle que soit l'adresse — jamais « aucun compte » ni « lien envoyé à »", async () => {
    const run = async (address: string) => {
      vi.mocked(requestPasswordReset).mockResolvedValue({ ok: true, value: null });
      const view = mount();
      const user = userEvent.setup({ delay: null });
      await user.type(emailInput(), address);
      await user.click(screen.getByRole("button", { name: fr("compte.forgot.submit") }));
      await screen.findByText(fr("compte.forgot.sent"));
      const html = view.container.innerHTML;
      cleanup();
      return html;
    };
    const known = await run("titulaire@example.org");
    const unknown = await run("inconnu@example.org");
    expect(known.replace("titulaire@example.org", "X")).toBe(unknown.replace("inconnu@example.org", "X"));
    expect(known).not.toMatch(/aucun compte|n'existe pas|introuvable/i);
  });

  it("trop de courriels envoyés : le dit (limite horaire), sans conséquence pour la suite", async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({ ok: false, reason: "too_many_emails" });
    mount();
    const user = userEvent.setup({ delay: null });
    await user.type(emailInput(), "titulaire@example.org");
    await user.click(screen.getByRole("button", { name: fr("compte.forgot.submit") }));
    expect((await screen.findByRole("alert")).textContent).toContain(fr("compte.error.tooManyEmails"));
  });
});
