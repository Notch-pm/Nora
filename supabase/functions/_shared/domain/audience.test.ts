import { describe, expect, it } from "vitest";
import { deviceClass, isBot, parseAudienceBeacon } from "./audience.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseAudienceBeacon — ce que le navigateur a le droit d'annoncer", () => {
  it("lit les trois formes valides", () => {
    expect(parseAudienceBeacon({ page: "accueil", entry: true }))
      .toEqual({ page: "accueil", demarcheId: null, entry: true });
    expect(parseAudienceBeacon({ page: "demarche", demarcheId: UUID }))
      .toEqual({ page: "demarche", demarcheId: UUID, entry: false });
    expect(parseAudienceBeacon({ page: "formulaire", demarcheId: UUID, entry: false }))
      .toEqual({ page: "formulaire", demarcheId: UUID, entry: false });
  });

  // ⚠️ Le corps arrive d'un navigateur, donc de n'importe qui : accepter une
  // clé de plus « au cas où », ce serait accepter qu'on pousse un jour un
  // identifiant dans le tuyau. Il n'y a rien à ignorer poliment ici.
  it("refuse toute clé inconnue, plutôt que de l'ignorer", () => {
    for (const key of ["visitorId", "ip", "referrer", "userAgent", "url", "lang"]) {
      expect(parseAudienceBeacon({ page: "accueil", [key]: "x" })).toBeNull();
    }
  });

  it("refuse ce qui n'est pas un objet", () => {
    for (const raw of [null, undefined, "accueil", 42, ["accueil"], true]) {
      expect(parseAudienceBeacon(raw)).toBeNull();
    }
  });

  it("exige une démarche hors accueil, et la refuse sur l'accueil", () => {
    expect(parseAudienceBeacon({ page: "demarche" })).toBeNull();
    expect(parseAudienceBeacon({ page: "formulaire" })).toBeNull();
    expect(parseAudienceBeacon({ page: "accueil", demarcheId: UUID })).toBeNull();
  });

  it("refuse une démarche qui n'est pas un uuid", () => {
    for (const id of ["abc", "", "../../etc", `${UUID}x`]) {
      expect(parseAudienceBeacon({ page: "demarche", demarcheId: id })).toBeNull();
    }
  });

  it("refuse une page hors des trois écrans", () => {
    for (const page of ["contact", "", "ACCUEIL", "actus", 42]) {
      expect(parseAudienceBeacon({ page })).toBeNull();
    }
  });

  // `entry` est un OUI/NON : le référent qui l'a produit n'entre jamais.
  it("n'accepte `entry` que strictement booléen", () => {
    expect(parseAudienceBeacon({ page: "accueil", entry: "true" })).toBeNull();
    expect(parseAudienceBeacon({ page: "accueil", entry: 1 })).toBeNull();
    expect(parseAudienceBeacon({ page: "accueil" })?.entry).toBe(false);
  });
});

describe("isBot — les robots honnêtes se nomment", () => {
  // ⚠️ Détection GROSSIÈRE et assumée : un robot qui veut fausser les chiffres
  // se déclare navigateur. Elle existe pour écarter la SURVEILLANCE — sans quoi
  // une commune sans visiteur afficherait un trafic régulier.
  it("écarte les robots qui se déclarent", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "curl/8.4.0",
      "python-requests/2.31.0",
      "Mozilla/5.0 HeadlessChrome/120.0.0.0",
      "UptimeRobot/2.0",
      "facebookexternalhit/1.1",
    ]) {
      expect(isBot(ua)).toBe(true);
    }
  });

  // Un navigateur envoie toujours un User-Agent : son absence est le fait d'un
  // script.
  it("écarte une requête sans User-Agent", () => {
    for (const ua of [null, undefined, "", "   "]) {
      expect(isBot(ua)).toBe(true);
    }
  });

  it("laisse passer les vrais navigateurs", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/121.0",
    ]) {
      expect(isBot(ua)).toBe(false);
    }
  });
});

describe("deviceClass — le User-Agent entre, un mot sort", () => {
  it("reconnaît les téléphones", () => {
    expect(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 Safari/604.1"))
      .toBe("mobile");
    expect(deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36"))
      .toBe("mobile");
  });

  // L'ordre des tests compte : « Android » est sur les tablettes ET les
  // téléphones, et c'est l'absence de « Mobile » qui les distingue.
  it("reconnaît les tablettes", () => {
    expect(deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/604.1")).toBe("tablette");
    expect(deviceClass("Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/120.0 Safari/537.36"))
      .toBe("tablette");
  });

  it("range tout le reste en ordinateur, y compris l'inconnu", () => {
    expect(deviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36"))
      .toBe("ordinateur");
    expect(deviceClass(null)).toBe("ordinateur");
    expect(deviceClass("")).toBe("ordinateur");
  });

  // ⚠️ LIMITE CONNUE ET ASSUMÉE : depuis iPadOS 13, un iPad en mode « bureau »
  // s'annonce Macintosh. Les contournements (taille d'écran, points tactiles)
  // demandent du JavaScript dans la page et rapprochent de l'empreinte de
  // navigateur — précisément ce que cette mesure refuse. Le test épingle le
  // comportement pour que personne ne le « corrige » sans lire pourquoi.
  it("compte un iPad récent comme un ordinateur, faute de mieux", () => {
    expect(deviceClass("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15"))
      .toBe("ordinateur");
  });
});
