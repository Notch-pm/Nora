// @vitest-environment jsdom
/**
 * Démarches réservées aux connectés (lot L3c), côté écran : cadenas et
 * infobulle sur la carte (sans connexion), encart « Me connecter » avec retour
 * à la démarche, encart « Compléter mes informations ».
 *
 * L'écran n'est qu'une commodité : la protection est au serveur
 * (`account_required`, vérifié par les tests de flux de portal-api).
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Demarche } from "@fn/_shared/domain/demarche.ts";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";

const session = vi.hoisted(() => ({ kind: null as "account" | "guest" | "anonymous" | null }));
vi.mock("@/features/compte/sessionKind.ts", () => ({
  useSessionKind: () => session.kind,
  forgetSessionKind: vi.fn(),
  useAccountHref: () => ({ href: "/compte/connexion", connected: session.kind === "account" }),
}));

import { DemarcheCard } from "@/features/portal/sections/DemarcheCard.tsx";
import { AccessNotice } from "./AccessNotice.tsx";

const fr = (key: Parameters<typeof t>[1]) => t("fr", key);

const demarche = (accessMode: "libre" | "authentifie"): Demarche => ({
  id: "d1",
  name: "Carte famille",
  description: "Demandez votre carte famille.",
  estimatedMinutes: 5,
  organizations: [],
  audiences: [],
  category: null,
  accessMode,
});

const card = (d: Demarche) => (
  <MemoryRouter initialEntries={["/"]}>
    <ul>
      <DemarcheCard demarche={d} />
    </ul>
  </MemoryRouter>
);

beforeEach(() => {
  session.kind = null;
});
afterEach(cleanup);

describe("carte d'une démarche réservée", () => {
  it("sans connexion : cadenas décoratif et infobulle lue par le lien (aria-describedby)", () => {
    session.kind = "anonymous";
    const { container } = render(card(demarche("authentifie")));
    const link = screen.getByRole("link", { name: "Carte famille" });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe(fr("card.reserved.tip"));
    expect(link.getAttribute("aria-describedby")).toBe(tip.id);
    // Le texte est toujours dans le DOM (replié visuellement) : un lecteur d'écran le lit.
    expect(tip.className).toContain("sr-only");
    expect(container.querySelector('svg[aria-hidden="true"] rect')).not.toBeNull();
  });

  it("l'infobulle s'affiche au survol et au focus, se ferme avec Échap", async () => {
    session.kind = "anonymous";
    render(card(demarche("authentifie")));
    const user = userEvent.setup({ delay: null });
    const tip = screen.getByRole("tooltip");
    await user.hover(screen.getByRole("link", { name: "Carte famille" }));
    expect(tip.className).not.toContain("sr-only");
    await user.keyboard("{Escape}");
    expect(tip.className).toContain("sr-only");
    await user.unhover(screen.getByRole("link", { name: "Carte famille" }));
    await user.tab();
    expect(tip.className).not.toContain("sr-only");
  });

  it("connecté : plus de cadenas ni d'infobulle ; une démarche libre n'en a jamais", () => {
    session.kind = "account";
    const { rerender, container } = render(card(demarche("authentifie")));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(container.querySelector("svg rect")).toBeNull();
    session.kind = "anonymous";
    rerender(card(demarche("libre")));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("session invitée (suivi par code) : la démarche reste verrouillée — un code n'est pas un compte", () => {
    session.kind = "guest";
    render(card(demarche("authentifie")));
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });
});

describe("encart d'accès", () => {
  function notice(gate: "login" | "complete", path = "/fr-ignored", alert = false) {
    return (
      <MemoryRouter initialEntries={[path]}>
        <AccessNotice gate={gate} alert={alert} />
      </MemoryRouter>
    );
  }

  it("« Me connecter » ramène à la démarche (retour encodé) ; « Créer un compte » mène à l'inscription", () => {
    render(notice("login", "/demarches/d1/formulaire"));
    expect(screen.getByRole("link", { name: fr("access.login.submit") }).getAttribute("href"))
      .toBe("/compte/connexion?retour=" + encodeURIComponent("/demarches/d1/formulaire"));
    expect(screen.getByRole("link", { name: fr("access.login.register") }).getAttribute("href")).toBe("/compte/inscription");
  });

  it("le retour d'une page dont le chemin est piégé n'est pas relayé tel quel", () => {
    // Une adresse de page ne peut pas être `//evil` ; si elle l'était, le lien perdrait son `retour`.
    render(notice("login", "//evil.example/x"));
    const href = screen.getByRole("link", { name: fr("access.login.submit") }).getAttribute("href")!;
    expect(href.startsWith("/compte/connexion")).toBe(true);
    expect(decodeURIComponent(href)).not.toMatch(/retour=\/\/evil/);
  });

  it("profil à compléter : mène à « Mon compte »", () => {
    render(notice("complete"));
    expect(screen.getByRole("link", { name: fr("access.complete.link") }).getAttribute("href")).toBe("/compte");
  });

  it("après un refus du serveur, l'encart s'annonce (alerte) et prend le focus", () => {
    render(notice("login", "/demarches/d1", true));
    const alert = screen.getByRole("alert");
    expect(document.activeElement).toBe(alert);
  });

  it("accessibilité de base", async () => {
    const { container } = render(notice("login", "/demarches/d1", true));
    expect(await a11yViolations(container)).toEqual([]);
  });
});
