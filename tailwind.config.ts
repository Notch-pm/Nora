import type { Config } from "tailwindcss";

// Volontairement nu : la charte graphique par collectivité (logos, couleurs)
// est servie par le Socle (`GET /v1/organizations/{id}/branding`, héritage déjà
// résolu) et s'appliquera en variables CSS posées au moment du rendu — pas en
// thème compilé, qui ne saurait pas être multi-tenant.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
