# Tests de l'espace usager (Nora)

Plan de tests automatiques de la « partie usagers » (projet Sceaux, lots L1 à L3c).
Les dépôts Iris et Socle portent leur part (branche `test/espace-usager`, dossiers
`supabase/functions/requests-api/espace-usager/` et
`supabase/functions/contacts-api/espace-usager/`).

## Lancer

```bash
npx vitest run                                              # tout (unitaires, flux, SQL, interface)
npx vitest run supabase/functions/_shared/espaceUsager      # flux serveur + SQL (PGlite)
npx vitest run src/features/compte src/features/demarche   # écrans (jsdom + testing-library + axe-core)
npx vitest run worker                                       # relais de même origine
npx tsc -b                                                  # types (tests compris)
```

Aucun Postgres, aucun Deno, aucun réseau : PGlite (Postgres en WebAssembly) rejoue
les VRAIES migrations ; portal-api est exécuté pour de bon derrière le VRAI Worker
de relais (`worker/proxy.ts`) ; GoTrue, le Socle et Iris sont des modèles du contrat
(`harness/fakes.ts`).

## Niveaux

| Niveau | Fichiers | Ce qu'il prouve |
|---|---|---|
| SQL (PGlite) | `migrations.sql.test.ts` | RLS « tout refuser », droits `service_role` seuls, sessions (inactivité, expiration, tenant), verrou 10 essais / 15 min, quota 5 courriels / h, TOTP (rejeu), t10, fiche de l'espace (unique, jamais remplacée), purge |
| Flux serveur | `parcours.e2e.test.ts` | inscription → lien → mot de passe → connexion → profil → dépôt → « Mes demandes » ; états vides, erreurs d'API |
| Anti-fuite | `antiFuite.e2e.test.ts` | deux comptes, deux villes : IDOR, 404 uniformes, sentinelles internes, jeton Iris lié à la session, pas d'identifiant dans les réponses |
| Sécurité | `securite.e2e.test.ts` | CSRF (15 écritures × 3 variantes), session liée à la ville, inactivité, révocation, verrouillage (y compris en parallèle), énumération, durée plancher 900 ms, freins, corps démesurés, pièces 20 Mo, défi, TOTP |
| Robustesse | `robustesse.e2e.test.ts` | identifiants forgés, méthodes, anomalies A1 à A3 (`it.fails`) |
| Relais | `worker/proxy.securite.test.ts` | liste blanche d'en-têtes dans les deux sens, hôte certifié, chemins, 502/503, A5, O1 |
| Unitaires | `iris/citizenToken.test.ts`, `iris/mesDemandesService.test.ts`, `socle/citizenContacts.test.ts` | jeton (vecteur partagé avec Iris), liste blanche, URL et statuts |
| Écrans | `src/features/**/*.test.tsx`, `src/services/portal/depot.espaceUsager.test.ts`, `retour.adversarial.test.ts` | connexion, inscription, confirmation, mot de passe oublié, « Mes demandes », consentements (3 états), démarches réservées ; accessibilité de base (axe-core) |

## Anomalies laissées en échec attendu (`it.fails`)

Le code de production n'est pas corrigé par ces tests : chaque anomalie est un test
qui DOIT passer le jour où elle est corrigée (Vitest signalera alors « expected to fail »).

| Id | Où | Constat |
|---|---|---|
| A1 | `portal-api/index.ts` (`decodeURIComponent` de `/v1/demarches/{id}`) | un `%` mal formé lève `URIError` non rattrapée (500 au lieu de 404) |
| A2 | `domain/profil.ts` `parseIdentite` | date de naissance contrôlée par sa forme seulement (`1990-02-31` passe) |
| A3 | `portal-api/index.ts` dépôt connecté | `requester` du corps transmis tel quel (relecture L3c M1) |
| A4 | `services/portal/portalClient.ts` `KNOWN_FAILURES` | `account_required` absent : l'encart « réservée aux connectés » ne s'affiche jamais après un refus serveur |
| A5 | `worker/index.ts` l. 19 | `upstreamRequest` hors du `try` : une construction de requête qui échoue fait lever le Worker (constaté en production : `GET /api/v1/session%` → 500 « error code: 1101 » Cloudflare, sans JSON) |
| O1 | `worker/proxy.ts` | `..%2f` n'est pas rejeté dans le chemin relayé (défense en profondeur) |
