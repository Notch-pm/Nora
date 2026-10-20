import { describe, expect, it } from "vitest";
import { qrModules, qrPath } from "./QrCode.tsx";
import { groupSecret } from "./TotpSection.tsx";

describe("qrModules", () => {
  it("rend une matrice carrée, avec des modules sombres", () => {
    const modules = qrModules("otpauth://totp/Mairie:a@b.fr?secret=JBSWY3DPEHPK3PXP&issuer=Mairie");
    expect(modules.length).toBeGreaterThanOrEqual(21);
    expect(modules.every((line) => line.length === modules.length)).toBe(true);
    expect(modules.flat().some(Boolean)).toBe(true);
  });

  it("est déterministe", () => {
    expect(qrModules("abc")).toEqual(qrModules("abc"));
  });
});

describe("qrPath", () => {
  it("décale d'une marge de quatre modules et groupe les suites sombres", () => {
    expect(qrPath([[true, true, false, true]])).toBe("M4 4h2v1h-2zM7 4h1v1h-1z");
  });

  it("ne trace rien pour une matrice vide de modules sombres", () => {
    expect(qrPath([[false, false]])).toBe("");
  });
});

describe("groupSecret", () => {
  it("groupe par quatre, sans espace superflu", () => {
    expect(groupSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(groupSecret("ABCDEF")).toBe("ABCD EF");
    expect(groupSecret("")).toBe("");
  });
});
