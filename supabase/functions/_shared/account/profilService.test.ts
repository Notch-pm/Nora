import { describe, expect, it } from "vitest";
import type { AccountStore } from "./accountStore.ts";
import type { IdentityProvider } from "./identity.ts";
import { enregistrerProfil, lireProfil, type ProfilDeps } from "./profilService.ts";
import type { CitizenContacts } from "../socle/citizenContacts.ts";
import { parseIdentite, toSocleIdentity } from "../domain/profil.ts";

const TENANT = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTACT = "cccccccc-0000-4000-8000-000000000001";
const IDENTITE = {
  civilite: "madame",
  prenom: "Jeanne",
  nom: "Dupont",
  adresse1: "12 rue Houdan",
  codePostal: "92330",
  ville: "Sceaux",
};
const FICHE = {
  id: CONTACT,
  civility: "madame",
  first_name: "Jeanne",
  last_name: "Dupont",
  email: "jeanne@example.fr",
  address_line1: "12 rue Houdan",
  postal_code: "92330",
  city: "Sceaux",
  internal_notes: "ne doit pas sortir",
};

function deps() {
  let spaceContact: string | null = null;
  const calls: { method: string; body?: unknown }[] = [];
  const store = {
    spaceContact: async () => ({ ok: true as const, value: spaceContact }),
    setSpaceContact: async (_a: string, _t: string, id: string) => {
      spaceContact = id;
      return { ok: true as const, value: true };
    },
  } as unknown as AccountStore;
  const identity = { emailOf: async () => "jeanne@example.fr" } as unknown as IdentityProvider;
  const contacts: CitizenContacts = {
    async get() {
      calls.push({ method: "get" });
      return { kind: "ok", status: 200, body: { contact: FICHE } };
    },
    async link(_t, _a, body) {
      calls.push({ method: "link", body });
      return { kind: "ok", status: 201, body: { contact: FICHE, outcome: "created" } };
    },
    async update(_t, _a, body) {
      calls.push({ method: "update", body });
      return { kind: "ok", status: 200, body: { contact: { ...FICHE, city: "Antony" } } };
    },
  };
  const d: ProfilDeps = { store, identity, contacts, tenantId: TENANT, trace: { ip: null, userAgent: null } };
  return { d, calls, linked: () => spaceContact };
}

describe("profil de l'usager connecté", () => {
  it("sans fiche rattachée : pas de profil, et le Socle n'est pas interrogé", async () => {
    const { d, calls } = deps();
    expect(await lireProfil(d, "acc")).toEqual({ ok: true, profil: null });
    expect(calls).toHaveLength(0);
  });

  it("premier remplissage : rattachement avec l'adresse du COMPTE, fiche retenue dans l'espace", async () => {
    const { d, calls, linked } = deps();
    const saved = await enregistrerProfil(d, "acc", { ...IDENTITE, courriel: "pirate@evil.fr" });
    expect(saved.ok && saved.profil?.nom).toBe("Dupont");
    expect(calls[0]).toMatchObject({ method: "link", body: { email: "jeanne@example.fr", last_name: "Dupont" } });
    expect(linked()).toBe(CONTACT);
    expect(JSON.stringify(saved)).not.toContain("ne doit pas sortir");
  });

  it("ensuite : seules les coordonnées partent au Socle", async () => {
    const { d, calls } = deps();
    await enregistrerProfil(d, "acc", IDENTITE);
    const updated = await enregistrerProfil(d, "acc", { ville: "Antony", nom: "Autre" });
    expect(updated.ok && updated.profil?.ville).toBe("Antony");
    expect(calls[1]).toEqual({ method: "update", body: { city: "Antony" } });
  });

  it("une identité incomplète est refusée champ par champ", async () => {
    const { d } = deps();
    expect(await enregistrerProfil(d, "acc", { ...IDENTITE, codePostal: "923", nom: "" })).toEqual({
      ok: false,
      reason: "profil_invalide",
      champs: ["nom", "codePostal"],
    });
  });
});

describe("domaine du profil", () => {
  it("traduit l'identité vers le contrat du Socle, sans les champs vides", () => {
    const parsed = parseIdentite(IDENTITE);
    if (!parsed.ok) throw new Error("refusé");
    expect(toSocleIdentity(parsed.value, "a@b.fr")).toEqual({
      civility: "madame",
      first_name: "Jeanne",
      last_name: "Dupont",
      email: "a@b.fr",
      address_line1: "12 rue Houdan",
      postal_code: "92330",
      city: "Sceaux",
    });
  });
});

describe("fiche de l'espace confrontée au Socle (I3)", () => {
  it("si le Socle désigne une autre fiche, rien n'est montré", async () => {
    const { d } = deps();
    await enregistrerProfil(d, "acc", IDENTITE);
    d.contacts.get = async () => ({ kind: "ok", status: 200, body: { contact: { ...FICHE, id: "dddddddd-0000-4000-8000-000000000009" } } });
    expect(await lireProfil(d, "acc")).toEqual({ ok: false, reason: "profil_indisponible" });
    const { ficheConfirmee } = await import("./profilService.ts");
    expect(await ficheConfirmee(d, "acc", CONTACT)).toBe(false);
  });
});
