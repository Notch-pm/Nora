# Nora — portail usagers Edilumen

Application web **publique** par laquelle un usager consulte les démarches en
ligne de sa collectivité.

Une **instance unique** sert toutes les collectivités. Elle n'en connaît aucune :
elle demande au Socle à qui appartient le domaine visité.

```
nantes.edilumen.fr  →  tenant Nantes  →  démarches de Nantes
angers.edilumen.fr  →  tenant Angers  →  démarches d'Angers
```

**Ajouter une collectivité au portail ne demande aucun déploiement** — une ligne
dans les domaines du Socle suffit.

## Principe

Le Socle est la source de vérité. Le portail en est un **client**, rien d'autre.

Il n'a **aucune base de données** : ni table de tenants, ni copie des démarches,
ni mapping de domaines. La seule configuration propre à une collectivité vit au
Socle, dans `organization_domains`.

```
Navigateur (nantes.edilumen.fr)
   │  aucune clé, aucun identifiant de tenant
   ▼
portal-api  (edge function — détient SOCLE_API_KEY)
   │  1. le domaine visité, déduit de l'en-tête Origin
   │  2. GET /v1/portal/tenant?hostname=…      → { id, name, … }
   │  3. GET /v1/portal/procedures?tenant_id=… → démarches publiées, avec qui les propose
   │  4. GET /v1/portal/page?tenant_id=…       → page d'accueil publiée (404 = jamais publiée)
   │  5. GET /v1/organizations/{id}/branding   → charte graphique, héritage résolu (décorative)
   ▼
API publique du Socle
```

La **charte graphique** (logo, couleur principale, couleur secondaire) vient
du Socle, héritage déjà résolu. Elle est décorative : absente ou indisponible,
le portail garde les couleurs de la gamme, il ne tombe pas en erreur. Les
couleurs n'entrent que sous la forme `#rrggbb` et les logos qu'en `https` —
ce sont des valeurs injectées dans la page, on ne les « nettoie » pas, on les
écarte. Les composants ne connaissent que deux variables CSS,
`--brand-primary` et `--brand-secondary`.

La page d'accueil est **composée par la collectivité** dans l'éditeur CMS du
Socle (sections typées, démarches à la une, recherche). Le portail ne rend que
ce qui a été **publié** — le brouillon n'a pas de route — et retombe sur une
liste de démarches quand rien ne l'a encore été. Une section que ce portail ne
connaît pas est ignorée, pas rendue à moitié.

## Architecture

```
src/
  services/portal/       Ce que l'interface consomme. Le SEUL fetch du navigateur.
    portalClient.ts        appelle portal-api (jamais le Socle) — un seul GET /v1/bootstrap
    portalService.ts       getCurrentTenant() / getPublicDemarches() / getHomePage() /
                           getBranding(), mémoïsés sur un même instantané
  features/portal/       Les écrans. Ne connaissent ni URL, ni Socle, ni domaine.
    PortalPage.tsx         états (chargement, erreurs, repli en liste), puis la composition
    HomeComposition.tsx    la page d'accueil composée ; possède l'état de recherche
    sections/              un composant par kind : Recherche, Demarches, Compte, Texte, Footer
                           + DemarcheCard (la carte, partagée avec le repli) et OrganizationFilter
    composition.ts         règles pures : filtres (recherche, organisme), organismes du filtre,
                           ordre des épinglées, raccourcis, colonnes, luminance, message de grille
                           vide, « le pied de page final est le bas de la page »
    theme.ts               la charte → variables CSS --brand-primary / --brand-secondary
    errorMessages.ts       un message par PortalFailure

supabase/functions/
  _shared/
    domain/              Le modèle du PORTAIL — Tenant, Demarche, HomePage, Branding, PortalFailure.
    socle/               Le seul code qui connaisse la forme des réponses du Socle.
      socleClient.ts       port HTTP + implémentation
      cachedSocleClient.ts décorateur de cache
      tenantService.ts     resolveTenant(hostname)
      demarcheService.ts   getPublicDemarches(tenantId)
      pageService.ts       getPublishedPage(tenantId) — traduit, filtre, valide les couleurs
      brandingService.ts   getBranding(tenantId) — décoratif, se dégrade en null
    http/                Mise en forme et détermination du nom d'hôte.
    portalFlow.test.ts   le flux complet contre un Socle simulé
  portal-api/index.ts    Plomberie HTTP. Toutes les règles sont dans _shared/.
```

Deux frontières portent tout le découplage :

- **`domain/`** définit le vocabulaire du portail (`description`,
  `estimatedMinutes`). Le Socle parle `short_description` et
  `input_duration_minutes` ; la traduction se fait dans `socle/`, en un seul
  endroit. Un renommage de champ au Socle ne remonte pas jusqu'aux écrans.
- **`SocleClient`** est un port. Les règles se testent sans réseau, et le cache
  s'ajoute en décorant le port sans toucher aux services.

Aucun composant d'interface n'appelle le Socle. Le navigateur n'a pas de clé, et
n'a pas à en avoir.

## La page d'accueil composée

Ce que la collectivité compose dans l'éditeur du Socle arrive ici comme une
liste ordonnée de sections typées. Règles de rendu, toutes dans
`pageService.ts` (traduction) et `composition.ts` (rendu) :

- **Publié seulement.** Le brouillon n'a pas de route. 404 = jamais publiée →
  repli sur une liste de démarches, ce n'est pas une erreur.
- **On ne garde que ce qu'on sait rendre.** `actus` (rien à afficher) et tout
  kind inconnu sont ignorés, pas rendus à moitié : le Socle peut apprendre un
  bloc avant ce portail.
- **Les références sont déjà résolues.** `pinned` et `shortcuts` ne contiennent
  que des démarches publiées, le Socle a écarté les autres.
- **Les démarches sont celles que l'arbre propose.** Le Socle ne sert que les
  démarches en `production`, `externe`, visibles et dans leur période, **et
  activées par au moins un organisme** de la collectivité (elle-même ou une
  de ses communes / services). Chaque démarche porte `organizations` : la
  carte nomme qui la propose, et un filtre « Organisme » (`OrganizationFilter`,
  masqué s'il n'y a qu'un organisme) ne garde que ce qu'un organisme propose.
  La liste du filtre est l'union des organismes du catalogue, la collectivité
  visitée en tête puis par nom — un organisme qui ne propose rien n'y figure
  pas.
- **La recherche est réelle.** Le champ de la section `recherche` filtre les
  grilles `demarches` de la page (normalisation sans accents ni casse) ; sans
  section `recherche`, aucun filtre. Recherche et organisme se cumulent, et
  valent pour toutes les grilles de la page.
- **Le pied de page final est le bas de la page.** Pleine largeur, hors du
  conteneur centré, poussé au bord ; la page perd sa marge basse. Sa couleur
  n'entre que sous la forme `#rrggbb`, le texte passe en clair ou en sombre
  selon la luminance.
- **Le bloc « Espace usager » est décoratif** tant qu'il n'y a pas de compte.

## Sécurité

Le nom d'hôte est une donnée **non fiable**, et il est déterminé **côté serveur**.

`portal-api` le tire de l'en-tête `Origin`, que le JavaScript d'une page ne peut
pas réécrire. Le navigateur n'envoie ni domaine ni identifiant de tenant : il n'y
a rien à falsifier dans la requête.

Un client hors navigateur peut évidemment poser l'`Origin` qu'il veut. Cela ne
lui ouvre rien : il obtient le catalogue **public** d'une collectivité, celui que
son portail sert déjà à tout visiteur. La confidentialité ne repose pas sur cet
en-tête, mais sur ce que le Socle accepte de publier.

Un domaine inconnu, hors du périmètre de la clé, ou dont la collectivité est
obsolète reçoivent le **même 404** : le portail ne renseigne pas sur l'existence
des collectivités du référentiel.

## Démarrage

```bash
npm install
cp .env.example .env.local   # puis renseigner VITE_PORTAL_API_URL
npm run dev                  # http://nantes.localhost:5175
```

Secrets serveur (jamais dans un fichier `VITE_*`) :

```bash
supabase link --project-ref <ref>
supabase secrets set \
  SOCLE_API_URL=https://<ref-socle>.supabase.co/functions/v1/public-api \
  SOCLE_API_KEY=<clé plateforme, scope read>
supabase functions deploy portal-api
```

La clé doit être une clé **plateforme** du Socle (sans organisation rattachée) :
le portail sert toutes les collectivités, une clé liée à une seule n'en
résoudrait que les domaines.

## Tester plusieurs collectivités en local

Les navigateurs résolvent tout `*.localhost` vers la machine locale. Avec
`PORTAL_DEV_DOMAIN_SUFFIX=edilumen.fr` posé sur `portal-api` :

| URL ouverte                     | Domaine résolu       |
| ------------------------------- | -------------------- |
| `http://nantes.localhost:5175`  | `nantes.edilumen.fr` |
| `http://angers.localhost:5175`  | `angers.edilumen.fr` |

On vérifie ainsi « hostname A → tenant A, hostname B → tenant B » en changeant
d'onglet, **sans toucher au code**. Ce réglage n'a aucun effet sur un domaine
réel : un visiteur d'`angers.edilumen.fr` ne peut pas être détourné, même si la
variable traînait en production.

⚠️ Aujourd'hui, aucun domaine réel n'existe : la variable est posée sur la
fonction **déployée**, et la seule collectivité de test (ACCM) est servie par
`laurentville.localhost:5175` ↔ `laurentville.edilumen.fr`. À retirer de la
fonction déployée dès le premier domaine réel.

## Cache

Deux caches, tous deux volontairement rudimentaires et coupables par
configuration :

| Où                | Variable                        | Défaut | `0` |
| ----------------- | ------------------------------- | ------ | --- |
| `portal-api`      | `PORTAL_CACHE_TTL_SECONDS`      | 60 s   | désactive |
| Onglet            | `VITE_PORTAL_CACHE_TTL_SECONDS` | 60 s   | désactive |

Le cache serveur mémorise aussi les **404** : un domaine inconnu est un fait
stable, et un balayage de sous-domaines ne doit pas se traduire en autant
d'appels au Socle. Il ne mémorise **jamais** une panne — cela la ferait durer
après le rétablissement.

## Tests

```bash
npm test        # logique pure + client HTTP contre un vrai serveur
npm run build   # tsc -b puis build de production
```

`supabase/functions/_shared/portalFlow.test.ts` couvre le flux complet contre un
Socle simulé : domaine connu, domaine inconnu, démarches d'un tenant, tenant sans
démarche publiée, Socle indisponible, et changement de hostname. Les services
(`pageService`, `brandingService`, cache) et les règles de rendu
(`composition.ts`, `theme.ts`) ont chacun leurs tests, sans réseau.

## Ce qui n'est pas encore fait

Dans l'ordre prévu — le détail, les prérequis côté Socle et les questions
ouvertes sont dans `docs/roadmap.md` du Socle, section « Portail usagers » :

1. les démarches **pour de vrai** (page par démarche, formulaire depuis
   `form_schema`, création de la demande vers Iris) ;
2. le **multilingue** ;
3. les **autres templates** (thème, autres pages que l'accueil, actualités) ;
4. les démarches **hors compte** (confirmation par courriel, lien de suivi) ;
5. les démarches **avec compte** (espace usager, rattaché au référentiel
   `contacts` du Socle) ;
6. la **création de compte** ;
7. les **échanges** usager ↔ agent sur une demande ;
8. les **pièces jointes** ;
9. **FranceConnect** — à instruire (habilitation, périmètre).

Transverse : accessibilité RGAA et mentions obligatoires d'un site public,
premier domaine réel.
