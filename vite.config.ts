/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import { loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Proxy de développement : relaie `/api/*` vers portal-api comme le Worker du
 * portail en production (`worker/proxy.ts`) — hôte visité, adresse et secret
 * compris. Actif seulement si `PORTAL_API_PROXY_TARGET` et `NORA_PROXY_SECRET`
 * sont posés dans `.env.local` ; lus ici, jamais inlinés dans le bundle.
 */
function devApiProxy(mode: string): Record<string, ProxyOptions> | undefined {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.PORTAL_API_PROXY_TARGET;
  const secret = env.NORA_PROXY_SECRET;
  if (!target || !secret) return undefined;
  return {
    "/api": {
      target,
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/api/, ""),
      configure(proxy) {
        proxy.on("proxyReq", (proxyReq, req) => {
          // Comme le Worker : le visiteur ne pose jamais lui-même les en-têtes certifiés.
          proxyReq.removeHeader("x-nora-client-ip");
          proxyReq.setHeader("x-nora-proxy-secret", secret);
          proxyReq.setHeader("x-nora-host", (req.headers.host ?? "").split(":")[0]);
        });
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
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
    proxy: devApiProxy(mode),
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
      "worker/**/*.{test,spec}.ts",
    ],
  },
}));
