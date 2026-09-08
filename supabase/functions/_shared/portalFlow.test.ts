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
import { describe, expect, it } from "vitest";
import { hostnameForRequest } from "./http/requestHostname.ts";
import { getPublicDemarche, getPublicDemarches } from "./socle/demarcheService.ts";
import { resolveLang } from "./domain/languages.ts";
import { getPublishedPage } from "./socle/pageService.ts";
import { getBranding } from "./socle/brandingService.ts";
import { resolveTenant } from "./socle/tenantService.ts";
import type { SocleClient, SocleReply } from "./socle/socleClient.ts";

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
        { id: NANTES, name: "Ville de Nantes" },
        { id: "q-chantenay", name: "Mairie de quartier de Chantenay" },
        // Illisibles : une puce sans nom ne nomme personne, elle est écartée.
        { id: "sans-nom", name: "" },
        "pas-un-objet",
      ],
    },
    {
      id: "d2",
      name: "Demander un acte de naissance",
      short_description: null,
      user_description: "Effectuez votre demande en ligne.",
      input_duration_minutes: null,
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
          { id: NANTES, name: "Ville de Nantes" },
          { id: "q-chantenay", name: "Mairie de quartier de Chantenay" },
        ],
        audiences: ["citoyen"],
      },
      {
        id: "d2",
        name: "Demander un acte de naissance",
        // Pas de résumé court : le descriptif usager prend le relais, sans quoi
        // la carte n'aurait aucun texte alors que la collectivité en a écrit un.
        description: "Effectuez votre demande en ligne.",
        estimatedMinutes: null,
        organizations: [{ id: NANTES, name: "Ville de Nantes" }],
        // ⚠️ Dans l'ordre du filtre, pas celui du Socle : deux catalogues
        // paramétrés dans un ordre différent doivent se filtrer pareil.
        audiences: ["citoyen", "entreprise"],
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
  organizations: [{ id: NANTES, name: "Ville de Nantes" }],
  category: { id: "cat-1", name: "Espace public" },
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
    expect(result.demarche.category).toEqual({ id: "cat-1", name: "Espace public" });
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
