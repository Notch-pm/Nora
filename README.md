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
  features/accessibilite/ La déclaration d'accessibilité (`/accessibilite`).
    AccessibilitePage.tsx  la page, dans le cadre d'une démarche (`DemarcheShell`)
    markdown.ts            Markdown → ARBRE (jamais → HTML) : le sous-ensemble de l'aperçu du Socle
    Markdown.tsx           l'arbre → éléments React, titres décalés d'un niveau
    SkipLink.tsx           le lien d'évitement, premier tabulable de chaque écran (RGAA 12.7)
    errorMessages.ts       un message par PortalFailure
  features/demarche/     La démarche : la lire, la remplir, la déposer.
    DemarchePage.tsx       la présentation (descriptif, durée, organismes, pièces attendues)
    FormulairePage.tsx     le formulaire, le dépôt, l'accusé
    FormFields.tsx         un contrôle par type de champ — le rendu de référence côté usager
    RequesterSection.tsx   « Vos informations » (`fieldset`), piloté par requester_config
    autocomplete.ts        le jeton `autocomplete` de chaque champ d'identité (RGAA 11.13)
    DemarcheShell.tsx      le cadre commun (charte, en-tête, chargement, erreur)
    formulaire.ts          règles pures : visibilité, obligation, validation, form_data, identité
    useDemarche.ts         le chargement d'une démarche

supabase/functions/
  _shared/
    domain/              Le modèle du PORTAIL — Tenant, Demarche, HomePage, Branding, PortalTheme,
                         PortalFailure, Demande, plus les MIROIRS du schéma possédé par le Socle :
                         formSchema.ts + conditions.ts (lecture tolérante), requesterConfig.ts
                         et theme.ts (snake_case du contrat → camelCase du portail).
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

### Le dépôt

`POST /v1/demandes` sur `portal-api`, qui traduit vers l'enveloppe d'ingestion d'Iris. Trois
vérifications, toutes **côté serveur**, parce qu'aucune ne peut être déléguée à un navigateur :

1. **la collectivité** vient du domaine visité (`Origin`), jamais du corps de la requête ;
2. **la démarche est revérifiée** au catalogue publié avant l'envoi — sans quoi le portail
   deviendrait un moyen de déposer sur une démarche en brouillon ou fermée ;
3. **l'organisme destinataire** doit faire partie de ceux qui proposent la démarche.

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

## Raccordement à Iris

Iris n'a **aucune logique propre à un émetteur** : le portail y est une *source enregistrée*, au
même titre qu'un connecteur courrier. Le raccordement est donc du **provisioning**, pas du code —
rien à déployer, quatre étapes en base et deux secrets.

Le principe tient en une phrase : **la clé n'existe en clair qu'à un seul endroit**, les secrets de
`portal-api`. Iris n'en garde que l'empreinte SHA-256 et rehache ce qu'il reçoit à chaque appel.
D'où l'ordre des étapes — générer, poser l'empreinte, poser le clair.

| Où | Quoi |
| --- | --- |
| Iris — `integration_credentials.key_hash` | l'empreinte SHA-256, 64 caractères hexadécimaux |
| Nora — secret `IRIS_API_KEY` | la clé en clair |

### 0. Vérifier que la collectivité existe dans Iris

**À ne pas sauter.** Iris travaille sur son propre miroir du référentiel, alimenté par
`sync-socle-referentiel`. Si la racine n'y figure pas, les deux `insert … select` de l'étape 2
n'insèrent **rien et ne lèvent aucune erreur** — un `INSERT 0` silencieux. L'échec ne se manifeste
qu'au premier dépôt, sous la forme d'un « clé inconnue » qui désigne une tout autre cause.

```sql
select id, name, socle_org_id
from organizations
where socle_org_id = '<uuid racine Socle>';
```

Zéro ligne → lancer `sync-socle-referentiel` avant toute chose.

### 1. Générer la clé

Hors de tout dépôt et de toute conversation — la sortie contient un secret :

```bash
node -e "const c=require('crypto');const k='irs_'+c.randomBytes(24).toString('hex');console.log('clé      :',k);console.log('préfixe  :',k.slice(0,12));console.log('sha256   :',c.createHash('sha256').update(k).digest('hex'))"
```

Trois sorties, trois destinations : le **sha256** et le **préfixe** vont en base (étape 2), la
**clé** va dans les secrets (étape 3). Le préfixe ne sert qu'à repérer une clé dans une liste, il
n'ouvre rien — c'est un champ d'affichage.

### 2. Déclarer la source et la clé dans Iris

⚠️ **Remplacer réellement les `<…>`.** Rien ici n'est validé : une empreinte valant littéralement
`<sha256>` s'insère sans broncher, et se paie d'un « clé inconnue » à la première demande.

```sql
insert into integration_sources (organization_id, code, name, status)
select id, 'portail-citoyen', 'Portail usagers (Nora)', 'active'
from organizations where socle_org_id = '<uuid racine Socle>'
on conflict (organization_id, code) do nothing;

insert into integration_credentials
  (integration_source_id, name, key_prefix, key_hash, scopes, expires_at)
select s.id, 'Nora — production', '<12 premiers caractères>', '<sha256 hexadécimal>',
       array['requests:write'], now() + interval '12 months'
from integration_sources s
join organizations o on o.id = s.organization_id
where s.code = 'portail-citoyen'
  and o.socle_org_id = '<uuid racine Socle>';
```

Les deux doivent répondre `INSERT 0 1`. Un `INSERT 0 0` renvoie à l'étape 0.

⚠️ Le code **`portail-citoyen`** n'est pas décoratif : `portal-api` l'envoie comme `source_system`,
et Iris refuse en **403** si les deux diffèrent. `IRIS_SOURCE_SYSTEM` permet d'en changer — à
condition de changer les deux.

### 3. Poser les secrets sur `portal-api`

Par le tableau de bord Supabase (*Edge Functions → Secrets*) ou par la CLI, depuis le dépôt Nora :

```bash
supabase secrets set \
  IRIS_API_URL=https://<ref-iris>.supabase.co/functions/v1/requests-api \
  IRIS_API_KEY=<la clé irs_…>
```

Pas de redéploiement nécessaire : `portal-api` lit `Deno.env` à chaque requête, le changement prend
effet au prochain démarrage du worker.

⚠️ **Regénérer une clé, c'est deux gestes** — mettre à jour `key_hash` en base *et* reposer
`IRIS_API_KEY`. N'en faire qu'un laisse le portail avec une clé qu'Iris ne connaît plus, et le
symptôme est le même que si rien n'avait été fait.

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
| 401 « Clé d'intégration inconnue » | `key_hash` ne correspond pas à la clé posée sur Nora |
| 401 « expirée » / « révoquée » | `expires_at` dépassé, ou `revoked_at` renseigné |
| 403 « Intégration suspendue » | `integration_sources.status` ≠ `'active'` |
| 403 « source_system ne correspond pas » | le `code` de la source ≠ `IRIS_SOURCE_SYSTEM` |
| 403 sur la racine | la collectivité du domaine visité n'est pas celle de la clé — voir « Plusieurs portails » |

⚠️ Le portail traduit **tous** ces cas en `iris_misconfigured`, dont le message invite l'usager à
« réessayer dans quelques instants ». C'est trompeur pour une panne de paramétrage, qui ne se
résoudra pas d'elle-même. À revoir le jour où l'on distinguera l'indisponible du mal configuré.

### Ce qu'Iris enregistre

Une demande déposée porte `source = 'portail-citoyen'`, la racine Socle de la collectivité,
l'organisme destinataire s'il a été choisi, `external_ref` = l'identifiant de dépôt, et un
`form_data` réduit aux seules clés que le formulaire déclare.

L'identité part **non traduite** dans `requester_snapshot.declared` — `courriel`, `nom_usuel`,
`siret`… tels que le Socle les nomme. Iris tente de la rapprocher de son référentiel `contacts`,
puis de créer une fiche. S'il n'y parvient pas, il **n'échoue pas** : la demande est enregistrée
avec `identity_status = 'non_rapprochee'` et l'anomalie `usager_a_creer_dans_socle`, qu'un agent
traite à l'instruction. Un Socle muet ne doit jamais faire perdre une demande.

## Plusieurs portails, ou un portail multi-collectivités ?

C'est la **question ouverte la plus structurante** du portail, et elle n'est pas tranchée.

En l'état, l'instance est **multi-collectivités en lecture** et **mono-collectivité en dépôt** :

| | Multi-tenant ? | Pourquoi |
| --- | --- | --- |
| Lire — accueil, démarches, formulaire | **oui** | la collectivité vient du domaine visité, et la clé Socle est une clé *plateforme* : elle résout tous les domaines |
| Déposer — `POST /v1/demandes` | **non** | la clé Iris est liée à UNE source, elle-même liée à UN tenant ; Iris rejette en 403 toute enveloppe dont la racine diffère |

Un dépôt depuis un domaine porté par une **sous-organisation** bute sur la même règle.

Deux directions, qui ne coûtent pas la même chose :

**A — une instance, un registre de clés par collectivité.** `portal-api` choisit la clé Iris
d'après le tenant qu'il vient de résoudre. La promesse « une instance sert toutes les
collectivités » tient alors de bout en bout, et ajouter une collectivité reste une ligne dans
`organization_domains`. Prix : il faut un endroit où ranger N secrets — les secrets d'edge function
sont plats — donc une table chiffrée côté Socle, ou un secret unique portant un JSON, et une
rotation à instruire collectivité par collectivité.

**B — un déploiement par collectivité.** Chaque portail a ses propres secrets, donc sa propre clé
Iris, et le problème disparaît sans écrire une ligne. Prix : N déploiements à tenir à jour, N
domaines à configurer, et surtout le multi-tenant du portail devient inutile — la résolution par
`Origin`, `PORTAL_DEV_DOMAIN_SUFFIX`, le cache par hostname perdent leur raison d'être. Ce qui est
aujourd'hui le cœur de l'architecture deviendrait du code mort.

Trois questions à trancher avant d'écrire quoi que ce soit :

- une collectivité aura-t-elle un jour **plusieurs domaines** (une marque par commune membre) ?
- le portail reste-t-il **une application déployée**, ou devient-il un gabarit qu'on instancie ?
- Iris peut-il délivrer une clé **plateforme** couvrant plusieurs tenants, comme le Socle en a une ?
  C'est le point de bascule : si oui, l'option A se réduit à presque rien, et B perd son seul
  avantage.

Tant que la question n'est pas tranchée, **une seule collectivité peut déposer**. Les autres
consultent et remplissent normalement ; leur dépôt échoue sur l'autorisation d'Iris.

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
  IRIS_API_KEY=<clé d'intégration irs_…, scope requests:write>
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
- ⚠️ **Le Markdown n'est jamais injecté** (`markdown.ts`) : parseur → arbre →
  éléments React, liens limités à `https`/`http`/`mailto`/`tel`. Un texte venu
  du serveur n'a aucun chemin vers le DOM autrement que comme texte.
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

## Ce qui n'est pas encore fait

Dans l'ordre prévu — le détail, les prérequis côté Socle et les questions
ouvertes sont dans `docs/roadmap.md` du Socle, section « Portail usagers » :

1. les **autres templates** (gabarits de page, autres pages que l'accueil,
   actualités) — le thème, lui, est appliqué depuis le 2026-09-08 ;
2. les démarches **hors compte** : la demande part déjà, il lui manque son après —
   confirmation par courriel et lien de suivi signé, donc le statut d'une demande
   consultable depuis le portail ;
3. les démarches **avec compte** (espace usager, rattaché au référentiel
   `contacts` du Socle) ;
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
surtout **le multi-collectivités du dépôt** — voir
« Plusieurs portails, ou un portail multi-collectivités ? ». C'est un choix
d'architecture, pas une tâche : il conditionne si cette instance reste unique.
