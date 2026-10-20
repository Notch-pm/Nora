// @vitest-environment jsdom
/**
 * « Répondre » (L4b) : un texte obligatoire, les pièces déposées d'abord puis
 * citées par leur identifiant, l'échec du serveur annoncé, l'accessibilité.
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@/i18n/t.ts";
import { a11yViolations } from "@/test/a11y.ts";

const upload = vi.fn();
vi.mock("@/services/portal/portalClient.ts", () => ({ uploadPiece: (file: File) => upload(file) }));

const { ReplyForm } = await import("./ReplyForm.tsx");
const fr = (key: Parameters<typeof t>[1], params?: Record<string, string | number>) => t("fr", key, params);

afterEach(() => {
  cleanup();
  upload.mockReset();
});

describe("ReplyForm", () => {
  it("un message vide n'est pas envoyé ; l'erreur est reliée au champ", async () => {
    const onSend = vi.fn();
    render(<ReplyForm onSend={onSend} />);
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: fr("suivi.reply.submit") }));
    expect(onSend).not.toHaveBeenCalled();
    const area = screen.getByLabelText(fr("suivi.reply.label"));
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(area.getAttribute("aria-describedby")!)?.textContent).toBe(fr("suivi.reply.required"));
  });

  it("dépose la pièce, puis envoie le texte et SON identifiant ; le formulaire se vide et annonce l'envoi", async () => {
    upload.mockResolvedValue({ ok: true, piece: { uploadId: "u-1", fileName: "facture.pdf", mimeType: "application/pdf", sizeBytes: 10 } });
    const onSend = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup({ delay: null });
    render(<ReplyForm onSend={onSend} />);
    await user.upload(screen.getByLabelText(fr("suivi.reply.pieces", { max: 5 })), new File(["%PDF"], "facture.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("facture.pdf")).toBeTruthy();
    await user.type(screen.getByLabelText(fr("suivi.reply.label")), " Voici la facture ");
    await user.click(screen.getByRole("button", { name: fr("suivi.reply.submit") }));
    expect(onSend).toHaveBeenCalledWith({ texte: "Voici la facture", pieces: ["u-1"] });
    expect((await screen.findByRole("status")).textContent).toBe(fr("suivi.reply.sent"));
    expect((screen.getByLabelText(fr("suivi.reply.label")) as HTMLTextAreaElement).value).toBe("");
  });

  it("une pièce retirée ne part pas", async () => {
    upload.mockResolvedValue({ ok: true, piece: { uploadId: "u-1", fileName: "a.png", mimeType: "image/png", sizeBytes: 1 } });
    const onSend = vi.fn().mockResolvedValue(null);
    const user = userEvent.setup({ delay: null });
    render(<ReplyForm onSend={onSend} />);
    await user.upload(screen.getByLabelText(fr("suivi.reply.pieces", { max: 5 })), new File(["x"], "a.png", { type: "image/png" }));
    await user.click(await screen.findByRole("button", { name: fr("suivi.reply.remove", { name: "a.png" }) }));
    await user.type(screen.getByLabelText(fr("suivi.reply.label")), "Sans pièce");
    await user.click(screen.getByRole("button", { name: fr("suivi.reply.submit") }));
    expect(onSend).toHaveBeenCalledWith({ texte: "Sans pièce", pieces: [] });
  });

  it("demande close entre-temps : l'alerte le dit, le texte reste", async () => {
    const onSend = vi.fn().mockResolvedValue("suivi_closed");
    const user = userEvent.setup({ delay: null });
    render(<ReplyForm onSend={onSend} />);
    await user.type(screen.getByLabelText(fr("suivi.reply.label")), "Trop tard ?");
    await user.click(screen.getByRole("button", { name: fr("suivi.reply.submit") }));
    expect((await screen.findByRole("alert")).textContent).toBe(fr("suivi.error.closed"));
    expect((screen.getByLabelText(fr("suivi.reply.label")) as HTMLTextAreaElement).value).toBe("Trop tard ?");
  });

  it("aucune violation d'accessibilité", async () => {
    const { container } = render(<ReplyForm onSend={vi.fn()} />);
    expect(await a11yViolations(container)).toEqual([]);
  });
});
