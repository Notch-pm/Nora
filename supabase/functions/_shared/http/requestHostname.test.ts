import { describe, expect, it } from "vitest";
import { hostnameForRequest, type DevHostnameConfig } from "./requestHostname.ts";

const PRODUCTION: DevHostnameConfig = { suffix: null, fallback: null };
const DEV: DevHostnameConfig = { suffix: "edilumen.fr", fallback: "nantes.edilumen.fr" };

function request(origin: string | null): Request {
  return new Request("https://portal.example/portal-api/v1/bootstrap", {
    headers: origin === null ? {} : { origin },
  });
}

describe("hostnameForRequest — en production", () => {
  it("prend le domaine de la page visitée", () => {
    expect(hostnameForRequest(request("https://nantes.edilumen.fr"), PRODUCTION)).toBe(
      "nantes.edilumen.fr",
    );
  });

  it("ne résout rien sans origine exploitable", () => {
    // Mieux vaut une erreur explicite qu'une collectivité choisie au hasard.
    expect(hostnameForRequest(request(null), PRODUCTION)).toBeNull();
    expect(hostnameForRequest(request("http://localhost:5175"), PRODUCTION)).toBeNull();
    expect(hostnameForRequest(request("null"), PRODUCTION)).toBeNull();
  });

  it("ignore un paramètre `hostname` posé par le client", () => {
    // Le paramètre n'existe que si la configuration de développement est posée.
    // En production elle ne l'est pas : il n'est même pas lu.
    const forged = new Request(
      "https://portal.example/portal-api/v1/bootstrap?hostname=angers.edilumen.fr",
      { headers: { origin: "https://nantes.edilumen.fr" } },
    );
    expect(hostnameForRequest(forged, PRODUCTION)).toBe("nantes.edilumen.fr");
  });
});

describe("hostnameForRequest — en développement", () => {
  it("traduit `<collectivité>.localhost` en domaine réel", () => {
    // C'est ce qui permet de vérifier « hostname A → tenant A, hostname B →
    // tenant B » en changeant d'onglet, sans toucher au code.
    expect(hostnameForRequest(request("http://nantes.localhost:5175"), DEV)).toBe(
      "nantes.edilumen.fr",
    );
    expect(hostnameForRequest(request("http://angers.localhost:5175"), DEV)).toBe(
      "angers.edilumen.fr",
    );
  });

  it("retombe sur le domaine par défaut pour un bouclage sans label", () => {
    expect(hostnameForRequest(request("http://localhost:5175"), DEV)).toBe("nantes.edilumen.fr");
    expect(hostnameForRequest(request("http://127.0.0.1:5175"), DEV)).toBe("nantes.edilumen.fr");
    // Appel sans origine (curl) : le défaut s'applique aussi, en développement.
    expect(hostnameForRequest(request(null), DEV)).toBe("nantes.edilumen.fr");
  });

  it("ne détourne JAMAIS un vrai domaine, même configuration de dev posée", () => {
    // La garde qui compte : si la configuration de développement traînait en
    // production, un visiteur d'Angers ne doit pas se retrouver sur Nantes.
    expect(hostnameForRequest(request("https://angers.edilumen.fr"), DEV)).toBe(
      "angers.edilumen.fr",
    );
  });

  it("n'invente rien sans suffixe configuré", () => {
    const labelOnly: DevHostnameConfig = { suffix: null, fallback: "nantes.edilumen.fr" };
    // Pas de suffixe : le label est inutilisable, on sert le défaut.
    expect(hostnameForRequest(request("http://angers.localhost:5175"), labelOnly)).toBe(
      "nantes.edilumen.fr",
    );
    const nothing: DevHostnameConfig = { suffix: null, fallback: null };
    expect(hostnameForRequest(request("http://angers.localhost:5175"), nothing)).toBeNull();
  });

  it("traite une configuration vide comme absente", () => {
    // Une variable d'environnement posée mais vide est une variable non posée.
    const blank: DevHostnameConfig = { suffix: "", fallback: "" };
    expect(hostnameForRequest(request("http://nantes.localhost:5175"), blank)).toBeNull();
  });
});
