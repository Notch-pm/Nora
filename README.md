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
   │  3. GET /v1/portal/procedures?tenant_id=… → démarches publiées
   │  4. GET /v1/portal/page?tenant_id=…       → page d'accueil publiée (404 = jamais publiée)
   ▼
API publique du Socle
```

La page d'accueil est **composée par la collectivité** dans l'éditeur CMS du
Socle (sections typées, démarches à la une, recherche). Le portail ne rend que
ce qui a été **publié** — le brouillon n'a pas de route — et retombe sur une
liste de démarches quand rien ne l'a encore été. Une section que ce portail ne
connaît pas est ignorée, pas rendue à moitié.

## Architecture

```
src/
  services/portal/       Ce que l'interface consomme. Le SEUL fetch du navigateur.
    portalClient.ts        appelle portal-api (jamais le Socle)
    portalService.ts       getCurrentTenant() / getPublicDemarches(), mémoïsés
  features/portal/       Les écrans. Ne connaissent ni URL, ni Socle, ni domaine.

supabase/functions/
  _shared/
    domain/              Le modèle du PORTAIL — Tenant, Demarche, PortalFailure.
    socle/               Le seul code qui connaisse la forme des réponses du Socle.
      socleClient.ts       port HTTP + implémentation
      cachedSocleClient.ts décorateur de cache
      tenantService.ts     resolveTenant(hostname)
      demarcheService.ts   getPublicDemarches(tenantId)
    http/                Mise en forme et détermination du nom d'hôte.
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
démarche publiée, Socle indisponible, et changement de hostname.

## Ce qui n'est pas encore fait

Personnalisation graphique par collectivité (le Socle la sert déjà, héritage
résolu, sur `/v1/organizations/{id}/branding`), authentification usager, création
de demandes, intégration Iris.
