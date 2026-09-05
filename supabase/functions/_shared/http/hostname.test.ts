import { describe, expect, it } from "vitest";
import { hostFromOrigin, isLoopbackHost, localhostLabel, normalizeHostname } from "./hostname.ts";

describe("normalizeHostname — une seule forme, celle que le Socle stocke", () => {
  it("ramène les écritures équivalentes à la même clé", () => {
    for (const raw of [
      "nantes.edilumen.fr",
      "NANTES.EDILUMEN.FR",
      "  nantes.edilumen.fr  ",
      "nantes.edilumen.fr.",
      "nantes.edilumen.fr:8443",
    ]) {
      expect(normalizeHostname(raw), raw).toBe("nantes.edilumen.fr");
    }
  });

  it("écarte ce qui ne peut désigner aucun domaine", () => {
    // Un label unique est refusé comme au Socle : `localhost` n'est jamais un
    // domaine de collectivité, et le développement passe par la substitution.
    for (const raw of ["", "   ", "localhost", "..", "-nantes.fr", "nantes..fr", "http://x.fr"]) {
      expect(normalizeHostname(raw), JSON.stringify(raw)).toBeNull();
    }
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname(undefined)).toBeNull();
  });

  it("refuse un nom plus long que ce que le DNS autorise", () => {
    // Sans cette borne, une chaîne arbitrairement longue partirait au Socle —
    // qui la refuserait aussi (même limite dans sa contrainte), mais après un
    // aller-retour que rien ne justifie.
    const tooLong = "nantes.".repeat(40) + "fr"; // 282 caractères, labels valides.
    expect(tooLong.length).toBeGreaterThan(253);
    expect(normalizeHostname(tooLong)).toBeNull();
  });

  it("garde une adresse IPv6 nue intacte plutôt que de la mutiler", () => {
    // Piège : `::1` contient plusieurs « : », dont le dernier groupe ressemble
    // à un port. Le couper produirait « : », qui n'est plus reconnaissable
    // comme une adresse de bouclage — et le mode développement cesserait de
    // fonctionner sur une pile IPv6.
    expect(normalizeHostname("::1")).toBeNull();
    expect(isLoopbackHost("::1")).toBe(true);
  });
});

describe("hostFromOrigin — la seule source du domaine visité", () => {
  it("extrait l'hôte, sans schéma ni port", () => {
    expect(hostFromOrigin("https://nantes.edilumen.fr")).toBe("nantes.edilumen.fr");
    expect(hostFromOrigin("http://angers.localhost:5175")).toBe("angers.localhost");
  });

  it("rend null sur une origine absente, opaque ou illisible", () => {
    // `Origin: null` est ce que pose un navigateur pour une origine opaque
    // (iframe bac à sable, redirection). Ce n'est pas un nom d'hôte.
    for (const raw of [null, undefined, "", "null", "pas une url"]) {
      expect(hostFromOrigin(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("isLoopbackHost — ce qui ne peut pas être une collectivité", () => {
  it("reconnaît les hôtes locaux, avec ou sans label", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "nantes.localhost", "LOCALHOST"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("ne prend pas un vrai domaine pour du local", () => {
    // Le piège : un domaine qui CONTIENT « localhost » sans en être un.
    for (const host of ["nantes.edilumen.fr", "localhost.edilumen.fr", "notlocalhost"]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe("localhostLabel — le nom de la collectivité simulée", () => {
  it("extrait le label d'un sous-domaine de .localhost", () => {
    expect(localhostLabel("nantes.localhost")).toBe("nantes");
    expect(localhostLabel("angers.localhost:5175")).toBe("angers");
  });

  it("rend null quand aucun label n'est disponible", () => {
    expect(localhostLabel("localhost")).toBeNull();
    expect(localhostLabel("127.0.0.1")).toBeNull();
    expect(localhostLabel("nantes.edilumen.fr")).toBeNull();
  });
});
