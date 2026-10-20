// @vitest-environment jsdom
/**
 * La saisie de `/suivi` (référence + courriel + code) : présence seulement côté
 * écran, UN SEUL message pour tout refus, erreurs reliées aux champs.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/t.ts";
import type { SuiviClientFailure } from "@/services/portal/suiviClient.ts";
import { a11yViolations } from "@/test/a11y.ts";
import { SuiviForm } from "./SuiviForm.tsx";
import { suiviFailureKey } from "./failureMessage.ts";

const fr = (key: Parameters<typeof t>[1]) => t("fr", key);

// jsdom n'a pas de mise en page : le défilement vers l'alerte est une doublure.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const mount = (onSubmit: (a: { reference: string; email: string; code: string }) => Promise<SuiviClientFailure | null>, expired = false) =>
  render(<SuiviForm expired={expired} onSubmit={onSubmit} onErrorCount={() => {}} />);

async function fillAll(reference = "DEM-2026-000001", email = "a@example.org", code = "ABCD-EFGH-JK") {
  const user = userEvent.setup({ delay: null });
  await user.type(document.getElementById("suivi-reference")!, reference);
  await user.type(document.getElementById("suivi-email")!, email);
  await user.type(document.getElementById("suivi-code")!, code);
  await user.click(screen.getByRole("button", { name: /.+/ , hidden: false }));
  return user;
}

describe("SuiviForm", () => {
  it("un champ vide n'envoie rien ; chaque champ manquant est nommé et relié (aria-describedby)", async () => {
    const onSubmit = vi.fn();
    const { container } = mount(onSubmit);
    await userEvent.setup({ delay: null }).click(screen.getByRole("button"));
    expect(onSubmit).not.toHaveBeenCalled();
    for (const name of ["reference", "email", "code"]) {
      const input = document.getElementById("suivi-" + name)!;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(document.getElementById(input.getAttribute("aria-describedby")!)).not.toBeNull();
    }
    expect(await a11yViolations(container)).toEqual([]);
  });

  it("envoie les trois valeurs nettoyées, rien de plus", async () => {
    const onSubmit = vi.fn(async () => null);
    mount(onSubmit);
    await fillAll("  DEM-2026-000001 ", " a@example.org ", " ABCD-EFGH-JK ");
    expect(onSubmit).toHaveBeenCalledWith({ reference: "DEM-2026-000001", email: "a@example.org", code: "ABCD-EFGH-JK" });
  });

  it.each([
    "suivi_refused",
    "suivi_too_many_attempts",
    "suivi_unavailable",
    "network",
    "csrf_rejected",
  ] as const)("refus %s : alerte avec le texte prévu pour ce cas", async (reason) => {
    mount(async () => reason);
    await fillAll();
    expect((await screen.findByRole("alert")).textContent).toContain(t("fr", suiviFailureKey(reason)));
  });

  it("UN SEUL message pour tout refus : inconnue, mauvais code et accès verrouillé arrivent tous en « suivi_refused »", () => {
    // Le serveur ne distingue pas ces cas ; l'écran n'a qu'une phrase à leur donner.
    expect(suiviFailureKey("suivi_refused")).toBe("suivi.error.refused");
    expect(fr("suivi.error.refused")).not.toMatch(/inconnu|n'existe pas|verrouill/i);
  });

  it("accès expiré : la phrase au-dessus de la saisie, sans effacer le formulaire", () => {
    mount(async () => null, true);
    expect(screen.getByText(fr("suivi.error.expired"))).toBeTruthy();
    expect(document.getElementById("suivi-code")).not.toBeNull();
  });
});
