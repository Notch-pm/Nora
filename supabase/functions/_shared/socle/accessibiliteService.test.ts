import { describe, expect, it } from "vitest";
import { getAccessibilityStatement } from "./accessibiliteService.ts";
import { parseStatement } from "../domain/accessibilite.ts";
import type { SocleClient, SocleReply } from "./socleClient.ts";

const replying = (reply: SocleReply): SocleClient => ({ get: async () => reply });

describe("getAccessibilityStatement", () => {
  it("demande au Socle le contenu `accessibilite` du tenant", async () => {
    const paths: string[] = [];
    const socle: SocleClient = {
      get: async (path) => {
        paths.push(path);
        return { kind: "not_found" };
      },
    };
    await getAccessibilityStatement("t 1", socle);
    expect(paths).toEqual(["/v1/portal/content?tenant_id=t%201&slug=accessibilite"]);
  });

  it("sert le texte publié", async () => {
    const result = await getAccessibilityStatement(
      "t1",
      replying({
        kind: "ok",
        body: {
          slug: "accessibilite",
          published_at: "2026-09-18T10:00:00Z",
          format: "markdown",
          body: "# État de conformité",
        },
      }),
    );
    expect(result).toEqual({ ok: true, statement: { body: "# État de conformité" } });
  });

  it("⚠️ 404 n'est pas une panne : rien n'est publié", async () => {
    expect(await getAccessibilityStatement("t1", replying({ kind: "not_found" }))).toEqual({
      ok: true,
      statement: null,
    });
  });

  it("une clé refusée et un Socle injoignable sont deux pannes distinctes", async () => {
    expect(await getAccessibilityStatement("t1", replying({ kind: "auth_failed" }))).toEqual({
      ok: false,
      reason: "socle_misconfigured",
    });
    expect(await getAccessibilityStatement("t1", replying({ kind: "unreachable" }))).toEqual({
      ok: false,
      reason: "socle_unavailable",
    });
  });
});

describe("parseStatement", () => {
  it("écarte ce qui n'est pas un texte Markdown non vide", () => {
    for (const raw of [null, "texte", [], { body: 42 }, { body: "  " }, { format: "html", body: "<p>x</p>" }]) {
      expect(parseStatement(raw)).toBeNull();
    }
  });

  it("accepte une réponse sans `format` — le Markdown est le seul format servi", () => {
    expect(parseStatement({ body: "Déclaration" })).toEqual({ body: "Déclaration" });
  });
});
