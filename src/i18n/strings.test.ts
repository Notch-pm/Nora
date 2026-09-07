import { describe, expect, it } from "vitest";
import {
  COVERED_LANGUAGES,
  OPERATOR_ONLY_KEYS,
  STRINGS,
  type StringKey,
} from "./strings.ts";
import { errorText, interpolate, t, tn } from "./t.ts";

/**
 * Ce que ce test empêche, et qui est arrivé ailleurs :
 *
 *  • une clé ajoutée sans ses traductions, qui passe la revue et s'affiche en
 *    français au milieu d'une page anglaise sans que personne ne le sache ;
 *  • un marqueur perdu à la traduction (`{count}` qui disparaît en espagnol),
 *    qui fait afficher une phrase amputée de son nombre ;
 *  • un pluriel écrit à moitié, dont la forme manquante retombe silencieusement
 *    sur l'autre.
 *
 * Il tourne en CI : ajouter une clé sans la traduire fait échouer le build,
 * c'est-à-dire au bon moment.
 */

const KEYS = Object.keys(STRINGS) as StringKey[];

/** Les marqueurs `{nom}` d'une chaîne, dédoublonnés et triés. */
function markers(text: string): string[] {
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();
}

describe("le dictionnaire est complet", () => {
  it("porte au moins une clé, et le français partout", () => {
    expect(KEYS.length).toBeGreaterThan(50);
    for (const key of KEYS) {
      expect(STRINGS[key].fr, key).toBeTruthy();
    }
  });

  it("traduit chaque clé dans chaque langue couverte", () => {
    const manquantes: string[] = [];
    for (const key of KEYS) {
      // Sauf celles qui parlent à l'exploitant : l'exception est déclarée.
      if (OPERATOR_ONLY_KEYS.includes(key)) continue;
      for (const lang of COVERED_LANGUAGES) {
        const entry = STRINGS[key] as Record<string, string | undefined>;
        if (!entry[lang] || entry[lang]!.trim() === "") manquantes.push(`${key} / ${lang}`);
      }
    }
    expect(manquantes).toEqual([]);
  });

  it("garde les mêmes marqueurs dans toutes les langues", () => {
    // Le bug exact de la borne d'Ariane : un `{plural}` disparu en traduction,
    // et une phrase qui perd son nombre.
    const ecarts: string[] = [];
    for (const key of KEYS) {
      const entry = STRINGS[key] as Record<string, string | undefined>;
      const attendus = markers(entry.fr!).join(",");
      for (const [lang, text] of Object.entries(entry)) {
        if (!text) continue;
        if (markers(text).join(",") !== attendus) ecarts.push(`${key} / ${lang}`);
      }
    }
    expect(ecarts).toEqual([]);
  });

  it("écrit les pluriels par paires", () => {
    for (const key of KEYS) {
      if (!key.endsWith(".one")) continue;
      expect(KEYS, key).toContain(key.replace(/\.one$/, ".other"));
    }
  });
});

describe("les clés d'exploitation restent en français, et le disent", () => {
  it("n'est traduite dans aucune langue", () => {
    for (const key of OPERATOR_ONLY_KEYS) {
      expect(Object.keys(STRINGS[key]), key).toEqual(["fr"]);
    }
  });

  it("reste lisible malgré tout : le repli sert", () => {
    expect(t("en", "error.not_configured.title")).toBe("Portail non configuré");
  });
});

describe("t — le repli est par CLÉ, pas par langue", () => {
  it("rend la traduction quand elle existe", () => {
    expect(t("en", "page.retry")).toBe("Try again");
  });

  it("retombe sur le français, clé par clé, pour une langue non couverte", () => {
    // Le breton n'est pas couvert : l'usager lit sa collectivité en breton
    // (démarches, blocs de page), et l'outil en français.
    expect(t("br", "page.retry")).toBe("Réessayer");
  });

  it("ne rebascule pas tout le portail parce qu'une clé manque", () => {
    // Une langue couverte à 90 % affiche les 10 % restants en français : les
    // 90 autres pour cent restent traduits.
    expect(t("es", "page.loading")).toBe("Cargando…");
  });
});

describe("interpolate", () => {
  it("remplace TOUTES les occurrences d'un marqueur", () => {
    // Le `replace` non global d'Ariane laissait la seconde à l'écran.
    expect(interpolate("{n} sur {n}", { n: 3 })).toBe("3 sur 3");
  });

  it("laisse visible un marqueur non fourni", () => {
    // Visible, ça se corrige ; `undefined` se lit comme un bogue de l'usager.
    expect(interpolate("Environ {n} minutes", {})).toBe("Environ {n} minutes");
  });

  it("ne touche à rien sans paramètres", () => {
    expect(interpolate("Bonjour")).toBe("Bonjour");
  });
});

describe("tn — le pluriel de CHAQUE langue", () => {
  it("choisit la forme française", () => {
    expect(tn("fr", "form.errors", 1)).toBe("Une information doit être corrigée avant l'envoi.");
    expect(tn("fr", "form.errors", 3)).toContain("3 informations");
  });

  it("choisit la forme anglaise", () => {
    expect(tn("en", "form.errors", 1)).toContain("One field");
    expect(tn("en", "form.errors", 4)).toContain("4 fields");
  });

  it("ne colle pas un pluriel français sur une langue qui n'en a pas", () => {
    // En chinois, une seule forme — et surtout pas un « s » ajouté au bout.
    expect(tn("zh", "form.maxFiles", 1)).toBe("最多 1 个文件");
    expect(tn("zh", "form.maxFiles", 5)).toBe("最多 5 个文件");
  });

  it("retombe sur `.other` quand la forme exacte n'existe pas", () => {
    // Le russe distingue `few` : la clé n'existe pas, la forme générale sert.
    expect(tn("ru", "form.errors", 3)).toContain("3");
  });
});

describe("errorText", () => {
  it("rend la phrase d'un code d'erreur de saisie", () => {
    expect(errorText("en", { key: "validation.required" })).toBe("This information is required.");
    expect(errorText("fr", { key: "validation.maxLength", params: { n: 40 } }))
      .toBe("40 caractères au maximum.");
  });

  it("rend null quand il n'y a pas d'erreur", () => {
    expect(errorText("fr", null)).toBeNull();
    expect(errorText("fr", undefined)).toBeNull();
  });
});
