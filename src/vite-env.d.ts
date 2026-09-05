/// <reference types="vite/client" />

/**
 * Configuration de l'INTERFACE. Rien ici n'est un secret : tout ce qui est
 * `VITE_*` est inliné dans le bundle et lisible par n'importe qui.
 *
 * ⚠️ L'URL et la clé du Socle n'ont donc RIEN à faire ici : elles vivent dans
 * les secrets de l'edge function `portal-api` (voir .env.example).
 */
interface ImportMetaEnv {
  /** Racine de `portal-api`, le backend du portail. API publique, pas un secret. */
  readonly VITE_PORTAL_API_URL?: string;
  /** Durée du cache mémoire de l'onglet, en secondes. `0` le désactive. */
  readonly VITE_PORTAL_CACHE_TTL_SECONDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
