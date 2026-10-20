import { describe, expect, it } from "vitest";
import { alreadyRegisteredMessage, confirmationMessage, recoveryMessage, securityNoticeMessage } from "./messages.ts";
import { senderHeader, smtpFromSocle } from "./smtpConfig.ts";

const CTX = { tenantName: "Ville de <Sceaux>", portalUrl: "https://sceaux.edilumen.fr" };

describe("messages du compte", () => {
  it("le lien voyage dans le fragment, échappé en HTML", () => {
    const m = confirmationMessage(CTX, "abc/def");
    expect(m.text).toContain("https://sceaux.edilumen.fr/compte/confirmer#jeton=abc%2Fdef");
    expect(m.html).toContain("Ville de &lt;Sceaux&gt;");
    expect(m.html).not.toContain("<Sceaux>");
  });

  it("chaque message dit à quoi il sert, sans rien du compte", () => {
    expect(alreadyRegisteredMessage(CTX).subject).toBe("Vous avez déjà un compte");
    expect(recoveryMessage(CTX, "t").text).toContain("/compte/mot-de-passe#jeton=t");
    expect(securityNoticeMessage(CTX, "totp_enabled").subject).toBe("Double authentification activée");
  });
});

describe("smtpFromSocle", () => {
  it("lit la configuration servie par le Socle", () => {
    const config = smtpFromSocle({
      configured: true,
      host: "smtp.sceaux.fr",
      port: 465,
      username: "portail",
      password: "secret",
      from_email: "Ne-Pas-Repondre@Sceaux.fr",
      from_name: 'Ville de "Sceaux"',
      use_tls: true,
    });
    expect(config).toEqual({
      host: "smtp.sceaux.fr",
      port: 465,
      username: "portail",
      password: "secret",
      fromEmail: "ne-pas-repondre@sceaux.fr",
      fromName: 'Ville de "Sceaux"',
      useTls: true,
    });
    expect(senderHeader(config!)).toBe('"Ville de \\"Sceaux\\"" <ne-pas-repondre@sceaux.fr>');
  });

  it("rien de configuré, rien à envoyer", () => {
    expect(smtpFromSocle({ configured: false })).toBeNull();
    expect(smtpFromSocle({ configured: true, host: "", from_email: "a@b.fr" })).toBeNull();
    expect(smtpFromSocle(null)).toBeNull();
  });
});
