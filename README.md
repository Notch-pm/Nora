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
portal-api  (edge function — détient SOCLE_API_KEY et IRIS_API_KEY)
   │  1. le domaine visité, déduit de l'en-tête Origin
   │  2. GET /v1/portal/tenant?hostname=…      → { id, name, … }
   │  3. GET /v1/portal/procedures?tenant_id=… → démarches publiées, avec qui les propose
   │  4. GET /v1/portal/procedures/{id}?…      → une démarche + form_schema + requester_config
   │  5. GET /v1/portal/page?tenant_id=…       → page d'accueil publiée (404 = jamais publiée)
   │  6. GET /v1/organizations/{id}/branding   → charte graphique, héritage résolu (décorative)
   ▼
API publique du Socle

portal-api
   │  au dépôt d'une demande, après avoir REVÉRIFIÉ la démarche au catalogue publié
   │  POST /v1/requests  → { created, request: { reference, status, … } }
   ▼
API d'ingestion d'Iris (requests-api)
```

La **charte graphique** (logo, logo blanc, favicon, couleur principale, couleur
secondaire) vient du Socle, héritage déjà résolu. Elle est décorative : absente
ou indisponible, le portail garde les couleurs de la gamme, il ne tombe pas en
erreur. Les couleurs n'entrent que sous la forme `#rrggbb` et les images qu'en
`https` — ce sont des valeurs injectées dans la page, on ne les « nettoie »
pas, on les écarte.

Le **favicon** est le seul élément de la charte qui ne se peigne pas dans la
page : il se pose en `<link rel="icon">` (`features/portal/favicon.ts`), le
portail étant une instance unique dont l'`index.html` est commun à toutes les
collectivités. ⚠️ **Son absence n'est pas un effacement** : sans favicon publié,
l'onglet garde l'icône que le navigateur affichait — le portail n'en a pas
d'autre à mettre à la place.

Le **thème** vient du Socle lui aussi (`Tenant.theme`), réglé par la
collectivité dans l'éditeur : typographie, formes, densité, en-tête,
accessibilité. Il ne porte **aucune couleur** — le thème dit comment peindre,
la charte dit avec quoi. Il vaut pour **toutes les pages**, l'accueil comme le
formulaire d'une démarche : un usager qui dépose une demande ne doit pas avoir
l'impression de changer de site.

Charte et thème arrivent ensemble dans **un seul objet de style** posé sur la
racine de la page (`themeStyle`) ; tout le portail lit des variables CSS
(`--brand-*` pour les couleurs appliquées, `--pt-*` pour le thème). C'est ce
qui rend le thème gratuit : quelques centaines d'octets de style, pas une
requête de plus.

⚠️ **Sauf la police**, seul réglage qui se télécharge — et elle est
**auto-hébergée** (`public/fonts/`, SIL Open Font License 1.1). La charger
depuis Google Fonts enverrait l'adresse IP de chaque visiteur à un tiers, sans
base légale, sur le site d'une collectivité. Les trois familles sont déclarées
une fois dans `index.html` ; un `@font-face` restant inerte tant qu'aucun texte
ne l'utilise, **seule la famille choisie est chargée** (≈ 35 Ko), et
« Système » ne charge rien du tout.

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
  features/portal/       L'accueil. Ne connaît ni URL, ni Socle, ni domaine.
    PortalPage.tsx         états (chargement, erreurs, repli en liste), puis la composition
    HomeComposition.tsx    la page d'accueil composée ; possède l'état de recherche
    PageHeader.tsx         l'en-tête, partagé avec les pages d'une démarche
    sections/              un composant par kind : Recherche, Demarches, Compte, Texte,
                           TexteImage, Footer + DemarcheCard (la carte, partagée avec le repli),
                           OrganizationFilter et AudienceFilter
    composition.ts         règles pures : filtres (recherche, organisme, public), organismes et
                           publics du filtre, ordre des épinglées, raccourcis, colonnes,
                           message de grille vide, « le pied de page final est le bas de la page »
    theme.ts               la charte → --brand-* ; mémoire de la dernière charte connue
    favicon.ts             l'icône de l'onglet ; l'absence de favicon n'efface rien
    themeStyle.ts          le thème + la charte → toutes les variables CSS de la page, et le
                           choix de l'encre lisible sur un fond (`readableInk`, `isDarkColor`)
                           (miroir de `Socle/src/features/portal/themeStyle.ts`)
    AccessibilityNotice.tsx la mention RGAA, au pied de TOUTES les pages, et son lien vers
                           `/accessibilite` ; `AccessibilityFooter` ne pose le `<footer>` que
                           s'il a quelque chose à porter
    Markdown.tsx           l'arbre de `domain/markdown.ts` → éléments React, titres décalés d'un
                           niveau ; sert la déclaration d'accessibilité et le descriptif usager
  features/accessibilite/ La déclaration d'accessibilité (`/accessibilite`).
    AccessibilitePage.tsx  la page, dans le cadre d'une démarche (`DemarcheShell`)
    SkipLink.tsx           le lien d'évitement, premier tabulable de chaque écran (RGAA 12.7)
    errorMessages.ts       un message par PortalFailure
  features/demarche/     La démarche : la lire, la remplir, la déposer.
    DemarchePage.tsx       la présentation, en deux colonnes : fil d'Ariane, puis en cartes le
                           descriptif (Markdown), le public concerné, les pièces, la FAQ usager
                           (repliable) ; à côté, « L'essentiel » — le bouton, temps de saisie,
                           délai de traitement, organismes — qui suit le défilement
    pieces.ts              règle pure : pièces ANNONCÉES et pièces du FORMULAIRE, jamais fondues
    responseDelay.ts       le délai de traitement en toutes lettres, unité de la donnée
    FormulairePage.tsx     le formulaire, le dépôt, l'accusé
    FormFields.tsx         un contrôle par type de champ — le rendu de référence côté usager
    RequesterSection.tsx   « Vos informations » (`fieldset`) : l'identité, pilotée par
                           requester_config, et TOUJOURS les consentements — le bloc s'affiche
                           même quand la collectivité ne demande aucune identité
    ConsentFields.tsx      les deux cases RGPD, phrases exactes de ce qu'Iris consignera
    autocomplete.ts        le jeton `autocomplete` de chaque champ d'identité (RGAA 11.13)
    DemarcheShell.tsx      le cadre commun (charte, en-tête, chargement, erreur)
    useDemarche.ts         le chargement d'une démarche

supabase/functions/
  _shared/
    domain/              Le modèle du PORTAIL — Tenant, Demarche, HomePage, Branding, PortalTheme,
                         PortalFailure, Demande, plus les MIROIRS du schéma possédé par le Socle :
                         formSchema.ts + conditions.ts (lecture tolérante), requesterConfig.ts,
                         userCommunication.ts et theme.ts (snake_case du contrat → camelCase du
                         portail), et consents.ts — miroir du catalogue FERMÉ des consentements
                         RGPD d'Iris (défauts, validation d'écran, garde serveur). Et markdown.ts — Markdown → ARBRE, jamais → HTML —, ici parce
                         que le serveur en tire le résumé d'une carte (`markdownSummary`).
                         Et formulaire.ts — règles pures du formulaire : visibilité, obligation,
                         validation, form_data, identité —, ici pour que le serveur puisse
                         appliquer les mêmes règles que l'écran (l'écran l'importe par `@fn`).
    socle/               Le seul code qui connaisse la forme des réponses du Socle.
      urls.ts              `https` absolue ou rien — la règle des URL posées dans la page
      socleClient.ts       port HTTP + implémentation
      cachedSocleClient.ts décorateur de cache
      tenantService.ts     resolveTenant(hostname)
      demarcheService.ts   getPublicDemarches(tenantId) / getPublicDemarche(tenantId, id)
      pageService.ts       getPublishedPage(tenantId) — traduit, filtre, valide les couleurs
      brandingService.ts   getBranding(tenantId) — décoratif, se dégrade en null
    iris/                Le seul code qui connaisse la forme de l'API d'ingestion d'Iris.
      irisClient.ts        port HTTP + implémentation
      demandeService.ts    submitDemande() — l'enveloppe, et rien d'autre
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
- **Au-delà de trois organismes, la carte annonce leur NOMBRE** (« 4
  collectivités ») au lieu de les nommer — `organizationChips`, seuil nommé une
  fois et valable partout où une dalle apparaît. Quatre noms de communes sur une
  carte de trois lignes se font tronquer, et une liste illisible renseigne moins
  qu'un chiffre : celui qui cherche sa commune a le filtre ci-dessus et le menu
  « Ma ville ». La page de **détail** d'une démarche, elle, les nomme tous : elle
  en a la place, et c'est là qu'on vérifie si la sienne est dedans.
- **La recherche est réelle.** Le champ de la section `recherche` filtre les
  grilles `demarches` de la page (normalisation sans accents ni casse) ; sans
  section `recherche`, aucun filtre.
- **Le filtre « Je suis… »** (citoyen / entreprise / association) ne s'affiche
  que si la collectivité l'a demandé sur la grille (`audience_filter`) **et**
  que le catalogue vise au moins deux publics — un sélecteur à une entrée est
  une question sans objet. Il se lit sur `Demarche.audiences`, les publics
  ouverts à l'étape « Informations demandeur ». ⚠️ Une démarche dont la
  collectivité n'a déclaré **aucun** public ne passe aucun choix : elle reste
  visible tant qu'on ne filtre pas, et la lire comme « tous publics » la
  proposerait à des usagers auxquels elle n'est pas ouverte.
- **Les trois filtres se cumulent** et valent pour toutes les grilles de la
  page. ⚠️ Un filtre qu'aucune grille ne propose ne s'applique pas — sans quoi
  un choix fait ailleurs filtrerait en silence une grille qui n'offre pas de
  quoi revenir en arrière. Quand deux filtres sont posés et que la grille est
  vide, le message n'en nomme aucun : désigner l'un enverrait défaire le mauvais.
- **Un bloc « texte et image »** rend ses deux moitiés côte à côte, empilées sur
  petit écran ; `layout` dit laquelle se lit en **premier**, et cet ordre survit
  à l'empilement (`order-first`, que `flex` applique en ligne comme en colonne).
  ⚠️ L'adresse de l'image n'entre qu'en **https absolue** (`socle/urls.ts`,
  même règle que les logos, et même règle qu'à la saisie côté Socle) — le portail
  est servi en https, un `http://` y serait bloqué comme contenu mixte et un
  chemin absolu se résoudrait sur un domaine qui n'héberge aucun média. Écartée,
  l'image laisse un bandeau texte pleine largeur, jamais une image cassée. `alt` vide = image décorative : on
  rend `alt=""`, jamais le titre recopié.
- **Le pied de page final est le bas de la page.** Pleine largeur, hors du
  conteneur centré, poussé au bord ; la page perd sa marge basse. Sa couleur
  n'entre que sous la forme `#rrggbb`, le texte passe en clair ou en sombre
  selon la luminance.
- **Le bloc « Espace usager » est décoratif** tant qu'il n'y a pas de compte.

## Les pages d'organisme

Depuis le 2026-09-12, chaque organisme d'une collectivité — une mairie, un
service qui reçoit du public — peut avoir **sa propre page**, à son adresse :
`laurentville.edilumen.fr/mairie-d-arles`. Elle ne montre que les démarches de
cet organisme, à ses couleurs et avec son logo, et porte un lien de sortie vers
« les démarches des autres organismes », c'est-à-dire l'accueil de la
collectivité.

Le besoin est venu des collectivités elles-mêmes : une mairie veut pouvoir
imprimer une adresse sur ses affiches, et que ce qu'on y trouve soit à elle.

**Six formes d'adresse**, la langue comprise :

| Adresse | Ce qu'elle sert |
|---|---|
| `/` · `/en` | L'accueil de la collectivité, composé au Socle |
| `/demarches/{id}` · `/en/demarches/{id}` | Une démarche, aux couleurs de la collectivité |
| `/mairie-d-arles` · `/en/mairie-d-arles` | La page de l'organisme |
| `/mairie-d-arles/demarches/{id}` | La même démarche, aux couleurs de l'organisme |
| `/mairie-d-arles/demarches/{id}/formulaire` | Son formulaire, aux mêmes couleurs |

L'usager **reste sous l'organisme jusqu'au dépôt** : rien ne change d'habillage
entre la liste d'une mairie et la démarche qu'on y choisit. Les adresses sans
préfixe continuent d'exister à l'identique — celles déjà partagées, déjà en
favori, continuent de fonctionner.

⚠️ **UNE RÈGLE LEXICALE, ET RIEN D'AUTRE, DÉCIDE DE CE QU'EST UN PREMIER
SEGMENT.** Deux ou trois lettres, c'est une langue (`/en`, `/gsw`) ; le mot
`demarches`, c'est une route ; tout le reste est un organisme. C'est ce qui
permet au portail de savoir quel écran afficher **sans rien demander au
serveur**, et donc sans attendre une réponse pour commencer à rendre. Le Socle
tient l'autre bout de la règle : un slug d'organisme y fait **au moins quatre
caractères** (contrainte `organizations_slug_url_form`). Un slug de trois
caractères serait lu comme une langue, et la page de cet organisme deviendrait
inatteignable — sans erreur, avec l'accueil à la place. La règle vit en un seul
endroit, `src/i18n/localizedPath.ts`, et le routage, les liens et la mesure la
partagent.

⚠️ **LE THÈME VIENT DE LA COLLECTIVITÉ, LA CHARTE DE L'ORGANISME.** C'est la
séparation que le portail fait déjà partout : le thème dit *comment* peindre
(typographie, formes, densité, en-tête), la charte dit *avec quoi* (couleurs,
logo). Une page d'organisme est donc le site de la collectivité, aux couleurs de
l'organisme visité — et non un site différent. Un organisme qui n'a pas sa propre
charte **hérite** de celle de sa collectivité (le Socle résout l'héritage) : la
page reste cohérente au lieu de retomber sur les couleurs par défaut.

⚠️ **PAS DE COMPOSITION PAR ORGANISME**, et ce n'est pas un manque. Le gabarit
est fixe : logo, nom, recherche, filtre « Je suis… », grille de démarches, lien
de sortie. Deux raisons : le Socle réserve les pages composées aux collectivités
racines, et surtout la prose d'une intercommunalité sonnerait faux sous le logo
d'une de ses mairies (« Bienvenue sur notre site de démarches ! » n'est pas signé
de la même personne selon la page où on le lit).

**Qui a une page se déduit du catalogue, sans réglage.** Un organisme est
atteignable tant qu'il propose au moins une démarche publiée — c'est exactement
ce que le filtre par organisme de l'accueil sait déjà. Le jour où il n'en propose
plus, son adresse s'éteint d'elle-même plutôt que de mener à une page vide ; le
jour où il publie, elle s'ouvre sans que personne ait rien à activer. La
collectivité, elle, est écartée : sa page, c'est l'accueil. Les **services
internes** n'apparaissent jamais — c'est leur porteur qui est nommé, et c'est
son adresse qui sort.

Une adresse d'organisme inconnue (slug inventé, organisme qui ne publie plus,
démarche que cet organisme ne propose pas) **ramène à l'accueil**, comme toute
adresse inconnue : un portail public n'a rien à gagner à expliquer à un habitant
qu'il a suivi un lien périmé.

⚠️ **LA PAGE D'UN ORGANISME N'EST PAS ENCORE COMPTÉE** dans la mesure
d'audience : `page` n'a que trois valeurs au contrat partagé avec le Socle, et en
ajouter une quatrième demande une migration coordonnée. En revanche, les vues de
démarche et de formulaire atteintes **par** une page d'organisme sont comptées
comme les autres — c'est ce que vérifie `pageOf` dans ses tests, et c'était le
piège de ce lot : sans lui, ouvrir ces adresses aurait éteint la mesure sur ces
parcours, en silence.

### Le menu « Ma ville »

L'en-tête porte un menu **« Ma ville »** — à la place du libellé « Démarches »,
qui était décoratif. Il ouvre un bandeau sous l'en-tête où chaque ville est
nommée, avec son logo, et mène à sa page.

**La liste vient du catalogue**, exactement comme les pages : une ville y figure
tant qu'elle propose au moins une démarche publiée. Lister le sous-arbre entier
donnerait des entrées de menu qui mènent à une page inexistante — un lien mort
dans une navigation. La collectivité elle-même est écartée (sa page est
l'accueil), et un organisme sans slug aussi (pas d'adresse). Les **services
internes** n'y sont jamais : le Socle ne les nomme pas, c'est leur porteur qui
apparaît.

⚠️ **LE LOGO EST CELUI DE LA VILLE, PAS CELUI DONT ELLE HÉRITE.** C'est le seul
endroit où le portail reçoit une valeur de charte **brute** (contrat 1.23.0,
`logo_url` sur `PortalOrganizationRef`), et c'est l'usage qui le veut : dans une
liste de communes, un logo hérité donnerait la même image à chaque ligne, celle
de l'intercommunalité, et la liste ne distinguerait plus rien. Sans logo propre,
une pastille à la couleur du thème — jamais le logo de la collectivité.

⚠️ **LA LISTE VOYAGE DANS TOUS LES INSTANTANÉS** (`villes`, à côté de `tenant`),
parce que le menu vit dans l'en-tête et que l'en-tête est sur tous les écrans.
La calculer par écran ferait un menu qui disparaît dès qu'on ouvre une démarche.
Sur la page d'une démarche, cela demande au serveur de lire le catalogue en plus
du détail : c'est **la même entrée de cache que l'accueil**, donc un appel de
plus seulement à froid, et son échec vide simplement le menu.

Sur une **page ville**, l'en-tête se range sur **une seule ligne** quand la
largeur le permet — y compris lorsque le thème de la collectivité centre son
logo, réglage pensé pour sa page d'accueil. Le menu y est toujours présent :
c'est de là qu'on passe d'une ville à l'autre.

Code : `src/i18n/localizedPath.ts` (la règle d'adresse, pure et testée),
`src/App.tsx` (les six formes), `src/features/organisme/` (le gabarit et son
chargement), `src/services/portal/organismeService.ts` ; côté serveur,
`?organisme=<slug>` sur `GET /v1/bootstrap` et `GET /v1/demarches/{id}` de
`portal-api`, et les deux fonctions pures `organizationBySlug` /
`demarchesOfOrganization` de `_shared/domain/demarche.ts` ; la liste du menu par
`villesOf` (pure, testée) dans le même fichier, et `PageHeader` pour le bandeau.
Contrat public **1.22.0** (`slug`) puis **1.23.0** (`logo_url`) sur
`PortalOrganizationRef`.

## Une démarche, pour de vrai

Une démarche se lit, puis se remplit, puis se dépose. Deux écrans, et un seul aller-retour
chacun : `/demarches/{id}` la présente, `/demarches/{id}/formulaire` la fait remplir. Le
découpage est délibéré — l'usager sait ce qu'on va lui demander avant de s'engager, et le
formulaire a ensuite l'écran pour lui seul.

- **Le Socle possède le formulaire, le portail le rend.** `form_schema` et `requester_config`
  arrivent par `GET /v1/portal/procedures/{id}` (contrat 1.12.0). Les deux modules qui les lisent
  (`domain/formSchema.ts` + `conditions.ts`, `domain/requesterConfig.ts`) sont des **miroirs
  volontaires** du Socle, épinglés par les tests des deux côtés : une edge function ne peut rien
  importer de son application, et un paquet partagé coûterait plus cher que deux fichiers
  d'accord. L'implémentation de référence reste son `FormPreview` ; ici la saisie est réelle.
- **La lecture du schéma est tolérante, nœud par nœud.** Un champ dont le type est inconnu, sans
  clé machine, ou une liste de choix sans choix est écarté ; le reste du formulaire s'affiche.
  Même parti que pour les sections de la page composée — on ne rend pas à moitié, mais on ne perd
  pas tout pour un nœud.
- **On saisit par `id`, on dépose par `key`.** Les conditions (`visibleIf`, `requiredIf`)
  s'évaluent sur l'identifiant du champ ; `form_data` est indexé par sa **clé machine**, la seule
  qu'un agent lise. Confondre les deux produirait des demandes illisibles.
- **Un champ masqué n'existe pas.** Il n'est ni affiché, ni validé, ni déposé. Une réponse à une
  question qu'on a cessé de poser n'est pas une réponse.
- **Le portail ne demande que ce que la collectivité demande.** Les publics de « Vos
  informations » et leurs champs viennent tous de `requester_config` (défaut du Socle : public
  fermé, champ masqué). Aucun public ouvert = la demande part **sans identité**, et l'écran le
  dit — l'anonymat devient un choix de la collectivité, pas un oubli du portail.
- **Sauf les consentements RGPD, que le portail demande TOUJOURS** (2026-09-22). « Vos
  informations » s'affiche pour chaque démarche, même sans identité, et porte les deux
  consentements du catalogue fermé d'Iris — voir « Les consentements RGPD » sous « Le dépôt ».
  Ce n'est pas la collectivité qui décide s'ils sont posés.
- **Les pièces justificatives se déposent, et le portail n'en garde aucune** (2026-09-08, contrat
  d'ingestion Iris 2.0.0). Le fichier part **dès sa sélection** vers `portal-api`
  (`POST /v1/demandes/pieces`, un fichier par appel, 10 Mo maximum), qui le remet à Iris
  (`POST /v1/uploads`) : Iris vérifie le **contenu réel** (signature binaire contre une liste
  fermée — PDF, images, HEIC, Word/Excel/OpenDocument —, extension cohérente), calcule
  l'empreinte et garde le fichier vingt-quatre heures en attente d'une demande. Le formulaire ne
  retient qu'un `uploadId` par fichier ; la demande les référence (`attachments`) et un rejeu
  après coupure les renvoie tels quels. Une pièce **obligatoire** est désormais obligatoire
  comme n'importe quel champ, et le nombre de fichiers est borné par la démarche. Nora n'a
  toujours ni bucket ni table : rien à purger de son côté. Le limiteur de `portal-api`
  (20 fichiers par minute et par adresse hachée) est un frein de confort **en mémoire
  d'isolat** ; la borne opposable est le quota d'Iris (60 dépôts par minute et par clé).
  Vérifié de bout en bout le 2026-09-08 : une pièce déposée depuis le portail arrive dans la
  demande Iris, rattachée à son exigence, avec son type détecté et son empreinte.
- **Une démarche non activée pour l'organisme transmis est refusée par Iris** (`400`, message
  « Cette démarche n'est pas activée pour cet organisme dans le référentiel Socle »). Le portail
  ne transmet un organisme que si l'usager l'a choisi — donc seulement quand la démarche en liste
  plusieurs ; sans organisme, Iris retient la racine de la collectivité, qui doit alors avoir
  activé la démarche. **Question ouverte (2026-09-08)** : la liste d'organismes que le Socle
  publie avec une démarche et ses activations (`organization_procedures`) peuvent diverger — une
  démarche activée pour une seule commune, mais publiée sans organisme, part vers la racine et
  se fait refuser. À trancher côté Socle (publier les organismes qui activent) ou côté portail
  (présélectionner l'unique organisme activé).
- **La complétude n'est pas vérifiée côté serveur.** C'est le parti d'Iris — « la complétude est
  un problème d'instruction, pas un motif de rejet » — et le portail ne décide pas l'inverse pour
  lui. La saisie est guidée dans le navigateur ; ce qui arrive incomplet est qualifié par un
  agent.

### Ce que la collectivité écrit pour l'usager

Sur la page d'une démarche (`DemarchePage`), depuis le contrat 1.24.0 du Socle (étape
« Communication usager » de son paramétrage) : le **descriptif** (`user_description`) et quatre
blocs, `user_communication` — délai de traitement, public concerné, pièces annoncées, FAQ. Rien
de tout ça n'est sur la **liste** : le catalogue garde ses neuf champs.

- ⚠️ **Le descriptif est du Markdown**, rendu par `Markdown.tsx` (arbre → éléments, jamais
  d'`innerHTML`), citations `>` comprises. Sur une **carte** sans résumé, il n'en reste que le
  premier paragraphe, marques retirées (`markdownSummary`, côté serveur) ; sur le **détail**,
  `description` est le résumé seul, sans quoi la page commencerait deux fois par le même texte.
- ⚠️ **Rien d'écrit, rien d'affiché.** `user_communication` a des défauts **vides** (à l'inverse de
  `communication_config`) : `null`, un bloc absent ou abîmé ne donnent aucune section, et le
  portail ne compose aucun texte à la place de la collectivité.
- ⚠️ **Deux durées côte à côte** : « Temps de saisie » (`input_duration_minutes`, pour remplir)
  et « Délai de traitement habituel » (`delays`, pour obtenir une réponse). Aucune ne se déduit
  de l'autre. L'unité (`jour_ouvre`, `jour`, `semaine`, `mois`) vient de la donnée ; une unité
  inconnue ou une valeur hors 1–999 fait taire le délai plutôt que de l'inventer. Jours, semaines
  et mois s'écrivent avec `Intl.NumberFormat`, les jours ouvrés avec le dictionnaire.
- ⚠️ **La note de public ne filtre rien** : c'est une phrase. Le filtre « Je suis… » reste
  `audiences`, qui fait foi.
- ⚠️ **Pièces annoncées ≠ pièces à téléverser** (`pieces.ts`). L'annonce est la liste quand elle
  existe ; les champs `attachment` du formulaire sont nommés **à part** (« À joindre en ligne
  dans le formulaire : … »). Ni concaténées (la même pièce deux fois), ni l'annonce seule (une
  pièce exigée au dépôt disparaîtrait). Sans annonce, la page liste les pièces du formulaire,
  comme avant.
- ⚠️ **La FAQ est celle de l'usager** ; celle de l'agent (`knowledge_base`) ne quitte pas le
  Socle.
- ⚠️ **Ces textes ne sont pas traduits** au Socle : ils ne passent pas par `localizedText`, et
  servis dans une autre langue ils sont marqués `lang="fr"` (RGAA 8.7).
- **L'interface tolère une fonction plus ancienne** : sans `userCommunication` dans la réponse de
  `portal-api`, `portalClient` rend des blocs vides — l'interface (Cloudflare, au push) et la
  fonction (Supabase, à la main) peuvent partir dans n'importe quel ordre.

### Le dépôt

`POST /v1/demandes` sur `portal-api`, qui traduit vers l'enveloppe d'ingestion d'Iris. Trois
vérifications, toutes **côté serveur**, parce qu'aucune ne peut être déléguée à un navigateur :

1. **la collectivité** vient du domaine visité (`Origin`), jamais du corps de la requête ;
2. **la démarche est revérifiée** au catalogue publié avant l'envoi — sans quoi le portail
   deviendrait un moyen de déposer sur une démarche en brouillon ou fermée ;
3. **l'organisme destinataire** doit faire partie de ceux qui proposent la démarche.

⚠️ **La vitrine et le guichet ne sont pas le même organisme.** L'usager choisit ce que le
portail affiche — sa mairie — mais la demande part vers le **service interne** qui a activé la
démarche, s'il y en a un (`handling_organization_id` du contrat 1.16.0, porté par
`DemarcheOrganization.handlingOrganizationId`). Iris est strict : il refuse (400) une demande
adressée à un organisme qui n'active pas la démarche, et un porteur ne l'active pas — son service
le fait pour lui. Constaté le 2026-09-22 sur test2 : formulaire rempli, identité saisie, envoi
refusé « démarche non activée pour cet organisme ». Le portail ne montre jamais ce service : la
collectivité a choisi de ne pas le montrer.

S'y ajoute un filtrage : seules les clés que le formulaire déclare (et celles de l'identité du
Socle) sont déposées. Une enveloppe fabriquée à la main ne peut pas glisser de champs inventés
dans une demande, où un agent les lirait comme des réponses de l'usager.

**Le rejeu est inoffensif.** `external_id` et `idempotency_key` portent le même identifiant, tiré
une fois par le navigateur à l'ouverture du formulaire. Iris rend alors la demande existante
(`200`, `created: false`) au lieu d'en créer une seconde : le double-clic et le renvoi après
coupure réseau sont couverts par le contrat, pas par un verrou côté portail. L'accusé affiché est
le même.

**Les clés de l'identité ne sont pas traduites.** `courriel`, `nom_usuel`, `siret`… partent telles
que le Socle les nomme : Iris les lit ainsi (`_shared/identity/declared.ts`) pour rapprocher
l'usager du référentiel, ou créer sa fiche. Écrire une correspondance ici en ferait une troisième
vérité, qui divergerait au premier champ ajouté.

#### Les consentements RGPD

Depuis le 2026-09-22, chaque dépôt porte les **deux consentements** que le Socle et Iris ont
posés le 2026-09-13 (Socle `0e9f637`, contrat `contacts-api` 1.2.0 ; Iris `6e8efd1`, contrat
d'ingestion 2.2.0). Ils remplacent « accepte les mails / accepte les SMS », et ils sont demandés
**à chaque dépôt, quelle que soit la démarche** — jamais des champs de `form_schema` :

| `kind` | Ce que l'usager accepte | Régime |
|---|---|---|
| `traitement` | Que les informations fournies servent à instruire sa demande | **Obligatoire** — décoché à l'ouverture, sans lui rien ne part |
| `partage` | Que ces informations soient partagées aux services de la collectivité, pour cette demande et les suivantes | Facultatif — **proposé coché**, décochable |

- **Le catalogue est fermé, et miroité** (`domain/consents.ts`, comme `requesterConfig.ts`) :
  une collectivité ne peut ni en retirer, ni en ajouter, ni en changer le défaut. Un
  consentement qu'un service pourrait décocher dans son paramétrage ne vaudrait rien.
- **Le portail n'envoie que la réponse** — `consents: [{ kind, granted }]`, toujours les deux,
  une case non cochée valant **refus** (jamais « non demandé »). La **phrase consignée** est
  recomposée par Iris depuis le nom de la collectivité qu'il tient de sa base, puis écrite sur
  la demande (`requests.consents`) et, si l'usager est rapproché d'une fiche, au Socle
  (`contact_consents`, sous `source_app = 'portail-citoyen'`). Un `statement` envoyé d'ici
  serait refusé (400).
- ⚠️ **Ce que l'usager lit doit donc être ce qu'Iris écrit.** En français, les deux phrases
  du dictionnaire (`consent.traitement`, `consent.partage`) sont **mot pour mot** celles du
  catalogue d'Iris, `{organisme}` = `Tenant.name` — le nom de la **collectivité** (racine
  Socle), le même qu'Iris interpole avec la clé plateforme (`auth.organismName`). Sur une page
  d'organisme (`/mairie-d-arles/...`), la phrase nomme donc la collectivité, pas la mairie :
  c'est ce qui sera archivé. `src/i18n/consents.test.ts` épingle le français sur celui d'Iris.
- **La preuve est en français, par décision (2026-09-22).** Un usager qui lit le portail en
  anglais coche la phrase anglaise du dictionnaire ; Iris consigne la française, et c'est voulu :
  les agents qui instruisent lisent le français, et une trace dans onze langues ne se relirait
  pas. Ce que le dictionnaire traduit est donc une **traduction de la phrase consignée**, jamais
  une autre phrase — les onze versions doivent dire la même chose que le français, et se
  relisent comme telles. Iris n'accepte d'ailleurs ni `statement` ni langue : rien à ajouter
  au contrat.
- **Deux gardes, la même règle.** L'écran refuse d'envoyer sans le consentement au traitement
  (`validateConsents`, erreur reliée à sa case, comptée dans le récapitulatif d'erreurs) ; et
  `portal-api` refuse (400) un corps sans `consents`, un `kind` hors catalogue, un doublon, une
  clé en plus, ou `traitement` non accordé (`normalizeConsents`, miroir de la garde d'Iris) —
  **avant** toute lecture du Socle et tout appel à Iris. Une enveloppe fabriquée à la main ne
  dépose pas sans accord, et le portail ne remet pas à Iris ce qu'il sait irrecevable.
- ⚠️ **Ordre de déploiement : l'interface d'abord, la fonction ensuite.** Une interface d'avant
  ce lot face à la nouvelle fonction verrait tous ses dépôts refusés (pas de `consents`). Dans
  l'autre sens, l'ancienne fonction ignore la clé et Iris marque l'anomalie
  `consentement_absent` — dégradé, mais rien de perdu. Donc : push sur `main` (Cloudflare),
  puis `npx supabase functions deploy portal-api`.
- **Dans le recueil de l'assistant**, la carte « Vos informations » est le même bloc, et l'étape
  n'est **jamais sautée** — même sans public ouvert, il reste une case obligatoire à cocher. Le
  récapitulatif relit les deux consentements (« Accepté » / « Refusé ») et le « Continuer dans le
  formulaire classique » les emporte avec le reste. Ils ne partent **jamais au modèle** : un
  consentement se coche, il ne se dicte pas. Un recueil rangé dans l'onglet avant ce lot rouvre
  la carte au lieu de croire une confirmation donnée sans qu'on ait posé la question.
- **Lot 1 seulement.** Modifier ses consentements après coup (retrait, art. 7.3) attend l'espace
  « Mon compte » des démarches avec compte — Iris tient le retrait par un agent (B9 de son
  backlog), le Socle en dérive l'état par trigger.

**L'adresse de l'usager se tape sur une ligne, complétée par la Base Adresse Nationale**
(`AddressInput.tsx`, porté du champ d'Iris ; logique pure dans `src/services/adresse/ban.ts`).
Dès trois caractères, le portail propose cinq adresses du référentiel ; retenir l'une d'elles écrit
son libellé entier (« 10 Avenue de Frémeur 44000 Nantes ») dans la clé `adresse` — c'est ce
qu'Iris fait sur ce même champ, et le contrat ne bouge pas. Retenir une proposition est
**facultatif** : ce que l'usager tape est conservé tel quel (la BAN ignore les adresses neuves et
tout ce qui n'est pas en France), et le service muet ne change rien à la saisie. Le clavier fait
tout (↑ ↓, Entrée choisit sans soumettre, Échap ferme), la liste est un `combobox` / `listbox` ARIA
et le nombre de propositions est annoncé aux lecteurs d'écran.

⚠️ **C'est le seul appel de l'écran hors de `portal-api`**, et il part **du navigateur de
l'usager** vers `data.geopf.fr` (Géoplateforme, IGN — API publique de l'État, sans clé ; décision
du 2026-09-22). Ce qui transite : le fragment d'adresse tapé, et l'adresse IP du visiteur, comme
pour tout site qui interroge ce service. Ni nom, ni démarche, ni collectivité. Rien de la réponse
n'est gardé — ni coordonnées, ni identifiant BAN : seule la ligne choisie ou tapée part avec la
demande. Le service se substitue par `VITE_GEOCODE_URL` (voir `.env.example`).

**Le lieu d'intervention se pose sur une carte** (champ `location` du Socle, contrat 1.29.0 ;
`LocationInput.tsx`, logique pure dans `supabase/functions/_shared/domain/location.ts`). Le même
champ d'adresse assisté, et — dès qu'une proposition est retenue — une carte OpenStreetMap centrée
sur l'adresse, où l'usager **déplace le point** (souris, doigt, ou flèches du clavier : 5 m, 25 m
avec Maj) pour désigner l'endroit exact, **dans un rayon de 150 m** : au-delà, le geste s'arrête sur
le cercle. **L'adresse ne bouge pas** ; « Replacer sur l'adresse » annule ; la distance est
annoncée aux lecteurs d'écran. Retaper du texte libre efface le point (sans point de référence,
rien à ajuster) — la demande part alors avec l'adresse seule. Ce qui part avec la demande, sous la
clé du champ : `{ address, lat, lon, precision, adjusted }` — le libellé retenu ou tapé, le **point
retenu** (celui de l'adresse ou celui où l'usager l'a posé), la finesse BAN, et si le point a été
déplacé. `portal-api` revalide la forme (cinq clés, couple de coordonnées finies) mais pas la
distance : il ne connaît pas le point de l'adresse. Iris lit ce point **sans le géocoder**.

⚠️ **La carte est le second appel de l'écran hors de `portal-api`**, lui aussi **depuis le
navigateur** : les tuiles viennent de `tile.openstreetmap.org` (`src/lib/carto.ts`, mosaïque portée
d'Iris, attribution ODbL affichée). Ce qui transite : la zone regardée et l'adresse IP du visiteur,
comme pour tout site qui affiche une carte — ni nom, ni démarche. Pour un lieu d'intervention, la
BAN livre en plus le **point** de la proposition (`ban.ts` le lit désormais ; pour l'adresse de
l'usager, seul le libellé est gardé). La politique d'usage de l'OSMF réserve ses serveurs aux
faibles volumes : `VITE_MAP_TILE_URL` bascule sur un fournisseur dédié sans toucher au code.
L'ancien bloc « Lieu d'intervention » du Socle (une section de champs `intervention_*`) subsiste
sur les démarches paramétrées avant le 2026-09-22 : il se rend comme avant, champ par champ.

## Raccordement à Iris

Iris n'a **aucune logique propre à un émetteur** : le portail y est une *source enregistrée*, au
même titre qu'un connecteur courrier. Le raccordement est donc du **provisioning**, pas du code —
rien à déployer.

Le portail parle à Iris avec une **clé plateforme** (contrat Iris 2.3.0) : une seule clé, comme
pour le Socle, posée une fois pour toutes. Elle authentifie le portail ; la collectivité pour
laquelle il agit est nommée à chaque appel par l'en-tête `X-Socle-Root-Organization-Id` — l'UUID
Socle de la racine du domaine visité. Iris exige alors que cette collectivité ait une source
`portail-citoyen` **active** : c'est l'interrupteur par collectivité, et le journal d'Iris reste
tenu par collectivité.

Le principe tient en une phrase : **la clé n'existe en clair qu'à un seul endroit**, les secrets de
`portal-api`. Iris n'en garde que l'empreinte SHA-256 et rehache ce qu'il reçoit à chaque appel.

| Où | Quoi |
| --- | --- |
| Iris — `integration_sources` sans organisation, code `portail-citoyen` | la source plateforme |
| Iris — `integration_credentials.key_hash` sur cette source | l'empreinte SHA-256, 64 caractères hexadécimaux |
| Nora — secret `IRIS_API_KEY` | la clé en clair |
| Iris — `integration_sources` de CHAQUE collectivité, code `portail-citoyen`, **sans clé** | l'ouverture du dépôt pour elle |

### A. Une fois pour toutes : la clé plateforme

**1. Générer la clé**, hors de tout dépôt et de toute conversation — la sortie contient un secret :

```bash
node -e "const c=require('crypto');const k='irs_'+c.randomBytes(24).toString('hex');console.log('clé      :',k);console.log('préfixe  :',k.slice(0,12));console.log('sha256   :',c.createHash('sha256').update(k).digest('hex'))"
```

Trois sorties, trois destinations : le **sha256** et le **préfixe** vont en base (2), la **clé** va
dans les secrets (3). ⚠️ Ne pas les intervertir : le préfixe commence par `irs_`, l'empreinte fait
64 caractères hexadécimaux.

**2. Déclarer la source plateforme et son empreinte dans Iris** (projet Iris, pas le Socle) :

```sql
insert into integration_sources (organization_id, code, name, status)
values (null, 'portail-citoyen', 'Portail usagers (Nora) — plateforme', 'active')
on conflict do nothing;

insert into integration_credentials
  (integration_source_id, name, key_prefix, key_hash, scopes, expires_at)
select s.id, 'Nora — plateforme', '<12 premiers caractères>', '<sha256 hexadécimal>',
       array['requests:write'], now() + interval '12 months'
from integration_sources s
where s.code = 'portail-citoyen' and s.organization_id is null;
```

⚠️ **Remplacer réellement les `<…>`.** Rien ici n'est validé : une empreinte valant littéralement
`<sha256 hexadécimal>` s'insère sans broncher, et se paie d'un « clé inconnue » au premier dépôt.

**3. Poser les secrets sur `portal-api`**, par le tableau de bord (*Edge Functions → Secrets*) ou
par la CLI, depuis le dépôt Nora :

```bash
supabase secrets set \
  IRIS_API_URL=https://<ref-iris>.supabase.co/functions/v1/requests-api \
  IRIS_API_KEY=<la clé irs_…>
```

Pas de redéploiement nécessaire : `portal-api` lit `Deno.env` à chaque requête, le changement prend
effet au prochain démarrage du worker.

### B. Par collectivité : ouvrir le dépôt

Aucun secret à toucher. Deux vérifications et une ligne.

**0. La collectivité existe dans Iris.** Iris travaille sur son propre miroir du référentiel,
alimenté par `sync-socle-referentiel`. Si la racine n'y figure pas, l'`insert … select` ci-dessous
n'insère **rien et ne lève aucune erreur** — un `INSERT 0` silencieux — et Iris répondra 403
« Collectivité inconnue » au premier dépôt.

```sql
select id, name, socle_org_id
from organizations
where socle_org_id = '<uuid racine Socle>';
```

Zéro ligne → lancer `sync-socle-referentiel` avant toute chose.

**1. Déclarer la source de la collectivité**, sans clé :

```sql
insert into integration_sources (organization_id, code, name, status)
select id, 'portail-citoyen', 'Portail usagers (Nora)', 'active'
from organizations where socle_org_id = '<uuid racine Socle>'
on conflict (organization_id, code) do nothing;
```

Doit répondre `INSERT 0 1`. Passer `status` à `suspended` ferme le dépôt pour cette seule
collectivité, sans rien toucher d'autre.

⚠️ Le code **`portail-citoyen`** n'est pas décoratif : `portal-api` l'envoie comme `source_system`,
et Iris refuse en **403** si les deux diffèrent. `IRIS_SOURCE_SYSTEM` permet d'en changer — à
condition de changer les deux, et la source plateforme avec.

### Révoquer, regénérer

**Révoquer une clé** se fait dans Iris, jamais par suppression : `requests-api` refuse en 401 une
clé dont `revoked_at` est posé, dès l'appel suivant, et le journal `integration_api_logs` garde ce
qu'elle a déposé.

```sql
update integration_credentials
set revoked_at = now()
where key_prefix = '<préfixe de la clé>' and revoked_at is null;
```

⚠️ **Regénérer la clé, c'est deux gestes** — insérer la nouvelle empreinte en base *et* reposer
`IRIS_API_KEY`. N'en faire qu'un laisse le portail avec une clé qu'Iris ne connaît plus, et le
symptôme est le même que si rien n'avait été fait. Plusieurs clés actives coexistent sur la source
plateforme : poser la nouvelle, basculer le secret, révoquer l'ancienne — sans coupure.

Sans les deux secrets `IRIS_*`, tout le portail fonctionne **sauf** le dépôt, qui répond
« portail non configuré » : la consultation ne dépend pas du système de traitement.

### Vérifier

Trois sondes, de la plus locale à la plus complète.

**1. L'empreinte a-t-elle la bonne forme ?** Un SHA-256 fait 64 caractères hexadécimaux ; un
gabarit oublié en fait 8.

```sql
select key_prefix, length(key_hash) as longueur, key_hash ~ '^[0-9a-f]{64}$' as forme_valide
from integration_credentials c
join integration_sources s on s.id = c.integration_source_id
where s.code = 'portail-citoyen';
```

**2. Iris accepte-t-il la clé ?** Depuis un terminal — la commande porte le secret, elle n'a rien à
faire dans un journal partagé :

```bash
curl -s -i -X POST "https://<ref-iris>.supabase.co/functions/v1/requests-api/v1/requests" -H "Authorization: Bearer irs_…" -H "Content-Type: application/json" -d "{}"
```

Une erreur de **validation** (400/422) est le bon signe : l'authentification est passée, seul le
corps vide est refusé. Un 401/403 se lit dans le tableau ci-dessous.

**3. Le portail dépose-t-il ?** `POST /v1/demandes` sur `portal-api`, avec l'en-tête `Origin` du
domaine de la collectivité. Il répond `not_configured` sans secrets, une erreur de validation avec.

| Réponse d'Iris | Cause |
| --- | --- |
| 401 « Clé d'intégration inconnue » | `key_hash` ne correspond pas à la clé posée sur Nora — souvent un gabarit `<sha256>` laissé tel quel, ou préfixe et empreinte intervertis |
| 401 « expirée » / « révoquée » | `expires_at` dépassé, ou `revoked_at` renseigné |
| 403 « Intégration suspendue » | la source PLATEFORME est suspendue : tout le portail est coupé |
| 400 « X-Socle-Root-Organization-Id requis » | `portal-api` déployée d'avant la clé plateforme (elle n'envoie pas l'en-tête) |
| 403 « Collectivité inconnue d'Iris » | la racine du domaine visité n'est pas dans le miroir d'Iris — lancer `sync-socle-referentiel` (étape B.0) |
| 403 « Source … non déclarée pour cette collectivité » | pas de ligne `integration_sources` `portail-citoyen` pour elle (étape B.1) |
| 403 « Intégration suspendue pour cette collectivité » | sa source est `suspended` : le dépôt est fermé pour elle seule, c'est voulu |
| 403 « source_system ne correspond pas » | le `code` de la source ≠ `IRIS_SOURCE_SYSTEM` |
| 400 « démarche non activée pour cet organisme » | l'organisme envoyé n'active pas la démarche dans le miroir d'Iris — voir « Le dépôt », la vitrine et le guichet |

⚠️ Le portail traduit **tous** ces cas en `iris_misconfigured`, dont le message invite l'usager à
« réessayer dans quelques instants ». C'est trompeur pour une panne de paramétrage, qui ne se
résoudra pas d'elle-même. À revoir le jour où l'on distinguera l'indisponible du mal configuré.

### Ce qu'Iris enregistre

Une demande déposée porte `source = 'portail-citoyen'`, la racine Socle de la collectivité,
l'organisme destinataire s'il a été choisi, `external_ref` = l'identifiant de dépôt, un
`form_data` réduit aux seules clés que le formulaire déclare, et les deux **consentements RGPD**
(`consents`, phrase recomposée par Iris — voir « Les consentements RGPD »).

L'identité part **non traduite** dans `requester_snapshot.declared` — `courriel`, `nom_usuel`,
`siret`… tels que le Socle les nomme. Iris tente de la rapprocher de son référentiel `contacts`,
puis de créer une fiche. S'il n'y parvient pas, il **n'échoue pas** : la demande est enregistrée
avec `identity_status = 'non_rapprochee'` et l'anomalie `usager_a_creer_dans_socle`, qu'un agent
traite à l'instruction. Un Socle muet ne doit jamais faire perdre une demande.

## Une instance, plusieurs collectivités — en dépôt aussi

La question a été ouverte longtemps ; elle est **tranchée le 2026-09-22** : une seule instance sert
toutes les collectivités, en lecture comme en dépôt, avec **une clé plateforme de chaque côté**.

| | Comment |
| --- | --- |
| Lire — accueil, démarches, formulaire | la collectivité vient du domaine visité, et la clé Socle est une clé *plateforme* : elle résout tous les domaines |
| Déposer — `POST /v1/demandes`, `/v1/demandes/pieces` | même modèle : une clé Iris *plateforme* (contrat 2.3.0), et `portal-api` nomme la collectivité à chaque appel (`X-Socle-Root-Organization-Id`). Iris exige qu'elle ait une source `portail-citoyen` active |

Ce qui a été essayé et écarté, dans l'ordre :

- **un déploiement par collectivité** : N déploiements à tenir à jour, et tout ce qui fait le
  cœur de l'architecture — résolution par `Origin`, cache par hostname — devenait du code mort ;
- **une clé Iris par collectivité**, rangées dans un secret JSON (`IRIS_API_KEYS`) — vécu une
  journée, le 2026-09-22. Une clé Iris est liée à une source, donc à une collectivité ; la
  troisième collectivité a montré le défaut : le secret se remplace en entier, Iris ne garde que
  les empreintes, personne ne garde les clairs — donc toutes les clés à régénérer à chaque
  ajout. Le rayon de fuite plus petit ne valait pas ce prix : Nora n'est pas un connecteur tiers
  opéré par la collectivité, c'est le portail d'Edilumen, et il parle déjà au Socle avec une clé
  plateforme.

Ce qui reste par collectivité, et c'est voulu : la **source** `portail-citoyen` d'Iris, sans clé —
l'interrupteur du dépôt, et le journal. Ajouter une collectivité, c'est une ligne dans le Socle
(son domaine) et une ligne dans Iris (sa source) ; aucun secret ne bouge.

⚠️ Ce qui reste vrai : un dépôt depuis un domaine porté par une **sous-organisation** s'envoie
sous la racine de la collectivité.

Constaté le 2026-09-21 sur test2 (Rosny-sous-Bois), avant tout cela : formulaire rempli dans la
conversation, identité saisie, envoi refusé — la seule clé posée était celle d'une autre
collectivité.

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
  SOCLE_API_KEY=<clé plateforme, scope read> \
  IRIS_API_URL=https://<ref-iris>.supabase.co/functions/v1/requests-api \
  IRIS_API_KEY=<clé d'intégration PLATEFORME irs_…, scope requests:write>
supabase functions deploy portal-api
```

Pour activer la **mesure d'audience** (facultative — voir la section dédiée) :

```bash
supabase secrets set \
  SOCLE_AUDIENCE_API_URL=https://<ref-socle>.supabase.co/functions/v1/audience-api
```

La clé employée est `SOCLE_API_KEY`, qui doit alors porter le scope `audience`
en plus de `read`. Sans cette URL, le portail ne compte rien.

Sans les deux secrets `IRIS_*`, tout le portail fonctionne **sauf** le dépôt, qui répond
« portail non configuré » : la consultation ne dépend pas du système de traitement.

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

⚠️ **LE SERVEUR DE DÉVELOPPEMENT PEUT SERVIR UN MODULE PÉRIMÉ**, et ça coûte une
heure si on ne le sait pas. Vu le 2026-09-12 : un champ ajouté à
`services/portal/portalClient.ts` arrivait `undefined` dans le composant, alors
que `curl http://localhost:5175/src/services/portal/portalClient.ts` montrait le
bon code. La cause : l'importateur restait épinglé sur `portalClient.ts?t=<ancien
horodatage>`, et ni un rechargement, ni un onglet neuf, ni un redémarrage du
serveur ne l'ont défait (le fichier avait été réécrit par un script, hors de
l'éditeur). **Le réflexe** : vérifier sur un build de production
(`npm run build` + n'importe quel serveur statique), qui compile depuis zéro. Ne
pas conclure à un défaut du code sur la seule foi du serveur de dev — et se
souvenir que la mesure d'audience exige de toute façon ce build (garde
`import.meta.env.PROD`).

`supabase/functions/_shared/portalFlow.test.ts` couvre le flux complet contre un
Socle simulé : domaine connu, domaine inconnu, démarches d'un tenant, tenant sans
démarche publiée, Socle indisponible, et changement de hostname. Les services
(`pageService`, `brandingService`, cache) et les règles de rendu
(`composition.ts`, `theme.ts`, `formulaire.ts`) ont chacun leurs tests, sans réseau. La lecture
tolérante du `form_schema` et du `requester_config` est épinglée côté portail
(`domain/*.test.ts`), et l'enveloppe déposée dans Iris l'est contre un Iris simulé
(`iris/demandeService.test.ts`) — c'est un port, il se remplace par une table de réponses.

## La langue du visiteur

Une collectivité choisit au Socle les langues dans lesquelles elle s'adresse à
ses usagers. Le portail en fait un sélecteur — dans l'en-tête, donc sur les trois
écrans — et sert ce que la personne a choisi. Il n'apparaît qu'au-delà d'une
langue, et chaque langue y est écrite **dans sa propre langue** (« English »,
« العربية », « brezhoneg ») : quelqu'un qui ne lit pas le français ne cherche pas
« Anglais ».

**La langue est dans l'adresse**, et le français n'a pas de préfixe : `/`,
`/en`, `/en/demarches/{id}`. Une page publique se partage et s'indexe ; et le
français est la langue pivot, pas une traduction — c'est la même règle qu'au
Socle, où `translations` n'a jamais de clé `fr`. Toutes les adresses déjà
partagées continuent donc de fonctionner. La langue est aussi mémorisée dans le
navigateur pour la visite suivante ; il n'y a **aucune détection automatique**
(`navigator.language` dirait la langue du téléphone, pas celle qu'on veut lire
sur le site de sa mairie).

⚠️ **Ce qui est demandé n'est pas ce qui est servi.** `portal-api` reçoit
`?lang=`, le clampe sur ce que la collectivité a activé, et **renvoie la langue
servie** ; l'interface remet alors l'adresse d'accord avec ce qui est affiché.
Sans ça, une langue mémorisée puis désactivée par la collectivité serait
redemandée à chaque visite, et l'adresse mentirait.

**La langue est résolue à la frontière**, dans `socle/*.ts` : plus loin,
`demarche.name` est un intitulé à afficher, pas un français dont il faudrait
chercher la traduction. Le repli se fait **champ par champ** — une démarche peut
avoir son intitulé traduit sans son résumé, c'est le cas normal.

### Deux périmètres, et ce que voit un usager

|  | Qui écrit | Couverture |
|---|---|---|
| Textes de la **collectivité** (démarches, catégories, blocs de la page d'accueil) | l'agent, au Socle, qui les relit | les 65 langues du catalogue |
| Textes de l'**outil** (boutons, messages, étiquettes) | l'éditeur, dans `src/i18n/strings.ts` | `COVERED_LANGUAGES` (11) |

Dans une langue **non couverte** — breton, shimaoré… — l'usager lit **sa
collectivité dans sa langue** et **l'outil en français**. C'est assumé : personne
ici ne peut rédiger ni relire du drehu, et ce que la collectivité n'a pas écrit
ne s'invente pas. Le repli est **par clé**, jamais par langue : une langue
couverte à 90 % affiche les 10 % restants en français, on ne rebascule pas tout
le portail parce qu'une clé manque.

⚠️ Les traductions du dictionnaire sont **de qualité machine** tant qu'un
locuteur ne les a pas relues. Elles sont versionnées : une modification est une
revue de code, avec son diff. Elles ne passent **pas** par `translate-labels` du
Socle — cette fonction est adossée au crédit d'UNE collectivité ; le chrome de
l'outil est une dépense d'éditeur.

⚠️ `dir="rtl"` est posé pour l'arabe et les autres écritures de droite à gauche.
Il corrige le **texte** et la **saisie**, pas le **placement** : les utilitaires
Tailwind sont physiques (`ml-`, `text-left`) et ne se miroitent pas. Le miroir
complet de la mise en page est un chantier à mener avec le RGAA.

## Le thème du site

Réglé par la collectivité dans l'éditeur du Socle, publié avec la page
d'accueil, servi dans `Tenant.theme` (contrat 1.17.0).

| Bloc | Ce que le portail en fait |
| --- | --- |
| `typography.font` | La famille servie depuis `public/fonts/` — une seule chargée. |
| `typography.text_scale` | Toutes les tailles de texte du site (× 0,92 / 1 / 1,12). |
| `shapes.radius` / `shadow` | Angles et ombres, partout. |
| `shapes.density` | Espacement entre les blocs et dans les cartes (× 0,78 / 1 / 1,28). |
| `header.*` | Fond blanc ou coloré, logo à gauche ou centré, menu texte ou pilules, bouton de compte, bandeau fixe. |
| `accessibility.high_contrast` | Encres, bordures **et** couleur principale assombries. |
| `accessibility.dark_primary` | La couleur de la charte foncée d'un cran (clarté × 0,75) — **au rendu**, la charte ne bouge pas. |
| `accessibility.declaration` | La mention RGAA, au pied de toutes les pages. Vide = rien d'affiché ; le portail n'invente pas de déclaration. |
| `accessibility.declaration_link` | Un lien « Déclaration d'accessibilité » vers `/accessibilite`, dans la mention (contrat 1.25.0). **Résolu par le Socle** : vrai seulement si une déclaration non vide est publiée. |

⚠️ **Le thème n'est jamais absent.** Une collectivité qui n'a rien publié, un
Socle d'avant le contrat 1.17.0, une réponse abîmée : `parseTheme` rend les
défauts, jamais `null`. Les deux dépôts peuvent donc être déployés dans
n'importe quel ordre, et aucun composant ne porte de cas d'absence.

⚠️ **Chaque champ est indépendant.** Un réglage inconnu — ajouté par un Socle
plus récent — retombe sur son défaut sans emporter ses voisins.

⚠️ **`themeStyle.ts` est un miroir volontaire** de son homologue au Socle :
mêmes facteurs, mêmes encres, mêmes noms de variables. C'est ce qui fait que
l'aperçu de l'éditeur ressemble au site. S'ils divergent, c'est l'éditeur qui
ment, et personne ne s'en aperçoit avant la publication — d'où les tests des
deux côtés.

## La déclaration d'accessibilité

Obligatoire pour un site public (RGAA, article 47 de la loi du 11 février
2005) : une **mention** au pied de chaque page, et une **page** qui porte la
déclaration complète. La collectivité rédige la seconde dans l'onglet
« Contenus » de l'éditeur du Socle, et règle la première — sa phrase, son
lien — dans « Composition ».

- **`/accessibilite`** (et `/en/accessibilite`…) : `AccessibilitePage`, qui
  appelle `GET /v1/accessibilite` de `portal-api`, qui lit
  `GET /v1/portal/content?slug=accessibilite` au Socle. Même cadre qu'une
  démarche : en-tête, menu « Ma ville », charte de la collectivité.
- ⚠️ **Page de la COLLECTIVITÉ** : sous un organisme
  (`/mairie-de-x/accessibilite`), elle ramène à `/accessibilite`. Le segment
  est réservé des deux côtés — `ROUTE_SEGMENTS` ici,
  `organizations_slug_url_form` au Socle.
- ⚠️ **Rien de publié n'est pas une erreur** : `statement: null`, et la page
  dit que la déclaration n'est pas encore publiée. Le lien, lui, n'apparaît
  jamais dans ce cas : le Socle ne sert `declaration_link` que vers une
  déclaration non vide.
- ⚠️ **Le Markdown n'est jamais injecté** (`domain/markdown.ts`, partagé avec
  le descriptif d'une démarche) : parseur → arbre → éléments React, liens
  limités à `https`/`http`/`mailto`/`tel`. Un texte venu du serveur n'a aucun
  chemin vers le DOM autrement que comme texte. Il lit le sous-ensemble de
  l'aperçu du Socle, **plus les citations `>`**, que cet aperçu affiche encore
  en toutes lettres.
- ⚠️ **Le texte est en français** et n'est pas traduit : servie dans une autre
  langue, la page traduit son titre, prévient l'usager, et marque la
  déclaration `lang="fr"` (RGAA 8.7).

## Mesure d'audience sans cookie

Depuis le 2026-09-12, le portail **compte sa fréquentation**, et le Socle
l'affiche sur le tableau de bord de chaque collectivité. Ajouter cette mesure
n'a demandé ni bandeau de consentement, ni outil tiers, ni base de données — et
les trois vont ensemble.

**Ce qui est compté :** la page affichée (accueil, présentation d'une démarche,
formulaire), les **arrivées** sur le site, la **langue servie**, la **classe
d'appareil**, et les **dépôts** de demandes.

⚠️ **Une visite est une ARRIVÉE, pas un visiteur unique.** C'est la première
page d'une navigation : le référent n'est pas le site lui-même, et ce n'est pas
un rechargement. Quelqu'un qui revient trois fois dans la journée compte trois
visites. Sans identifiant, il n'y a aucun moyen — ni aucune envie — de savoir
que c'est la même personne.

⚠️ **Rien n'est écrit sur le poste du visiteur** : ni cookie, ni `localStorage`,
ni `sessionStorage`. La déduplication d'une page déjà comptée tient dans une
`ref` React, qui meurt avec l'onglet.

⚠️ **Aucun identifiant ne part vers le Socle.** Ses deux tables de compteurs
n'ont aucune colonne capable d'en porter un — un test SQL en épingle la liste
exacte. Les trois données qui pourraient désigner quelqu'un ne franchissent
jamais `portal-api` :

| Donnée | Où elle vit | Ce qu'il en reste |
|---|---|---|
| Adresse IP | `portal-api`, en mémoire | un haché, le temps d'une fenêtre de frein |
| User-Agent | `portal-api`, le temps d'une requête | un mot parmi `mobile` / `tablette` / `ordinateur` |
| Référent | le navigateur seul | un booléen : « est-ce une arrivée ? » |

C'est cette absence, et elle seule, qui dispense d'un bandeau de consentement
(article 82 de la loi Informatique et Libertés). Une ligne dans les mentions
légales reste **recommandée** — elle n'est pas obligatoire, faute de donnée
personnelle. La **provenance** a été écartée du périmètre : le serveur ne sait
pas d'où vient un visiteur.

⚠️ **Un seul appel réseau par page vue.** Le beacon part en `text/plain`, qui
est une requête « simple » au sens du CORS : pas de requête préalable `OPTIONS`.
L'envoi ne bloque rien (`keepalive`), et un échec est un silence complet — un
compteur ne fait jamais échouer ni attendre une page. La réponse est **toujours
204**, y compris pour un domaine inconnu : le navigateur ne doit rien pouvoir
déduire de ce qu'il reçoit.

⚠️ **Rien n'est mesuré en développement, ni sous pilotage**
(`import.meta.env.PROD`, `navigator.webdriver`) : un agent qui met au point sa
page d'accueil, ou un test de bout en bout qui la parcourt, gonfleraient des
chiffres qu'un élu lira comme de la fréquentation réelle. Les robots qui **se
nomment** (moteurs, moniteurs, aperçus de lien) sont écartés côté serveur —
détection grossière et assumée : elle n'existe pas pour se défendre (un robot
malveillant se déclare navigateur), mais pour qu'une commune sans visiteur
n'affiche pas le trafic de sa propre surveillance.

⚠️ **La mesure est un choix explicite** : sans `SOCLE_AUDIENCE_API_URL`, le
portail ne compte rien du tout. La clé employée est `SOCLE_API_KEY`, qui doit
alors porter le scope **`audience`** en plus de `read` — une clé par
application, c'est la décision du registre des applications du Socle.

⚠️ Piège de l'implémentation, à ne pas défaire : `LanguageLayout` déclenche
jusqu'à **deux** `navigate(replace)` par chargement (canonicalisation de
`/fr/…`, puis alignement sur la langue servie). Un effet branché naïvement sur
`location.pathname` compterait la même page deux fois — d'où la clé de page
**indépendante de la langue**, et la déduplication par `ref`. Changer de langue
sur une même page n'est pas une nouvelle page vue.

Code : `src/services/audience/{pageView,useAudience}.ts` (le premier pur et
testé), branché dans `src/i18n/LanguageLayout.tsx` — le seul point commun aux
trois écrans ; `supabase/functions/_shared/domain/audience.ts` (pur, testé) et
`_shared/socle/audienceClient.ts` ; route `POST /v1/audience` de `portal-api`,
et signalement du dépôt à la fin de `POST /v1/demandes`.

## L'assistant conversationnel

Depuis le 2026-09-20, une collectivité peut proposer un **assistant** sur son
site : l'usager décrit son besoin (« comment signaler un dépôt sauvage ? »),
l'assistant le renseigne et lui propose la bonne démarche, en carte. Si la
collectivité l'a ouvert (`tenant.assistant.depositEnabled`), l'usager peut
**remplir la démarche dans la conversation**, relire un récapitulatif, et
envoyer **lui-même** : sa référence s'affiche dans le fil. **Le modèle ne dépose
jamais** — il n'a aucun outil. Le dépôt reste **un geste de l'usager** : c'est
lui qui appuie sur Envoyer, par le même `POST /v1/demandes`, la même porte
anti-robot liée au `submissionId`, la même validation contre la démarche publiée.

**La bulle** (2026-09-21, `src/features/assistant/AssistantBubble.tsx`) :
l'assistant est un panneau flottant en bas à droite, monté **une seule fois**
au-dessus de l'`Outlet` (`LanguageLayout`) — donc présent sur tous les écrans,
y compris depuis le moteur de recherche, et **sa conversation survit à la
navigation**. Il remplace la page d'entrée : ouvrir une démarche ne fait plus
perdre le fil. ⚠️ `/assistant` reste, comme **repli grand format** — c'est ce qui
rend la bulle tenable au zoom (RGAA 10.4) : sous 48rem de largeur CSS, ce qu'un
zoom à 200 % atteint mécaniquement, le panneau passe en plein écran ; au-dessus
il flotte, sans aucune hauteur en pixels. Il porte en permanence un lien « voir
en grand », et le fil vivant en `sessionStorage`, la conversation s'y poursuit
intacte. ⚠️ Le panneau ne se ferme ni au changement d'adresse ni au clic
extérieur, contrairement au bandeau « Ma ville » : un menu se referme quand on
regarde ailleurs, une conversation non.

**Le recueil** (`_shared/ai/collection.ts`, pur, même code côté serveur et côté
écran) partage les rôles :

- **tout se dit, sauf une pièce jointe et sauf une DATE.** Le modèle DIT ce
  qu'il a compris (`field_updates`) ; le serveur le ramène au schéma **publié**
  (`coerceUpdate`) et n'en retient que ce qui vise un champ **en attente** et
  **passe la validation du formulaire** (`applyUpdates`). Un choix rendu par son
  libellé ressort en `option.value` ; un oui/non ne connaît que oui et non.
  ⚠️ `coerceUpdate` est la **seule** barrière pour un choix — `validateForm` ne
  vérifie pas les options. Le modèle ne peut donc pas inventer une option.
  ⚠️ **Une date demande une horloge que le modèle n'a pas** : « jeudi » ne se
  résout pas sans savoir quel jour on est, et une date devinée se trompe d'une
  semaine sans que rien ne le signale. Le calendrier du formulaire, lui, sait —
  c'est le seul type où le contrôle est plus SÛR que la conversation, pas
  seulement plus rapide.
  ⚠️ Le modèle ne réécrit jamais une réponse déjà donnée, ni un champ que
  l'usager s'est approprié (`touched`, qui survit même à un champ vidé) :
  corriger est un geste de l'usager, sur le récapitulatif ;
- **les tours d'une conversation en recueil montent à 40**, et sa durée de vie
  à une heure. Remplir en parlant coûte des tours — une question, un appel — et
  vingt tombaient au pire moment, en plein remplissage. ⚠️ La borne ne monte que
  lorsque le SERVEUR a constaté un recueil valide, et le drapeau vit dans le
  corps **signé** du ticket : un navigateur qui voudrait la borne haute devrait
  réécrire le corps, et la signature ne suit pas. Il ne redescend jamais. Si la
  conversation s'épuise malgré tout, la zone de saisie disparaît et le
  **formulaire classique prérempli devient le geste principal** : rien de ce que
  l'usager a raconté n'est perdu ;
- **toute valeur posée par l'assistant porte son ORIGINE** (`FieldOrigin`), et
  le récapitulatif en fait un badge : « d'après votre message » / « déduit, à
  confirmer » / « rédigé pour vous ». C'est ce qui rend un formulaire prérempli
  relisable **sans tout relire** — sans quoi l'usager relit tout, ou ne relit
  rien et signe. ⚠️ C'est le **serveur** qui tranche l'origine (`originOf`), sur
  les mots réellement écrits, jamais le modèle sur parole : « repris » se mérite,
  la citation doit figurer dans le dernier message. Un choix seulement *rapproché*
  des mots de l'usager (« des gravats » → « Dépôt sauvage ») reste une déduction.
  Au doute, « déduit » : se tromper vers ce badge fait relire une valeur juste,
  se tromper vers l'autre fait signer une valeur inventée ;
- ⚠️ **c'est le MODÈLE qui pose les questions**, depuis le 2026-09-21. L'écran
  les posait avant, en récitant le libellé du champ : le remplissage avait le
  ton d'un formulaire lu à voix haute, et l'alternance des deux voix cassait le
  rythme. Une seule voix désormais. Il groupe deux ou trois informations qui
  vont ensemble en une question, déclare dans `asking` ce qu'elle porte, et
  `runAssistantTurn` refiltre cette déclaration contre ce qui reste vraiment à
  renseigner — **après** `applyUpdates`, car ce qu'il vient de remplir n'est
  plus une question. **Le formulaire ne s'affiche plus** : l'écran ne montre un
  contrôle que pour ce à quoi on ne peut pas répondre en parlant (le calendrier
  d'une date, le dépôt d'une pièce), ou, replié, pour un champ à options qu'il
  vient de demander. Une carte ne coûte aucun appel au guichet ;
- **l'écran NOMME ce qui reste**, sous le fil : « Encore 3 informations : le
  lieu, la nature du dépôt, une photo » plutôt qu'un nombre nu, qui n'apprenait
  rien avant la question suivante. C'est l'écran qui le fait, pas le modèle :
  les libellés sont déjà là (`viewOf().remainingFields`), une liste ne coûte
  aucun jeton — donc aucune seconde d'attente de plus —, ne se trompe jamais et
  ne s'oublie pas d'un tour à l'autre. Bornée à cinq noms : au-delà,
  l'énumération serait plus longue que la question. ⚠️ Elle vit dans la même
  région `role="status"` que l'attente, jamais dans une seconde (RGAA 4.1) ;
- ⚠️ **le prompt d'un RECUEIL est allégé** : ni catalogue, ni démarches
  candidates, et la liste des champs n'est plus rendue deux fois (`focusBlock`
  la cédait en doublon de `collectBlock`). Une fois la démarche choisie, on la
  remplit — on n'oriente plus. Le guichet **refuse le flux** : l'usager attend
  la réponse ENTIÈRE, et chaque bloc inutile se paie en secondes. Le descriptif,
  le délai, les pièces à prévoir et la FAQ **restent** : « pourquoi vous me
  demandez ça ? » doit trouver réponse en plein remplissage (test) ;
- ⚠️ **`MAX_OUTPUT_TOKENS` se relit chaque fois que le contrat de sortie
  grossit.** Ce n'est pas le texte visible qui le remplit, mais l'enveloppe
  JSON : `origin`, `source`, `reason`, `asking`, jusqu'à 20 `field_updates`.
  Dépassé, il ne produit pas une réponse écourtée mais un tour **perdu** — le
  guichet rend un `200` avec une chaîne tronquée, et c'est `JSON.parse` qui
  tombe plus loin, sous le visage d'une indisponibilité. Resté à 600 pendant que
  quatre champs rejoignaient le contrat, il vaut 1 100 ;
- ⚠️ **ouvrir un recueil FAIT PARLER l'assistant.** Ouvrir est une action
  locale, qui ne coûtait aucun appel : l'usager cliquait « Remplir cette
  démarche ici » et l'assistant se taisait — une note, une liste de champs, et
  à lui d'écrire le premier sans savoir quoi. `start()` rend désormais la
  démarche ouverte, et l'écran enchaîne sur un tour dont le message dit ce que
  le clic **veut dire**. Un appel de plus par ouverture, assumé : c'est le prix
  d'un accueil et d'une première question, et sans eux il n'y a pas de
  conversation du tout ;
- **le modèle demande UNE chose à la fois, pas des libellés.** « À quelle
  adresse ? » est une question ; « Numéro, BTQ, Voie, Complément d'adresse,
  Code postal » est un formulaire lu à voix haute. `MAX_ASKING` vaut donc 6 et
  non 3 — ce n'est pas un nombre de questions mais de **champs**, et une adresse
  dite d'un trait en remplit cinq ;
- **le modèle PROPOSE de remplir, il n'ouvre rien** (`offer_procedure_id`,
  revalidé au catalogue publié) : c'est un bouton sous sa bulle que l'usager
  presse. Un recueil qui démarrerait seul embarquerait dans un formulaire celui
  qui voulait juste poser une question ;
- ⚠️ **un champ FACULTATIF vide n'empêche RIEN.** `view.complete` vaut
  `validateForm(...) === {}` — les obligatoires renseignés, les valeurs bien
  formées — et rien d'autre. Il a exigé que tout champ visible soit répondu ou
  passé, et c'était un blocage : personne ne demande « quel est votre indice de
  répétition ? », donc un « BTQ » n'est ni répondu ni décliné, donc
  éternellement en attente. Le modèle jugeait la demande complète et cessait de
  demander ; l'écran n'ouvrait jamais le récapitulatif. **Conversation finie,
  formulaire valide, aucun bouton pour l'envoyer.** Les facultatifs restants
  apparaissent vides au récapitulatif, avec leur « Modifier » ;
- **un champ facultatif refusé se passe quand même** (`skip`) : cela le retire
  de ce que le modèle voit en attente, donc il cesse de le proposer. C'est une
  commodité de conversation, plus une condition de sortie ;
- ⚠️ **le repli « voir lesquelles » est REMPLISSABLE**, et c'est la sortie de
  secours. Le modèle demande « code postal et ville », l'usager répond
  « 44000 », la ville reste vide, le modèle passe à la suite et n'y revient
  pas : l'écran annonçait « Encore une information à préciser » **sans rien
  offrir pour la préciser** — la carte de champ ne paraît que pour ce qui ne se
  dit pas, et le récapitulatif n'ouvre pas tant qu'un obligatoire manque.
  Conversation sans issue. Le repli porte désormais les contrôles eux-mêmes :
  replié par défaut, disponible à tout moment, sans dépendre de ce que le modèle
  veut bien demander — c'est quand il s'égare qu'on en a besoin. **Il s'ouvre
  seul** quand l'assistant ne demande plus rien alors qu'il manque un ou deux
  obligatoires : replié, il existait, et l'usager ne l'a pas vu sous un « Votre
  signalement est complet » ;
- ⚠️ **ce n'est pas le modèle qui décide que c'est complet**, mais la ligne
  « INFORMATIONS À RECUEILLIR » du prompt, à trois états (obligatoires
  restantes / plus que des facultatives / plus aucune). Il lui est interdit de
  le décréter — et de **décrire l'écran** : il ne le voit pas, et il inventait
  des boutons (« passez à l'étape suivante ») que l'usager cherchait ensuite.
  ⚠️ Le premier état était **muet** (aucune ligne), alors que la règle y
  renvoyait : faute de ligne, le modèle jugeait seul. Elle compte désormais ce
  qui reste, et chaque obligatoire en attente est marqué « À OBTENIR » dans la
  liste — ce qui bloque se lit, il ne se déduit plus par soustraction ;
- ⚠️ **le filet : un modèle qui ne demande rien alors qu'il reste de
  l'obligatoire est relancé UNE fois** (`runAssistantTurn`), avec la raison. Ce
  que la première réponse a fait retenir reste retenu ; si le second appel
  échoue ou s'égare autant, la première réponse part et l'écran garde son
  repli. Le second appel est **facturé à la collectivité** comme le premier,
  mais ne consomme pas de tour. Une consigne de prompt ne suffit pas : celle
  qui disait « une réponse partielle n'est pas une réponse » était en place
  quand le cas s'est reproduit. **Même filet pour l'égarement inverse** : une
  réponse qui se termine par une question (« Depuis quand ? ») au tour même
  qui complète la demande. L'écran passe aussitôt à l'identité ; la question
  reste en l'air, sans champ où ranger la réponse. Le modèle est relancé pour
  annoncer le récapitulatif sans rien demander — seulement au tour qui FERME le
  recueil : ensuite, l'usager discute librement sous son récapitulatif. Et il
  lui est dit de ne pas **creuser** une information déjà retenue : ce que
  l'usager répondrait ne pourrait être rangé nulle part ;
- **la ville se déduit du code postal — par un référentiel, jamais par le
  modèle** (`postalCity.ts`). Personne ne répond « 44000 Nantes » à quelqu'un
  qui sait lire un code postal. Les deux champs se reconnaissent à leur clé
  (`<préfixe>_code_postal` / `<préfixe>_ville`, le bloc d'adresse du Socle).
  Une seule commune : le serveur la renseigne, badge « déduit » — l'usager la
  relit. Plusieurs : le modèle reçoit les noms et demande laquelle. Le
  référentiel est interrogé **avant** le modèle, pour que sa réponse dise
  « j'ai noté Nantes » et non « et la ville ? ». ⚠️ **C'est le seul appel de
  l'assistant hors du Socle** : `geo.api.gouv.fr` (API publique de l'État, sans
  clé), et **seuls les cinq chiffres du code postal y partent** — ni le
  message, ni l'adresse, ni la collectivité. Délai de 1,5 s ; muet, la ville se
  demande comme avant ;
- **l'identité du demandeur** se saisit dans sa propre carte, à la fin, et n'est
  **jamais montrée au modèle** — elle n'a aucun chemin jusqu'à lui (test). La même
  carte porte les **consentements RGPD**, toujours (2026-09-22) : l'étape existe
  même sans public ouvert, et les consentements ne partent pas plus au modèle
  que l'identité.
  ⚠️ Les autres réponses, elles, **partent au modèle** depuis le 2026-09-21 : c'est
  ce qui permet de répondre en langage naturel sur tous les types de champs, et
  d'accuser réception sans reposer deux fois la même question. Formulation
  honnête à tenir devant l'usager, inchangée : « aucun champ d'identité n'est
  envoyé au prestataire » — pas « aucune donnée personnelle », puisqu'un lieu
  d'intervention est une adresse.
- ⚠️ **L'état du recueil vit dans le navigateur et n'est pas signé** : il n'en a
  pas besoin. Il ne contient que ce que l'usager pourrait taper dans le
  formulaire, `sanitizeState` le nettoie avant de servir, et le dépôt refiltre
  tout contre la démarche publiée. Un champ masqué n'existe pas : changer une
  réponse purge ce qu'elle vient de masquer.

**La porte anti-robot du dépôt** (`_shared/ai/depositGate.ts`, 2026-09-20) :
`POST /v1/demandes` n'avait aucun frein, ni ici ni chez Iris — tolérable tant
qu'il fallait remplir un formulaire à la main. Il demande désormais une preuve
de travail (`POST /v1/defi`), **liée au `submissionId`** : le serveur n'a pas de
mémoire et ne voit pas un rejeu, mais une preuve rejouée ne peut redéposer que
**la même** demande, qu'Iris dédoublonne. Elle vaut pour le formulaire classique
comme pour l'assistant. ⚠️ Déploiement en **deux temps**
(`DEPOSIT_CHALLENGE_REQUIRED`, voir `.env.example`) ; sans secret de signature,
la porte n'existe pas et le portail dépose comme avant.

- **C'est le Socle qui l'ouvre, pas le portail.** Le super administrateur du
  Socle l'active collectivité par collectivité (fiche du client › « Assistant du
  portail usagers ») ; le portail le lit sur le tenant (`tenant.assistant`,
  contrat 1.28.0). ⚠️ **Au doute, fermé** (`domain/assistant.ts`) : un Socle plus
  ancien, une réponse abîmée ne l'ouvrent pas — l'assistant dépense le crédit IA
  de la collectivité, que ses agents partagent.
- ⚠️ **Il ne sait que ce que le site affiche déjà.** Le prompt (`_shared/ai/prompt.ts`)
  ne prend en entrée que les modèles du portail, lus sur `/v1/portal/*` : catalogue,
  descriptif usager, délai, pièces annoncées, FAQ usager, libellés du formulaire. La
  base de connaissances des agents n'existe pas dans ces types — elle ne peut pas
  fuir par là, et un test l'épingle. **Corpus strict** : sans texte de la
  collectivité, l'assistant dit qu'il ne sait pas. Conséquence voulue : le prompt
  peut être exfiltré en entier sans rien révéler.
- **Horaires et informations des organismes** (2026-09-24, contrat Socle 1.30.0) :
  hors recueil, le prompt reçoit ce que chaque organisme a écrit dans l'onglet
  « Informations usagers » du Socle (`GET /v1/portal/organizations`,
  `socle/organismeInfoService.ts` → `domain/organismeInfo.ts`) : descriptif, horaires
  jour par jour, remarques, FAQ. La grille s'écrit sur **sept jours**, un jour absent
  en toutes lettres « fermé » ; une grille **vide** s'écrit « non indiqués », jamais
  « fermé ». Ses règles (`ORGANISMES_RULES`, hors de `BASE_RULES` et donc de la
  console) : lire les remarques avant d'affirmer une ouverture, ne pas supposer la
  date du jour, ne **jamais** prêter à un organisme les horaires d'un autre (pas
  d'héritage). ⚠️ Jamais bloquant : un Socle muet sur cette route laisse l'assistant
  répondre, sans horaires.
- **Le portail ne parle jamais au fournisseur de modèle** : il compose son prompt
  et le confie au guichet IA du Socle (`ai-api`), avec une **clé à part** au scope
  `ai` seul, sous l'alias d'agent `assistant-usager`. Le Socle compte les jetons,
  refuse au-delà du plafond, et ne garde rien du contenu. ⚠️ Chaîne de délais à ne
  pas inverser : fournisseur 55 s < Socle 60 s < `portal-api` 75 s < navigateur 90 s.
- ⚠️ **Le guichet refuse les outils : l'assistant n'agit sur rien.** `_shared/ai/turn.ts`
  est une boucle déterministe autour d'une sortie JSON, et n'en croit rien : une
  démarche proposée n'est retenue que si elle est au catalogue **publié de cette
  collectivité**, et **tout lien est retiré** de la réponse (`stripLinks`) — un
  assistant qui parle sous la marque d'une collectivité et peut afficher un lien
  est un outil d'hameçonnage. Les seules destinations sont des cartes de démarches,
  bâties par l'écran à partir d'identifiants revalidés.
- ⚠️ **Le serveur n'a pas de mémoire** (Nora n'a pas de base) : le navigateur tient
  le fil et le renvoie à chaque tour. Trois signatures rendent cela sûr
  (`_shared/ai/signing.ts`, `challenge.ts`, secret `ASSISTANT_SIGNING_SECRET`) :
  le **ticket** borne la conversation (sa collectivité, 30 minutes, 20 tours — le
  compteur est dans le ticket, que seul le serveur sait réécrire) ; **chaque
  réponse de l'assistant est signée**, et un tour « assistant » non signé fait
  tomber la requête (c'est le jailbreak d'un assistant sans mémoire : lui faire
  croire qu'il a déjà accepté de sortir de son rôle) ; une **preuve de travail**
  ouvre la conversation — ni tiers, ni cookie, ni case à cocher : le portail reste
  sans bandeau. Elle freine le script opportuniste ; les bornes opposables sont au
  Socle (cadence **par conversation** — l'`actor_id` est l'identifiant de
  conversation, jamais une adresse IP, même hachée — et plafond de la collectivité).
- **Rien n'est conservé ni journalisé du contenu**, ni ici ni au Socle. ⚠️ Ne pas
  ajouter de `console.*` qui cite un message. Le fil n'existe que dans l'onglet de
  l'usager : il est gardé en `sessionStorage` (jamais `localStorage`) pour survivre
  à un rechargement et à une navigation, et s'efface avec l'onglet ou par
  « Nouvelle conversation ». Trois clés, et elles seules : `nora.assistant` (le
  fil, qui porte aussi l'ORIGINE de chaque valeur), `nora.assistant.collect` (le
  recueil), `nora.assistant.ui` (la bulle est-elle ouverte — au doute, fermée). ⚠️ C'est le SEUL stockage que le portail écrit sur le
  poste du visiteur ; il est strictement fonctionnel, ne sert à aucune mesure et ne
  part nulle part — la mesure d'audience, elle, reste sans aucun stockage, la bulle
  n'est comptée nulle part, et `/assistant` n'est pas une page comptée. L'urgence (112, 15, 17, 18) est décidée sur **ses mots**, par une règle
  pure (`detectEmergency`), pas par le modèle.
- **L'assistant n'est jamais un passage obligé** : plafond atteint, cadence, panne,
  assistant fermé — chaque échec a son code (`AssistantFailure`) et renvoie vers
  les démarches, qui restent le chemin garanti.

Code : `supabase/functions/_shared/ai/` (`turn`, `prompt`, `conversation`,
`socleAi`, `signing`, `challenge` — tous purs, testés sans Deno),
`_shared/domain/{assistant,assistantTurn}.ts` (le contrat, partagé avec l'écran),
routes `POST /v1/assistant/defi` et `POST /v1/assistant` de `portal-api`,
`src/features/assistant/`. Secrets : voir `.env.example`.

## Ce qui n'est pas encore fait

Dans l'ordre prévu — le détail, les prérequis côté Socle et les questions
ouvertes sont dans `docs/roadmap.md` du Socle, section « Portail usagers » :

1. les **autres templates** (gabarits de page, autres pages que l'accueil,
   actualités) — le thème, lui, est appliqué depuis le 2026-09-08 ;
2. les démarches **hors compte** : la demande part déjà, il lui manque son après —
   confirmation par courriel et lien de suivi signé, donc le statut d'une demande
   consultable depuis le portail ;
3. les démarches **avec compte** (espace usager, rattaché au référentiel
   `contacts` du Socle) — dont un « Mon compte » où l'usager **modifie ses
   consentements** RGPD (le lot 1 du 2026-09-22 ne fait que les recueillir) ;
4. la **création de compte** ;
5. les **échanges** usager ↔ agent sur une demande ;
6. ~~les **pièces jointes**~~ — **livrées le 2026-09-08** (dépôt dès la sélection, formats et
   taille vérifiés par Iris, voir « Les pièces justificatives se déposent » ci-dessus) ;
7. **FranceConnect** — à instruire (habilitation, périmètre).

Transverse : accessibilité RGAA — la **déclaration** est désormais affichée au
pied de toutes les pages quand la collectivité l'a écrite. Un **relevé du
2026-09-15** (lecture du code, puis mesure dans le DOM de `sna27.edilumen.fr`
en production) estime le portail **partiellement conforme, ~70 à 75 %**, et
liste un lot à faire en une fois. ✅ **Ce lot est livré le 2026-09-18** :
- lien d'évitement ;
- `h1` de l'accueil, qui est le nom de la collectivité dans l'en-tête ;
- `header` et `footer` sortis de `main` ;
- un titre d'onglet par écran ;
- focus visible sur la recherche et les contrôles en `sr-only` ;
- l'erreur reliée à son contrôle (groupes et dépôt de fichier) ;
- `fieldset`, `autocomplete` ;
- le contour des champs à 3:1 (`--pt-field-border`) ;
- l'encre choisie par contraste et non plus sur le seuil faux de 0,4 ;
- le vert par défaut foncé en `#07854c`, pour qu'une collectivité sans charte
  ne soit plus servie hors conformité.

Restent ouverts : les deux navigations (12.1), les messages de statut (7.5),
le sélecteur de langue au `onChange` (7.4) et le miroir RTL. L'audit lui-même
reste à commander ; le détail est dans `docs/roadmap.md` du Socle,
§ « Accessibilité RGAA ». Et les autres mentions obligatoires d'un site public,
~~premier domaine réel~~ (**en ligne depuis le 2026-09-12** :
`laurentville.edilumen.fr`, construit par Cloudflare **au push sur `main`**), et
~~le multi-collectivités du dépôt~~ (**tranché le 2026-09-21** : une clé Iris par
collectivité, voir « Une instance, plusieurs collectivités — en dépôt aussi »).
