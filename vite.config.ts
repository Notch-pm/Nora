/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // Logique pure partagée avec l'edge function : le contrat du portail
      // (Tenant, Demarche, codes d'erreur) est écrit UNE fois, côté serveur,
      // et l'interface l'importe au lieu de le redéclarer — motif Iris.
      "@fn": path.resolve(import.meta.dirname, "./supabase/functions"),
    },
  },
  server: {
    // 5173 Socle, 5174 Iris, 5175 Nora — les trois tournent ensemble.
    port: 5175,
    // Le portail se teste en local sur `nantes.localhost:5175`,
    // `angers.localhost:5175`… (voir .env.example). Deux réglages le rendent
    // possible, et aucun n'est décoratif :
    //   · `host: true` écoute sur toutes les interfaces. Par défaut Vite se lie
    //     au seul `localhost`, que Node résout ici en ::1 — or les navigateurs
    //     résolvent `nantes.localhost` en 127.0.0.1, et n'atteindraient rien ;
    //   · `allowedHosts` autorise ces sous-domaines : le contrôle d'hôte de
    //     Vite rejette par défaut tout ce qui n'est pas `localhost` exactement.
    host: true,
    allowedHosts: [".localhost"],
  },
  test: {
    // Tout ce qui est testé ici est pur (résolution, filtrage, formatage
    // d'erreurs) : environnement Node, pas de DOM. Passer à "jsdom" le jour où
    // l'interface vaudra des tests de composants.
    environment: "node",
    globals: true,
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.ts",
    ],
  },
});
