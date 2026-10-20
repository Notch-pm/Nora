import { describe, expect, it } from "vitest";
import { unmetPasswordRules } from "./password.ts";
import { authSecretFrom, seal, signToken, unseal, verifyToken } from "./secrets.ts";
import { base32Decode, base32Encode, hotp, matchTotp, newTotpSecret, otpauthUri } from "./totp.ts";

const SECRET = "s".repeat(40);

describe("unmetPasswordRules", () => {
  it("accepte 12 caractères avec lettre, chiffre et caractère spécial", () => {
    expect(unmetPasswordRules("Correct-cheval-9")).toEqual([]);
    expect(unmetPasswordRules("éléphant rose 7!")).toEqual([]);
  });

  it("dit ce qui manque", () => {
    expect(unmetPasswordRules("court1!")).toEqual(["length"]);
    expect(unmetPasswordRules("pasdechiffre!!")).toEqual(["digit"]);
    expect(unmetPasswordRules("1234567890123")).toEqual(["letter", "special"]);
    expect(unmetPasswordRules("pas de special 9")).toEqual(["special"]);
  });

  it("refuse ce que bcrypt tronquerait en silence (72 octets)", () => {
    expect(unmetPasswordRules("é".repeat(36) + "1!")).toContain("too_long");
  });
});

describe("secrets", () => {
  it("chiffre et déchiffre, par usage", async () => {
    const sealed = await seal(SECRET, "totp", "JBSWY3DPEHPK3PXP");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(await unseal(SECRET, "totp", sealed)).toBe("JBSWY3DPEHPK3PXP");
    expect(await unseal(SECRET, "autre-usage", sealed)).toBeNull();
    expect(await unseal("t".repeat(40), "totp", sealed)).toBeNull();
    expect(await unseal(SECRET, "totp", sealed.slice(0, -2) + "AA")).toBeNull();
  });

  it("un ticket signé vaut jusqu'à son échéance, et pas pour un autre usage", async () => {
    const token = await signToken(SECRET, "mfa", { sub: "a", exp: 1000 });
    expect(await verifyToken(SECRET, "mfa", token, 999)).toEqual({ sub: "a", exp: 1000 });
    expect(await verifyToken(SECRET, "mfa", token, 1000)).toBeNull();
    expect(await verifyToken(SECRET, "autre", token, 999)).toBeNull();
    const [body] = token.split(".");
    const forged = btoa(JSON.stringify({ sub: "b", exp: 1000 })).replace(/=+$/, "");
    expect(await verifyToken(SECRET, "mfa", `${forged}.${token.split(".")[1]}`, 999)).toBeNull();
    expect(body).not.toBe(forged);
  });

  it("refuse un secret absent ou court", () => {
    expect(authSecretFrom(undefined)).toBeNull();
    expect(authSecretFrom("court")).toBeNull();
    expect(authSecretFrom(SECRET)).toBe(SECRET);
  });
});

describe("TOTP", () => {
  // RFC 6238, annexe B : secret ASCII « 12345678901234567890 », SHA-1.
  const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));

  it("suit les vecteurs de la RFC 6238", async () => {
    const key = base32Decode(RFC_SECRET)!;
    expect(await hotp(key, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(await hotp(key, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(await hotp(key, Math.floor(1234567890 / 30), 8)).toBe("89005924");
  });

  it("accepte le pas courant et ses voisins, rend le pas reconnu", async () => {
    const key = base32Decode(RFC_SECRET)!;
    const now = 1111111109;
    const step = Math.floor(now / 30);
    expect(await matchTotp(RFC_SECRET, await hotp(key, step), now)).toBe(step);
    expect(await matchTotp(RFC_SECRET, await hotp(key, step - 1), now)).toBe(step - 1);
    expect(await matchTotp(RFC_SECRET, await hotp(key, step + 1), now)).toBe(step + 1);
    expect(await matchTotp(RFC_SECRET, await hotp(key, step - 3), now)).toBeNull();
    expect(await matchTotp(RFC_SECRET, "abcdef", now)).toBeNull();
  });

  it("tire un secret de 160 bits et l'expose en otpauth://", () => {
    const secret = newTotpSecret();
    expect(base32Decode(secret)!.length).toBe(20);
    const uri = otpauthUri(secret, "a@b.fr", "Ville de Sceaux");
    expect(uri.startsWith("otpauth://totp/Ville%20de%20Sceaux%3Aa%40b.fr?")).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
  });
});
