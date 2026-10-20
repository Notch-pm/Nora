/**
 * `safeRetour` face à un corpus de redirections ouvertes classiques. L'invariant
 * qui compte : tout ce qui est ACCEPTÉ, une fois résolu par un navigateur contre
 * l'origine du portail, reste sur cette origine.
 */
import { describe, expect, it } from "vitest";
import { connexionUrl, safeRetour } from "./retour.ts";

const ORIGIN = "https://sceaux.edilumen.fr";

const CORPUS = [
  "/", "/compte", "/demarches/abc?x=1#y", "/fr/../x", "/.//evil.example", "/%2F%2Fevil.example", "/%5Cevil.example",
  "//evil.example", "///evil.example", "/\\evil.example", "/\\/evil.example", "\\\\evil.example", "\\/evil.example",
  "https://evil.example", "http://evil.example", "HTTPS://EVIL.EXAMPLE", "javascript:alert(1)", "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "mailto:a@b.c",
  " /evil", "\t/evil", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000/evil", "/ /evil", "/​/evil.example",
  "/@evil.example", "/evil.example@", "@evil.example", "evil.example", "evil.example/x", ":evil", "/:evil", "?x=/evil", "#/evil",
  "/" + "a".repeat(511), "/" + "a".repeat(512), "/a?b=" + "c".repeat(600),
  "/..;/evil", "/%00", "/%0d%0aSet-Cookie:x=y", "/%u002f/evil",
];

describe("safeRetour — corpus de redirections ouvertes", () => {
  it.each(CORPUS)("%j : accepté ⇒ reste sur l'origine du portail", (raw) => {
    const accepted = safeRetour(raw);
    if (accepted === null) return;
    expect(accepted).toBe(raw);
    expect(new URL(accepted, ORIGIN).origin).toBe(ORIGIN);
    // Et le navigateur ne le lit jamais comme « même schéma, autre hôte ».
    expect(accepted.startsWith("//")).toBe(false);
    expect(accepted).not.toMatch(/[\\\u0000-\u001f\u007f]/);
  });

  it.each([
    "//evil.example", "///evil.example", "/\\evil.example", "\\\\evil.example", "https://evil.example", "javascript:alert(1)",
    "\t/evil", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\u0000/evil", "evil.example", "/" + "a".repeat(512),
  ])("%j : refusé", (raw) => {
    expect(safeRetour(raw)).toBeNull();
  });

  it("types inattendus : null, undefined, vide", () => {
    for (const raw of [null, undefined, ""]) expect(safeRetour(raw)).toBeNull();
    expect(safeRetour(42 as unknown as string)).toBeNull();
    expect(safeRetour({} as unknown as string)).toBeNull();
  });

  it("connexionUrl : un retour dangereux n'est jamais ajouté, un retour sûr est encodé", () => {
    expect(connexionUrl("/compte/connexion", "//evil.example")).toBe("/compte/connexion");
    expect(connexionUrl("/compte/connexion", "/demarches/a b?x=1&y=2")).toBe("/compte/connexion?retour=%2Fdemarches%2Fa%20b%3Fx%3D1%26y%3D2");
  });
});
