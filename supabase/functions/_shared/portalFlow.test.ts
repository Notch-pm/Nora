/**
 * Le flux complet du portail, bout en bout, contre un Socle simulé :
 *
 *     hostname → resolveTenant → tenant → getPublicDemarches → démarches
 *
 * C'est le test qui dit si le portail multi-tenant fonctionne. Les tests
 * unitaires voisins couvrent les détails de chaque étage ; celui-ci vérifie
 * qu'assemblés, ils rendent la bonne collectivité et les bonnes démarches — et
 * que chaque façon d'échouer produit une erreur exploitable plutôt qu'une page
 * blanche.
 *
 * Aucun réseau, aucun Deno : le Socle est remplacé par une table de routes.
 * C'est tout l'intérêt d'avoir fait de `SocleClient` un port.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostnameForRequest } from "./http/requestHostname.ts";
import { getPublicDemarche, getPublicDemarches } from "./socle/demarcheService.ts";
import { resolveLang } from "./domain/languages.ts";
import { getPublishedPage } from "./socle/pageService.ts";
import { getBranding } from "./socle/brandingService.ts";
import { resolveTenant } from "./socle/tenantService.ts";
import { closedAssistant } from "./domain/assistant.ts";
import { defaultTheme } from "./domain/theme.ts";
import type { SocleClient, SocleReply } from "./socle/socleClient.ts";
import { getCourrierOrganismes } from "./socle/organismeInfoService.ts";
import { createClaraClient } from "./clara/claraClient.ts";
import { depositCourrier } from "./clara/courrierService.ts";
import {
  COURRIER_MESSAGES,
  courrierPageBySlug,
  courrierPages,
  httpStatusForCourrierFailure,
} from "./domain/courrier.ts";
import { organizationBySlug, villesOf } from "./domain/demarche.ts";

const NANTES = "8f1e0d3a-0000-4000-8000-000000000001";
const ANGERS = "8f1e0d3a-0000-4000-8000-000000000002";

const NANTES_PROCEDURES = "/v1/portal/procedures?tenant_id=" + NANTES;
const ANGERS_PROCEDURES = "/v1/portal/procedures?tenant_id=" + ANGERS;

/** Réponses du Socle, telles que son API publique les sert réellement. */
const ROUTES: Record<string, unknown> = {
  "/v1/portal/tenant?hostname=nantes.edilumen.fr": {
    id: NANTES,
    name: "Ville de Nantes",
    slug: "nantes",
    hostname: "nantes.edilumen.fr",
    languages: ["fr", "en", "br"],
  },
  "/v1/portal/tenant?hostname=angers.edilumen.fr": {
    id: ANGERS,
    name: "Ville d'Angers",
    slug: "angers",
    hostname: "angers.edilumen.fr",
  },
  [NANTES_PROCEDURES]: [
    {
      id: "d1",
      name: "Signaler un problème de voirie",
      short_description: "Signalez un problème rencontré dans l'espace public.",
      user_description: "Le service voirie interviendra sous 5 jours ouvrés.",
      input_duration_minutes: 5,
      // Traduite en anglais, intitulé SEULEMENT : le résumé doit rester
      // français sans emporter l'intitulé traduit.
      translations: { en: { name: "Report a road problem" } },
      // Les publics du filtre « Je suis… ». `patrimoine` n'en est pas un :
      // écarté, comme un kind de section inconnu.
      audiences: ["citoyen", "patrimoine"],
      // Proposée par la ville et par l'un de ses quartiers : le Socle sert
      // les organismes dans l'ordre de l'arbre, le portail le conserve.
      organizations: [
        { id: NANTES, name: "Ville de Nantes", slug: "nantes" },
        // Son slug lui donne une adresse : `/mairie-de-chantenay`.
        { id: "q-chantenay", name: "Mairie de quartier de Chantenay", slug: "mairie-de-chantenay" },
        // Illisibles : une puce sans nom ne nomme personne, elle est écartée.
        { id: "sans-nom", name: "" },
        "pas-un-objet",
      ],
      // Contrat 1.41.0 : la catégorie dès la liste, pictogramme compris.
      // Traduite en anglais, comme l'intitulé.
      category: {
        id: "cat-voirie",
        name: "Voirie",
        icon: "construction",
        translations: { en: { name: "Roads" } },
      },
    },
    {
      id: "d2",
      name: "Demander un acte de naissance",
      short_description: null,
      user_description: "Effectuez votre demande en ligne.",
      input_duration_minutes: null,
      // Sans slug : la ville n'a pas de page d'organisme, son site EST le
      // portail. Le portail le lit `null`, et n'en fait pas d'adresse.
      organizations: [{ id: NANTES, name: "Ville de Nantes" }],
      audiences: ["citoyen", "entreprise"],
    },
  ],
  // Angers existe, mais n'a encore rien publié : cas normal, pas une erreur.
  [ANGERS_PROCEDURES]: [],
  // Nantes a une charte ; Angers non (404 → couleurs par défaut, sans erreur).
  ["/v1/organizations/" + NANTES + "/branding"]: {
    organization_id: NANTES,
    configured: true,
    logo_url: "https://cdn.example/nantes.svg",
    logo_white_url: null,
    favicon_url: "https://cdn.example/nantes-favicon.png",
    primary_color: "#1F8A5B",
    secondary_color: null,
  },
  // Nantes a composé sa page d'accueil ; Angers non (pas de route → 404).
  ["/v1/portal/page?tenant_id=" + NANTES + "&slug=accueil"]: {
    slug: "accueil",
    published_at: "2026-09-05T12:21:10Z",
    version: 1,
    sections: [
      { id: "r", kind: "recherche", title: "Trouvez votre démarche", subtitle: "", placeholder: "Ex.", show_shortcuts: false, shortcuts: [] },
      { id: "g", kind: "demarches", title: "Les plus demandées", columns: 3, pinned_first: true, pinned: ["d1"] },
    ],
  },
};

/** Socle simulé : sert la table, répond 404 sur tout le reste. */
function fakeSocle(overrides: Record<string, SocleReply> = {}): SocleClient {
  return {
    async get(path: string): Promise<SocleReply> {
      const override = overrides[path];
      if (override !== undefined) return override;
      if (path in ROUTES) return { kind: "ok", body: ROUTES[path] };
      return { kind: "not_found" };
    },
  };
}

/** Socle éteint : rien ne revient, quel que soit le chemin. */
const downSocle: SocleClient = { get: async () => ({ kind: "unreachable" }) };

/** Requête telle qu'un navigateur la pose depuis le portail d'une collectivité. */
function browserRequest(origin: string | null): Request {
  return new Request("https://portal.example/portal-api/v1/bootstrap", {
    headers: origin === null ? {} : { origin },
  });
}

const NO_DEV = { suffix: null, fallback: null };

/** Le flux du portail, exactement dans l'ordre où l'edge function l'exécute. */
async function visit(
  origin: string | null,
  socle: SocleClient,
  dev: { suffix: string | null; fallback: string | null } = NO_DEV,
  askedLang: string | null = null,
) {
  const hostname = hostnameForRequest(browserRequest(origin), dev);
  const resolution = await resolveTenant(hostname, socle);
  if (!resolution.ok) return { ok: false as const, reason: resolution.reason };
  const lang = resolveLang(askedLang, resolution.tenant.languages);
  const demarches = await getPublicDemarches(resolution.tenant.id, socle, lang);
  if (!demarches.ok) return { ok: false as const, reason: demarches.reason };
  const page = await getPublishedPage(resolution.tenant.id, socle, lang);
  if (!page.ok) return { ok: false as const, reason: page.reason };
  const branding = await getBranding(resolution.tenant.id, socle);
  if (!branding.ok) return { ok: false as const, reason: branding.reason };
  return {
    ok: true as const,
    lang,
    tenant: resolution.tenant,
    demarches: demarches.demarches,
    page: page.page,
    branding: branding.branding,
  };
}

describe("1. domaine connu → tenant correctement identifié", () => {
  it("reconnaît la collectivité derrière le domaine visité", async () => {
    const result = await visit("https://nantes.edilumen.fr", fakeSocle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant).toEqual({
      id: NANTES,
      name: "Ville de Nantes",
      slug: "nantes",
      hostname: "nantes.edilumen.fr",
      languages: ["fr", "en", "br"],
      // Ce Socle simulé ne sert pas de thème : le portail prend les défauts,
      // jamais `null`. C'est ce qui permet à un portail à jour de parler à un
      // Socle d'avant le contrat 1.17.0.
      theme: defaultTheme(),
      // Ni d'assistant (contrat 1.28.0) : il est FERMÉ, jamais absent. Au doute,
      // le portail ne dépense pas le crédit IA d'une collectivité.
      assistant: closedAssistant(),
    });
  });

  it("reconnaît le même domaine écrit autrement (casse, port, point final)", async () => {
    // Un navigateur peut poser une casse mixte, un port explicite ou un point
    // final. La normalisation appartient au portail ; le Socle ne stocke qu'une
    // seule forme, et la comparaison ne doit pas dépendre de l'écriture.
    for (const origin of [
      "https://NANTES.edilumen.fr",
      "https://nantes.edilumen.fr:443",
      "https://nantes.edilumen.fr.",
    ]) {
      const result = await visit(origin, fakeSocle());
      expect(result.ok, origin).toBe(true);
    }
  });
});

describe("2. domaine inconnu → erreur propre", () => {
  it("rend `unknown_domain` pour un domaine rattaché à personne", async () => {
    const result = await visit("https://inconnu.edilumen.fr", fakeSocle());
    expect(result).toEqual({ ok: false, reason: "unknown_domain" });
  });

  it("rend `invalid_hostname` quand aucun domaine n'a pu être déterminé", async () => {
    // Pas d'en-tête Origin (appel hors navigateur) et pas de mode
    // développement : rien ne désigne une collectivité. Distinct d'un domaine
    // inconnu — ici, il n'y a même pas de domaine à chercher.
    expect(await visit(null, fakeSocle())).toEqual({ ok: false, reason: "invalid_hostname" });
    // Bouclage hors développement : idem.
    expect(await visit("http://localhost:5175", fakeSocle())).toEqual({
      ok: false,
      reason: "invalid_hostname",
    });
  });

  it("ne se laisse pas désigner un tenant par le client", async () => {
    // Le navigateur n'a aucun moyen de fournir un identifiant : la seule entrée
    // est l'en-tête Origin, que le JavaScript de la page ne peut pas réécrire.
    // Les paramètres de requête ne font pas partie du contrat — et hors mode
    // développement, ils ne sont même pas lus.
    const request = new Request(
      "https://portal.example/portal-api/v1/bootstrap" +
        "?tenant_id=" + ANGERS + "&hostname=angers.edilumen.fr",
      { headers: { origin: "https://nantes.edilumen.fr" } },
    );
    expect(hostnameForRequest(request, NO_DEV)).toBe("nantes.edilumen.fr");
  });
});

describe("3. tenant connu → bonnes démarches récupérées", () => {
  it("sert les démarches de la collectivité, traduites dans le modèle du portail", async () => {
    const result = await visit("https://nantes.edilumen.fr", fakeSocle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarches).toEqual([
      {
        id: "d1",
        name: "Signaler un problème de voirie",
        description: "Signalez un problème rencontré dans l'espace public.",
        estimatedMinutes: 5,
        organizations: [
          { id: NANTES, name: "Ville de Nantes", slug: "nantes", logoUrl: null, handlingOrganizationId: null },
          {
            id: "q-chantenay",
            name: "Mairie de quartier de Chantenay",
            slug: "mairie-de-chantenay",
            logoUrl: null,
            handlingOrganizationId: null,
          },
        ],
        audiences: ["citoyen"],
        category: { id: "cat-voirie", name: "Voirie", icon: "construction" },
      },
      {
        id: "d2",
        name: "Demander un acte de naissance",
        // Pas de résumé court : le descriptif usager prend le relais, sans quoi
        // la carte n'aurait aucun texte alors que la collectivité en a écrit un.
        description: "Effectuez votre demande en ligne.",
        estimatedMinutes: null,
        organizations: [{ id: NANTES, name: "Ville de Nantes", slug: null, logoUrl: null, handlingOrganizationId: null }],
        // ⚠️ Dans l'ordre du filtre, pas celui du Socle : deux catalogues
        // paramétrés dans un ordre différent doivent se filtrer pareil.
        audiences: ["citoyen", "entreprise"],
        // Un Socle d'avant 1.41.0 ne sert pas la catégorie : pas d'erreur.
        category: null,
      },
    ]);
  });

  it("affiche une démarche sans organismes ni publics — le portail ne décide ni qui la porte, ni pour qui", async () => {
    // Un Socle d'avant ces champs, ou des listes absentes : la démarche est
    // publiée, elle s'affiche ; la carte ne nomme simplement personne, et la
    // démarche ne répond à aucun choix du filtre « Je suis… ».
    const socle = fakeSocle({
      [NANTES_PROCEDURES]: {
        kind: "ok",
        body: [{ id: "d9", name: "Sans organisme", short_description: null, user_description: null }],
      },
    });
    const result = await visit("https://nantes.edilumen.fr", socle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarches).toEqual([
      {
        id: "d9",
        name: "Sans organisme",
        description: null,
        estimatedMinutes: null,
        organizations: [],
        // ⚠️ Vide, jamais « tous publics » : rien n'a été déclaré.
        audiences: [],
        category: null,
      },
    ]);
  });

  it("sert la page composée quand elle existe, et null sinon — sans erreur", async () => {
    const nantes = await visit("https://nantes.edilumen.fr", fakeSocle());
    const angers = await visit("https://angers.edilumen.fr", fakeSocle());
    if (!nantes.ok || !angers.ok) throw new Error("attendu deux succès");
    expect(nantes.page?.sections.map((s) => s.kind)).toEqual(["recherche", "demarches"]);
    // Angers n'a jamais publié : le portail rendra sa mise en page par défaut.
    expect(angers.page).toBeNull();
  });

  it("sert la charte validée quand elle existe, et null sinon — sans erreur", async () => {
    const nantes = await visit("https://nantes.edilumen.fr", fakeSocle());
    const angers = await visit("https://angers.edilumen.fr", fakeSocle());
    if (!nantes.ok || !angers.ok) throw new Error("attendu deux succès");
    expect(nantes.branding).toEqual({
      logoUrl: "https://cdn.example/nantes.svg",
      logoWhiteUrl: null,
      faviconUrl: "https://cdn.example/nantes-favicon.png",
      primaryColor: "#1f8a5b",
      secondaryColor: null,
    });
    expect(angers.branding).toBeNull();
  });

  it("demande les démarches du tenant RÉSOLU, jamais d'un autre", async () => {
    const asked: string[] = [];
    const inner = fakeSocle();
    const spy: SocleClient = {
      get: (path) => {
        asked.push(path);
        return inner.get(path);
      },
    };
    await visit("https://angers.edilumen.fr", spy);
    expect(asked).toEqual([
      "/v1/portal/tenant?hostname=angers.edilumen.fr",
      ANGERS_PROCEDURES,
      "/v1/portal/page?tenant_id=" + ANGERS + "&slug=accueil",
      "/v1/organizations/" + ANGERS + "/branding",
    ]);
  });
});

describe("4. tenant sans démarche publiée → état vide correctement géré", () => {
  it("rend un succès avec une liste vide, pas une erreur", async () => {
    // La distinction porte tout l'écran : une erreur afficherait « service
    // indisponible » à une collectivité qui fonctionne parfaitement et n'a
    // simplement rien publié.
    const result = await visit("https://angers.edilumen.fr", fakeSocle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant.name).toBe("Ville d'Angers");
    expect(result.demarches).toEqual([]);
  });
});

describe("5. Socle indisponible → erreur correctement gérée", () => {
  it("rend `socle_unavailable` quand le Socle ne répond pas", async () => {
    expect(await visit("https://nantes.edilumen.fr", downSocle)).toEqual({
      ok: false,
      reason: "socle_unavailable",
    });
  });

  it("rend `socle_unavailable` si le Socle tombe entre les deux appels", async () => {
    // Le tenant est résolu, les démarches non. L'écran doit dire « réessayez »,
    // et surtout pas « cette adresse n'existe pas ».
    const socle = fakeSocle({ [NANTES_PROCEDURES]: { kind: "unreachable" } });
    expect(await visit("https://nantes.edilumen.fr", socle)).toEqual({
      ok: false,
      reason: "socle_unavailable",
    });
  });

  it("distingue une clé refusée d'une panne, sans le dire au visiteur", async () => {
    // `socle_misconfigured` est une panne d'EXPLOITATION : le code la nomme
    // pour les journaux, le message affiché reste celui d'une indisponibilité.
    const socle: SocleClient = { get: async () => ({ kind: "auth_failed" }) };
    expect(await visit("https://nantes.edilumen.fr", socle)).toEqual({
      ok: false,
      reason: "socle_misconfigured",
    });
  });

  it("traite une réponse illisible comme une indisponibilité", async () => {
    // Un 200 au corps inattendu ne doit pas produire une page au nom vide.
    const socle = fakeSocle({
      "/v1/portal/tenant?hostname=nantes.edilumen.fr": { kind: "ok", body: { id: NANTES } },
    });
    expect(await visit("https://nantes.edilumen.fr", socle)).toEqual({
      ok: false,
      reason: "socle_unavailable",
    });
  });

  it("rend `tenant_unavailable` si la collectivité disparaît après résolution", async () => {
    // L'adresse, elle, était bonne : ce n'est pas `unknown_domain`.
    const socle = fakeSocle({ [NANTES_PROCEDURES]: { kind: "not_found" } });
    expect(await visit("https://nantes.edilumen.fr", socle)).toEqual({
      ok: false,
      reason: "tenant_unavailable",
    });
  });
});

describe("6. changement de hostname → changement de tenant", () => {
  it("sert deux collectivités différentes sans aucun changement de code", async () => {
    // LA propriété du portail multi-tenant : même instance, même configuration,
    // même client Socle — seule l'adresse visitée change.
    const socle = fakeSocle();
    const nantes = await visit("https://nantes.edilumen.fr", socle);
    const angers = await visit("https://angers.edilumen.fr", socle);

    expect(nantes.ok && angers.ok).toBe(true);
    if (!nantes.ok || !angers.ok) return;
    expect(nantes.tenant.id).not.toBe(angers.tenant.id);
    expect(nantes.tenant.name).toBe("Ville de Nantes");
    expect(angers.tenant.name).toBe("Ville d'Angers");
    expect(nantes.demarches).toHaveLength(2);
    expect(angers.demarches).toHaveLength(0);
  });

  it("fait la même chose en local, via `<collectivité>.localhost`", async () => {
    // Le développement doit exercer le MÊME chemin que la production : sans
    // cela, on vérifierait le multi-tenant sur un montage qui n'existe qu'en
    // local. `nantes.localhost` devient `nantes.edilumen.fr`, sans toucher au
    // code entre les deux essais.
    const dev = { suffix: "edilumen.fr", fallback: null };
    const socle = fakeSocle();
    const nantes = await visit("http://nantes.localhost:5175", socle, dev);
    const angers = await visit("http://angers.localhost:5175", socle, dev);

    expect(nantes.ok && angers.ok).toBe(true);
    if (!nantes.ok || !angers.ok) return;
    expect(nantes.tenant.name).toBe("Ville de Nantes");
    expect(angers.tenant.name).toBe("Ville d'Angers");
  });
});

// --- Le flux jusqu'au formulaire -------------------------------------------

const NANTES_DETAIL = "/v1/portal/procedures/d1?tenant_id=" + NANTES;

/** Le détail servi par le Socle, tel que le contrat 1.12.0 le décrit. */
const DETAIL = {
  id: "d1",
  name: "Signaler un problème de voirie",
  short_description: "Signalez un problème rencontré dans l'espace public.",
  user_description: "Le service voirie interviendra sous 5 jours ouvrés.",
  input_duration_minutes: 5,
  organizations: [{ id: NANTES, name: "Ville de Nantes", slug: "nantes" }],
  // Un pictogramme qui n'a pas la forme d'un nom d'icône est écarté à la
  // frontière : la carte dessinera le neutre.
  category: { id: "cat-1", name: "Espace public", icon: "<svg onload=x>" },
  form_schema: {
    version: 1,
    content: [
      { id: "f1", key: "localisation", type: "text", label: "Localisation", required: true },
      { id: "f2", key: "signature", type: "signature", label: "Illisible pour ce portail" },
    ],
  },
  requester_config: {
    citoyen: { enabled: true, fields: { courriel: "obligatoire", nom_usuel: "visible" } },
  },
};

/** Le flux d'une page de démarche, dans l'ordre où l'edge function l'exécute. */
async function openDemarche(
  origin: string,
  demarcheId: string,
  socle: SocleClient,
  askedLang: string | null = null,
) {
  const hostname = hostnameForRequest(browserRequest(origin), NO_DEV);
  const resolution = await resolveTenant(hostname, socle);
  if (!resolution.ok) return { ok: false as const, reason: resolution.reason };
  const lang = resolveLang(askedLang, resolution.tenant.languages);
  return await getPublicDemarche(resolution.tenant.id, demarcheId, socle, lang);
}

describe("7. démarche connue → détail traduit et parsé", () => {
  const socle = () => fakeSocle({ [NANTES_DETAIL]: { kind: "ok", body: DETAIL } });

  it("traduit le détail dans le vocabulaire du portail", async () => {
    const result = await openDemarche("https://nantes.edilumen.fr", "d1", socle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarche.name).toBe("Signaler un problème de voirie");
    expect(result.demarche.description).toBe("Signalez un problème rencontré dans l'espace public.");
    // Le résumé et le descriptif usager restent DEUX champs sur la page d'une
    // démarche : l'un annonce, l'autre explique.
    expect(result.demarche.userDescription).toBe(
      "Le service voirie interviendra sous 5 jours ouvrés.",
    );
    // Pictogramme illisible : `null`, la carte dessinera le neutre.
    expect(result.demarche.category).toEqual({ id: "cat-1", name: "Espace public", icon: null });
  });

  it("parse le formulaire à la frontière, en écartant ce qu'il ne sait pas rendre", async () => {
    // Les écrans reçoivent un schéma déjà nettoyé : ils n'ont jamais à douter
    // de la forme de ce qu'ils affichent.
    const result = await openDemarche("https://nantes.edilumen.fr", "d1", socle());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarche.form?.content).toHaveLength(1);
    expect(result.demarche.requester.citoyen.enabled).toBe(true);
    expect(result.demarche.requester.citoyen.fields.courriel).toBe("obligatoire");
    // Un champ que la collectivité n'a pas ouvert reste masqué par défaut.
    expect(result.demarche.requester.citoyen.fields.adresse).toBe("masque");
  });

  it("une démarche non publiée est introuvable — jamais « existe mais fermée »", async () => {
    // Le Socle rend 404 pour une démarche en brouillon, hors période, interne
    // ou qu'aucun organisme n'active. Le portail ne dit rien de plus : ce
    // serait renseigner sur le paramétrage d'une collectivité.
    const result = await openDemarche("https://nantes.edilumen.fr", "inconnue", fakeSocle());
    expect(result).toEqual({ ok: false, reason: "demarche_unavailable" });
  });

  it("une démarche sans formulaire s'affiche quand même", async () => {
    const sansFormulaire = fakeSocle({
      [NANTES_DETAIL]: { kind: "ok", body: { ...DETAIL, form_schema: null, requester_config: null } },
    });
    const result = await openDemarche("https://nantes.edilumen.fr", "d1", sansFormulaire);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demarche.form).toBeNull();
    // Aucun public ouvert : la démarche se dépose sans identité, et le portail
    // le dit à l'usager plutôt que d'inventer une question.
    expect(result.demarche.requester.citoyen.enabled).toBe(false);
  });

  it("un Socle éteint reste une panne, pas une démarche absente", async () => {
    const result = await getPublicDemarche(NANTES, "d1", downSocle, "fr");
    expect(result).toEqual({ ok: false, reason: "socle_unavailable" });
  });

  it("une clé refusée est une panne de configuration, pas un refus à l'usager", async () => {
    const refuse = fakeSocle({ [NANTES_DETAIL]: { kind: "auth_failed" } });
    const result = await openDemarche("https://nantes.edilumen.fr", "d1", refuse);
    expect(result).toEqual({ ok: false, reason: "socle_misconfigured" });
  });
});

/**
 * La langue du visiteur, de bout en bout.
 *
 * ⚠️ C'est le SERVEUR qui tranche : il ne sert que ce que la collectivité a
 * activé, et il renvoie la langue servie. Sans ce clamp, une langue mémorisée
 * dans un navigateur puis désactivée par la collectivité continuerait d'être
 * demandée indéfiniment, et l'adresse mentirait sur ce qui est affiché.
 */
describe("9. la langue du visiteur", () => {
  it("sert les textes traduits quand la collectivité a activé la langue", async () => {
    const result = await visit("https://nantes.edilumen.fr", fakeSocle(), NO_DEV, "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lang).toBe("en");
    expect(result.demarches[0].name).toBe("Report a road problem");
  });

  it("replie CHAQUE champ séparément : intitulé traduit, résumé français", () => {
    // Le contraire — replier la langue entière parce qu'un champ manque —
    // masquerait un intitulé que la collectivité a bel et bien traduit.
    return visit("https://nantes.edilumen.fr", fakeSocle(), NO_DEV, "en").then((result) => {
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.demarches[0].description).toBe(
        "Signalez un problème rencontré dans l'espace public.",
      );
    });
  });

  it("ramène au français une langue que la collectivité n'a pas activée", async () => {
    const result = await visit("https://nantes.edilumen.fr", fakeSocle(), NO_DEV, "de");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lang).toBe("fr");
    expect(result.demarches[0].name).toBe("Signaler un problème de voirie");
  });

  it("ignore un préfixe d'URL inventé", async () => {
    const result = await visit("https://nantes.edilumen.fr", fakeSocle(), NO_DEV, "xyz!");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lang).toBe("fr");
  });

  it("rend une collectivité sans réglage monolingue, jamais sans langue", async () => {
    // Angers n'a pas de `languages` dans la réponse simulée (Socle d'avant le
    // contrat 1.11.0, ou réglage jamais touché).
    const result = await visit("https://angers.edilumen.fr", fakeSocle(), NO_DEV, "en");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tenant.languages).toEqual(["fr"]);
    expect(result.lang).toBe("fr");
  });
});

// ── 10. Le courrier libre — Socle simulé (`free_mail`), Clara simulé ─────────
//
// Le dépôt suit l'ordre de `POST /v1/courriers` (`depositCourrier`) : la
// collectivité a été résolue par `Origin`, l'organisme visé est cherché parmi
// les SIENS au Socle, et le courrier part à Clara en multipart, avec la clé du
// portail. Clara est un vrai client (`createClaraClient`) devant un `fetch`
// simulé : c'est ce qui part réellement sur le fil qu'on relit.

const NANTES_ORGANIZATIONS = "/v1/portal/organizations?tenant_id=" + NANTES;
const CHANTENAY_ID = "q-chantenay";
const ROCHE_ID = "8f1e0d3a-0000-4000-8000-0000000000aa";

/** `GET /v1/portal/organizations` du Socle 1.38.0, avec `free_mail`. */
const ORGANISMES_NANTES = [
  { id: NANTES, name: "Ville de Nantes", slug: "nantes", is_tenant: true, info: {}, free_mail: { enabled: true, title: null } },
  {
    id: CHANTENAY_ID,
    name: "Mairie de quartier de Chantenay",
    slug: "mairie-de-chantenay",
    is_tenant: false,
    info: {},
    free_mail: { enabled: true, title: "Écrire à votre mairie de quartier" },
  },
  // Reçoit du courrier, mais ne publie AUCUNE démarche : il a quand même une page.
  { id: ROCHE_ID, name: "Mairie de quartier de la Roche", slug: "mairie-de-la-roche", is_tenant: false, info: {}, free_mail: { enabled: true, title: null } },
  // Fermé au Socle (ou collectivité non abonnée à Clara).
  { id: "q-doulon", name: "Mairie de quartier de Doulon", slug: "mairie-de-doulon", is_tenant: false, info: {}, free_mail: { enabled: false, title: null } },
];

const CONSENTS_OK = JSON.stringify([
  { kind: "traitement", granted: true },
  { kind: "partage", granted: false },
]);

/** L'envoi du navigateur, tel que `sendCourrier` le compose. */
function courrierForm(overrides: Record<string, string | null> = {}, files: File[] = []): FormData {
  const fields: Record<string, string | null> = {
    organisme: "mairie-de-chantenay",
    submission_id: "6f1c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f",
    subject: "Banc cassé square Maurice-Schwob",
    body: "Bonjour, un banc est cassé depuis dix jours.",
    sender_category: "citoyen",
    sender_civilite: "madame",
    sender_first_name: "Camille",
    sender_last_name: "Martin",
    sender_email: "camille@example.org",
    sender_phone: "",
    consents: CONSENTS_OK,
    ...overrides,
  };
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) if (value !== null) form.append(name, value);
  for (const file of files) form.append("files", file, file.name);
  return form;
}

/** Clara simulé : enregistre ce qu'il reçoit, répond ce qu'on lui dit. */
function fakeClara(status = 200, body: unknown = { ok: true, courier_id: "c-1", reference: "COU-2026-00042" }) {
  const received: { url: string; authorization: string | null; form: Promise<FormData> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const request = new Request(url, init);
      received.push({ url, authorization: request.headers.get("authorization"), form: request.formData() });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return {
    client: createClaraClient({ url: "https://clara.test/functions/v1/nora-courrier", apiKey: "clara_cle" }),
    received,
  };
}

const OPEN_GATE = async () => "open" as const;

function socleWithOrganismes(organismes: unknown = ORGANISMES_NANTES): SocleClient {
  return fakeSocle({ [NANTES_ORGANIZATIONS]: { kind: "ok", body: organismes } });
}

describe("10. le courrier libre", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("relaie le courrier à Clara : Bearer, champs du contrat, UUID Socle, consentements, fichiers", async () => {
    const clara = fakeClara();
    const pdf = new File(["%PDF-1.7 contenu"], "photo-du-banc.pdf", { type: "application/pdf" });
    const outcome = await depositCourrier({
      form: courrierForm({}, [pdf]),
      tenantId: NANTES,
      socle: socleWithOrganismes(),
      clara: clara.client,
      checkChallenge: OPEN_GATE,
    });

    expect(outcome).toEqual({
      ok: true,
      receipt: { reference: "COU-2026-00042", duplicate: false, organismeName: "Mairie de quartier de Chantenay" },
    });
    expect(clara.received).toHaveLength(1);
    expect(clara.received[0].url).toBe("https://clara.test/functions/v1/nora-courrier");
    expect(clara.received[0].authorization).toBe("Bearer clara_cle");
    const sent = await clara.received[0].form;
    expect(sent.get("socle_organization_id")).toBe(CHANTENAY_ID);
    expect(sent.get("submission_id")).toBe("6f1c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f");
    expect(sent.get("subject")).toBe("Banc cassé square Maurice-Schwob");
    expect(sent.get("body")).toBe("Bonjour, un banc est cassé depuis dix jours.");
    expect(sent.get("sender_category")).toBe("citoyen");
    expect(sent.get("sender_civilite")).toBe("madame");
    expect(sent.get("sender_first_name")).toBe("Camille");
    expect(sent.get("sender_last_name")).toBe("Martin");
    expect(sent.get("sender_email")).toBe("camille@example.org");
    // Un champ vide ne part pas : il écraserait une information par un blanc.
    expect(sent.has("sender_phone")).toBe(false);
    expect(sent.get("consent_traitement")).toBe("true");
    expect(sent.get("consent_partage")).toBe("false");
    // Rien du protocole du portail ne fuit vers Clara.
    expect(sent.has("organisme")).toBe(false);
    expect(sent.has("consents")).toBe(false);
    const files = sent.getAll("files") as File[];
    expect(files.map((f) => f.name)).toEqual(["photo-du-banc.pdf"]);
    expect(await files[0].text()).toBe("%PDF-1.7 contenu");
  });

  it("sans slug, le courrier va à la collectivité ; un rejeu rend le même courrier", async () => {
    const clara = fakeClara(200, { ok: true, courier_id: "c-1", reference: null, duplicate: true });
    const outcome = await depositCourrier({
      form: courrierForm({ organisme: null }),
      tenantId: NANTES,
      socle: socleWithOrganismes(),
      clara: clara.client,
      checkChallenge: OPEN_GATE,
    });
    expect(outcome).toEqual({ ok: true, receipt: { reference: null, duplicate: true, organismeName: "Ville de Nantes" } });
    expect((await clara.received[0].form).get("socle_organization_id")).toBe(NANTES);
  });

  it("⚠️ organisme fermé, inconnu, ou Socle sans `free_mail` → 404, et Clara n'est jamais appelée", async () => {
    const clara = fakeClara();
    const avant138 = ORGANISMES_NANTES.map(({ free_mail: _ignore, ...rest }) => rest);
    const cases: [FormData, SocleClient][] = [
      [courrierForm({ organisme: "mairie-de-doulon" }), socleWithOrganismes()],
      [courrierForm({ organisme: "mairie-d-ailleurs" }), socleWithOrganismes()],
      [courrierForm(), socleWithOrganismes(avant138)],
      // Route absente (Socle d'avant 1.30.0) : personne ne reçoit de courrier.
      [courrierForm(), fakeSocle()],
    ];
    for (const [form, socle] of cases) {
      const outcome = await depositCourrier({ form, tenantId: NANTES, socle, clara: clara.client, checkChallenge: OPEN_GATE });
      expect(outcome).toEqual({ ok: false, failure: "courrier_unavailable" });
    }
    expect(httpStatusForCourrierFailure("courrier_unavailable")).toBe(404);
    expect(clara.received).toHaveLength(0);
  });

  it("refuse avant tout relais : champ manquant, consentement, identifiant, fichier trop gros ou hors format", async () => {
    const clara = fakeClara();
    const run = (form: FormData) =>
      depositCourrier({ form, tenantId: NANTES, socle: socleWithOrganismes(), clara: clara.client, checkChallenge: OPEN_GATE });

    expect(await run(courrierForm({ subject: " " }))).toMatchObject({ failure: "invalid_courrier" });
    expect(await run(courrierForm({ sender_email: "", sender_phone: "" }))).toMatchObject({ failure: "invalid_courrier" });
    expect(await run(courrierForm({ consents: null }))).toMatchObject({ failure: "invalid_courrier" });
    expect(
      await run(courrierForm({ consents: JSON.stringify([{ kind: "traitement", granted: false }]) })),
    ).toMatchObject({ failure: "invalid_courrier" });
    // Un `statement` envoyé du navigateur est refusé : seuls `kind` et `granted`.
    expect(
      await run(courrierForm({ consents: JSON.stringify([{ kind: "traitement", granted: true, statement: "x" }]) })),
    ).toMatchObject({ failure: "invalid_courrier" });
    expect(await run(courrierForm({ submission_id: "pas-un-uuid" }))).toMatchObject({ failure: "invalid_courrier" });
    expect(await run(courrierForm({ sender_category: "collectivite" }))).toMatchObject({ failure: "invalid_courrier" });
    const gros = new File([new Uint8Array(5 * 1_048_576 + 1)], "scan.pdf");
    expect(await run(courrierForm({}, [gros]))).toMatchObject({ failure: "file_too_large" });
    expect(await run(courrierForm({}, [new File(["MZ"], "setup.exe")]))).toMatchObject({ failure: "file_unsupported" });
    const png = new File(["x"], "a.png");
    expect(await run(courrierForm({}, [png, png, png, png]))).toMatchObject({ failure: "invalid_courrier" });
    expect(clara.received).toHaveLength(0);
  });

  it("la porte anti-robot passe avant le Socle et Clara", async () => {
    const clara = fakeClara();
    const seen: string[] = [];
    const outcome = await depositCourrier({
      form: courrierForm(),
      tenantId: NANTES,
      socle: {
        get: async (path) => {
          seen.push(path);
          return { kind: "ok", body: ORGANISMES_NANTES };
        },
      },
      clara: clara.client,
      checkChallenge: async () => "challenge_required",
    });
    expect(outcome).toEqual({ ok: false, failure: "challenge_required" });
    expect(seen).toEqual([]);
    expect(clara.received).toHaveLength(0);
  });

  it("traduit chaque réponse de Clara — jamais son message brut vers l'usager", async () => {
    const cases: [number, unknown, string][] = [
      [400, { error: "validation", message: "body trop long" }, "courrier_rejected"],
      [401, { error: "unauthorized" }, "clara_misconfigured"],
      [404, { error: "organisme_inconnu" }, "courrier_undeliverable"],
      [409, { error: "organisme_ambigu" }, "courrier_undeliverable"],
      [500, { error: "internal", message: "relation couriers does not exist" }, "clara_unavailable"],
      // 200 sans preuve de courrier : on n'annonce pas un envoi réussi.
      [200, { ok: true }, "clara_unavailable"],
    ];
    for (const [status, body, failure] of cases) {
      const clara = fakeClara(status, body);
      const outcome = await depositCourrier({
        form: courrierForm(),
        tenantId: NANTES,
        socle: socleWithOrganismes(),
        clara: clara.client,
        checkChallenge: OPEN_GATE,
      });
      expect(outcome.ok, String(status)).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.failure, String(status)).toBe(failure);
      // Ce que l'usager lira : la phrase du portail, pas celle de Clara.
      expect(COURRIER_MESSAGES[outcome.failure]).not.toMatch(/couriers|trop long/);
    }
  });

  it("un Socle muet est une panne, pas un organisme fermé", async () => {
    const clara = fakeClara();
    const outcome = await depositCourrier({
      form: courrierForm(),
      tenantId: NANTES,
      socle: downSocle,
      clara: clara.client,
      checkChallenge: OPEN_GATE,
    });
    expect(outcome).toMatchObject({ ok: false, failure: "socle_unavailable" });
    expect(clara.received).toHaveLength(0);
  });

  it("⚠️ un organisme qui reçoit du courrier a une page et une entrée « Ma ville », même sans démarche", async () => {
    // Ce que fait `GET /v1/bootstrap` : le catalogue, puis le courrier libre.
    const socle = socleWithOrganismes();
    const catalogue = await getPublicDemarches(NANTES, socle, "fr");
    const courrier = await getCourrierOrganismes(NANTES, socle);
    if (!catalogue.ok || !courrier.ok) throw new Error("lecture attendue");

    const villes = villesOf(catalogue.demarches, NANTES, courrierPages(courrier.organismes));
    expect(villes.map((v) => v.slug)).toEqual(["mairie-de-chantenay", "mairie-de-la-roche"]);
    // Chantenay publie : il vient du catalogue. La Roche ne publie rien : il
    // vient du courrier libre. Doulon (fermé) n'apparaît pas.
    expect(organizationBySlug(catalogue.demarches, "mairie-de-la-roche", NANTES)).toBeNull();
    expect(courrierPageBySlug(courrier.organismes, "mairie-de-la-roche")).toMatchObject({ id: ROCHE_ID });
    expect(courrierPageBySlug(courrier.organismes, "mairie-de-doulon")).toBeNull();
    // Sans `free_mail` (Socle d'avant 1.38.0), rien ne change.
    expect(villesOf(catalogue.demarches, NANTES).map((v) => v.slug)).toEqual(["mairie-de-chantenay"]);
  });
});
