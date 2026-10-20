# Tests de l'espace usager (Nora)

Plan de tests automatiques de la « partie usagers » (projet Sceaux, lots L1 à L4b).
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
| Flux serveur | `parcours.e2e.test.ts`, `depot.e2e.test.ts` | inscription → lien → mot de passe → connexion → profil → dépôt → « Mes demandes » ; états vides, erreurs d'API ; L4a : renvoi du code perdu (`/v1/suivi/renvoi`) ; L4b : réponse en ligne par `/v1/suivi/demande/messages` et `/v1/compte/demandes/{id}/messages` |
| Anti-fuite | `antiFuite.e2e.test.ts` | deux comptes, deux villes : IDOR, 404 uniformes, sentinelles internes, jeton Iris lié à la session, pas d'identifiant dans les réponses |
| Sécurité | `securite.e2e.test.ts` | CSRF (15 écritures × 3 variantes), session liée à la ville, inactivité, révocation, verrouillage (y compris en parallèle), énumération, durée plancher 900 ms, freins, corps démesurés, pièces 20 Mo, défi, TOTP |
| Robustesse | `robustesse.e2e.test.ts` | identifiants forgés, méthodes, anomalies A1 à A3 (désormais des tests ordinaires) |
| Relais | `worker/proxy.securite.test.ts` | liste blanche d'en-têtes dans les deux sens, hôte certifié, chemins, 502/503, A5, O1 |
| Unitaires | `iris/citizenToken.test.ts`, `iris/mesDemandesService.test.ts`, `socle/citizenContacts.test.ts` | jeton (vecteur partagé avec Iris), liste blanche, URL et statuts |
| Écrans | `src/features/**/*.test.tsx`, `src/services/portal/depot.espaceUsager.test.ts`, `retour.adversarial.test.ts` | connexion, inscription, confirmation, mot de passe oublié, « Mes demandes », consentements (3 états), démarches réservées ; L4 : `src/features/suivi/CodePerdu.test.tsx` (code perdu), `ReplyForm.test.tsx` (formulaire « Répondre ») ; accessibilité de base (axe-core) |
| Services (L4) | `iris/suiviService.test.ts` | appels Iris du suivi, dont la réponse en ligne |

## Anomalies

Plus aucun `it.fails` dans le code : les anomalies A1 à A5 et O1, d'abord laissées en échec
attendu, ont été **corrigées le 2026-10-20** et leurs tests sont des tests ordinaires.
Restent à trancher par le PO (pas de test) : verrouillage d'un compte par un tiers
(11 essais) et noms non latins jamais rattachés à une fiche. Détail : `03-avancement.md`
du dossier Sceaux.
