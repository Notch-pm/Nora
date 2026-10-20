// @vitest-environment jsdom
/**
 * « Code perdu ? » (L4a) : présence des deux champs, une réponse qui ne dit
 * jamais si la demande existe, les échecs du serveur affichés comme tels.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";

const resend = vi.fn();
vi.mock("@/services/portal/suiviClient.ts", () => ({ resendSuiviCode: (input: unknown) => resend(input) }));

const { CodePerdu } = await import("./CodePerdu.tsx");
const fr = (key: Parameters<typeof t>[1]) => t("fr", key);

afterEach(() => {
  cleanup();
  resend.mockReset();
});

async function openAndFill(reference: string, email: string) {
  const user = userEvent.setup({ delay: null });
  render(<CodePerdu />);
  await user.click(screen.getByText(fr("suivi.lost.title")));
  if (reference) await user.type(document.getElementById("code-perdu-reference")!, reference);
  if (email) await user.type(document.getElementById("code-perdu-email")!, email);
  await user.click(screen.getByRole("button", { name: fr("suivi.lost.submit") }));
  return user;
}

describe("CodePerdu", () => {
  it("un champ vide n'envoie rien ; il est nommé et relié", async () => {
    await openAndFill("", "camille@example.org");
    expect(resend).not.toHaveBeenCalled();
    const input = document.getElementById("code-perdu-reference")!;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe(fr("suivi.required.reference"));
  });

  it("envoie la référence et l'adresse ; la réponse dit « si… », jamais que la demande existe", async () => {
    resend.mockResolvedValue({ ok: true });
    await openAndFill(" DEM-2026-000001 ", "camille@example.org");
    expect(resend).toHaveBeenCalledWith({ reference: "DEM-2026-000001", email: "camille@example.org" });
    expect((await screen.findByRole("status")).textContent).toBe(fr("suivi.lost.sent"));
  });

  it("trop de demandes ou serveur indisponible : une alerte, pas la phrase de succès", async () => {
    resend.mockResolvedValue({ ok: false, reason: "suivi_too_many_attempts" });
    await openAndFill("DEM-2026-000001", "camille@example.org");
    expect((await screen.findByRole("alert")).textContent).not.toBe(fr("suivi.lost.sent"));
  });

  it("aucune violation d'accessibilité, replié comme ouvert", async () => {
    resend.mockResolvedValue({ ok: true });
    const { container } = render(<CodePerdu />);
    expect(await a11yViolations(container)).toEqual([]);
    await userEvent.setup({ delay: null }).click(screen.getByText(fr("suivi.lost.title")));
    expect(await a11yViolations(container)).toEqual([]);
  });
});
