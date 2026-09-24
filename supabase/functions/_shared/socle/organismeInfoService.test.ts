import { describe, expect, it } from "vitest";
import { getOrganismesInfo } from "./organismeInfoService.ts";
import { parseOrganismesInfo } from "../domain/organismeInfo.ts";
import type { SocleClient, SocleReply } from "./socleClient.ts";

const replying = (reply: SocleReply): SocleClient => ({ get: async () => reply });

const MAIRIE = {
  id: "d5227d25-f327-493a-a9a2-278397531e33",
  name: "Mairie de Plounéour",
  slug: "plouneour",
  is_tenant: true,
  phone: "02 98 00 00 00",
  email: "accueil@plouneour.fr",
  updated_at: "2026-09-24T08:00:00+00:00",
  info: {
    description: "La mairie vous accueille pour l'état civil.",
    openingHours: [
      { day: "monday", morningOpen: "08:30", morningClose: "12:00", afternoonOpen: "13:30", afternoonClose: "17:00" },
      { day: "saturday", morningOpen: "09:00", morningClose: null, afternoonOpen: null, afternoonClose: "12:00" },
    ],
    openingHoursNotes: "Fermé les jours fériés.",
    faq: [{ question: "Faut-il prendre rendez-vous ?", answer: "Seulement pour les passeports." }],
  },
};

describe("getOrganismesInfo", () => {
  it("demande au Socle les organismes du tenant", async () => {
    const paths: string[] = [];
    const socle: SocleClient = {
      get: async (path) => {
        paths.push(path);
        return { kind: "ok", body: [] };
      },
    };
    await getOrganismesInfo("t 1", socle);
    expect(paths).toEqual(["/v1/portal/organizations?tenant_id=t%201"]);
  });

  it("sert la réponse du contrat 1.30.0, traduite dans le modèle du portail", async () => {
    expect(await getOrganismesInfo("t1", replying({ kind: "ok", body: [MAIRIE] }))).toEqual({
      ok: true,
      organismes: [
        {
          id: MAIRIE.id,
          name: "Mairie de Plounéour",
          isTenant: true,
          phone: "02 98 00 00 00",
          email: "accueil@plouneour.fr",
          description: "La mairie vous accueille pour l'état civil.",
          openingHours: MAIRIE.info.openingHours,
          openingHoursNotes: "Fermé les jours fériés.",
          faq: [{ question: "Faut-il prendre rendez-vous ?", answer: "Seulement pour les passeports." }],
        },
      ],
    });
  });

  it("⚠️ 404 (Socle d'avant 1.30.0) n'est pas une panne : rien d'écrit", async () => {
    expect(await getOrganismesInfo("t1", replying({ kind: "not_found" }))).toEqual({ ok: true, organismes: [] });
  });

  it("une clé refusée et un Socle injoignable sont deux pannes distinctes", async () => {
    expect(await getOrganismesInfo("t1", replying({ kind: "auth_failed" }))).toEqual({
      ok: false,
      reason: "socle_misconfigured",
    });
    expect(await getOrganismesInfo("t1", replying({ kind: "unreachable" }))).toEqual({
      ok: false,
      reason: "socle_unavailable",
    });
  });
});

describe("parseOrganismesInfo", () => {
  const withInfo = (info: Record<string, unknown>) => [{ ...MAIRIE, info: { ...MAIRIE.info, ...info } }];

  it("une réponse qui n'est pas une liste vaut « rien d'écrit »", () => {
    for (const raw of [null, "x", {}, 42]) expect(parseOrganismesInfo(raw)).toEqual([]);
  });

  it("écarte un organisme illisible, en double, ou qui n'a rien écrit", () => {
    const empty = { id: "vide", name: "Vide", info: { description: "  ", openingHours: [], openingHoursNotes: "", faq: [] } };
    expect(parseOrganismesInfo([{ name: "sans id" }, MAIRIE, MAIRIE, empty]).map((o) => o.id)).toEqual([MAIRIE.id]);
  });

  it("⚠️ un horaire incohérent est ÉCARTÉ, jamais réparé", () => {
    const [organisme] = parseOrganismesInfo(
      withInfo({
        openingHours: [
          { day: "monday", morningOpen: "08:30", morningClose: "12:00", afternoonOpen: "13:30", afternoonClose: "17:00" },
          { day: "monday", morningOpen: "07:00", morningClose: null, afternoonOpen: null, afternoonClose: "19:00" },
          { day: "tuesday", morningOpen: "14:00", morningClose: null, afternoonOpen: null, afternoonClose: "09:00" },
          { day: "wednesday", morningOpen: "08:00", morningClose: "12:00", afternoonOpen: null, afternoonClose: "17:00" },
          { day: "funday", morningOpen: "08:00", morningClose: null, afternoonOpen: null, afternoonClose: "17:00" },
          { day: "friday", morningOpen: "8h", morningClose: null, afternoonOpen: null, afternoonClose: "17:00" },
          { day: "thursday", morningOpen: "09:00", morningClose: null, afternoonOpen: null, afternoonClose: "16:00" },
        ],
      }),
    );
    // Lundi garde la première occurrence ; jeudi, seul jour valide restant, suit dans l'ordre de la semaine.
    expect(organisme.openingHours.map((h) => [h.day, h.morningOpen])).toEqual([
      ["monday", "08:30"],
      ["thursday", "09:00"],
    ]);
  });

  it("un organisme qui n'a que ses coordonnées est gardé ; un Socle d'avant 1.31.0 n'en donne pas", () => {
    const vide = { description: "", openingHours: [], openingHoursNotes: "", faq: [] };
    const [ccas] = parseOrganismesInfo([{ id: "ccas", name: "CCAS", phone: " 01 23 45 67 89 ", email: "", info: vide }]);
    expect(ccas).toMatchObject({ phone: "01 23 45 67 89", email: null });
    expect(parseOrganismesInfo([{ id: "x", name: "X", info: vide }])).toEqual([]);
    const [ancien] = parseOrganismesInfo([{ ...MAIRIE, phone: undefined, email: undefined }]);
    expect(ancien).toMatchObject({ phone: null, email: null });
  });

  it("une question sans réponse ne sert à rien à l'assistant : écartée", () => {
    const [organisme] = parseOrganismesInfo(withInfo({ faq: [{ question: "Q ?", answer: " " }, { question: "", answer: "R" }] }));
    expect(organisme.faq).toEqual([]);
  });
});
