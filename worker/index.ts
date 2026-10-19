/**
 * Le Worker Cloudflare du portail.
 *
 * Il sert les fichiers statiques (`dist/`) comme avant, et relaie `/api/*` vers
 * `portal-api` (voir `proxy.ts`). Seul `/api/*` passe par ce code
 * (`run_worker_first` dans `wrangler.jsonc`) : les pages et leurs ressources
 * restent servies directement par la couche d'assets.
 */
import { downstreamResponse, isApiPath, type ProxyEnv, upstreamRequest } from "./proxy.ts";

interface Env extends ProxyEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!isApiPath(url.pathname)) return env.ASSETS.fetch(request);
    const upstream = upstreamRequest(request, env);
    if (upstream instanceof Response) return upstream;
    try {
      return downstreamResponse(await fetch(upstream));
    } catch {
      return new Response(
        JSON.stringify({
          error: { code: "portal_unreachable", message: "Le service est momentanément indisponible." },
        }),
        { status: 502, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } },
      );
    }
  },
};
