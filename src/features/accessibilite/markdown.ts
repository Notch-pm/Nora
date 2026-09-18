/**
 * Markdown → ARBRE, jamais → HTML.
 *
 * La déclaration d'accessibilité est rédigée en Markdown dans l'éditeur du
 * Socle, qui l'aperçoit avec son `renderMarkdown` (`src/features/procedures/
 * markdown.ts`). Ce module lit le MÊME sous-ensemble — titres `#` à `###`,
 * listes `-`/`*`/`1.`, paragraphes et sauts de ligne, `**gras**`, `*italique*`
 * / `_italique_`, `` `code` ``, liens `[texte](url)` — pour que ce que l'agent
 * voit dans l'aperçu soit ce que l'usager lit ici.
 *
 * ⚠️ **AUCUN `innerHTML`.** Le Socle produit une chaîne HTML échappée ; ici on
 * produit des nœuds, que React rend en éléments. Un texte venu d'un serveur
 * n'a donc AUCUN chemin vers le DOM autrement que comme texte — il n'y a rien à
 * échapper, donc rien à oublier d'échapper. Le Markdown n'apporte que les
 * balises que ce parseur sait nommer.
 *
 * ⚠️ **Les liens sont filtrés sur leur schéma** : `https`, `http`, `mailto`,
 * `tel`. Un `javascript:` ou un `data:` n'est pas un lien, il reste du texte —
 * son libellé seul s'affiche.
 *
 * Module PUR, testé sans DOM.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  /** `level` est celui du Markdown (`#` = 1) : le rendu le décale. */
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  /** Chaque ligne du paragraphe, dans l'ordre : l'auteur a choisi ses sauts. */
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

/** Les seuls schémas qu'un lien peut porter. */
export function safeHref(url: string): string | null {
  return /^(https?:\/\/|mailto:|tel:)/i.test(url.trim()) ? url.trim() : null;
}

interface Pattern {
  re: RegExp;
  /** Longueur du préfixe capturé AVANT la balise (italique `_`), à ne pas consommer. */
  lead?: (m: RegExpExecArray) => number;
  build: (m: RegExpExecArray) => Inline | Inline[];
}

// ⚠️ L'ORDRE COMPTE à position égale : `**` avant `*`, sans quoi un gras se
// lirait comme deux italiques vides. Pas de lookbehind (`(?<!…)`) : Safari ne
// le connaît que depuis la 16.4, et une expression rejetée à l'analyse ferait
// tomber le module entier — donc la page.
const PATTERNS: Pattern[] = [
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    build: (m) => {
      const href = safeHref(m[2]);
      const children = parseInline(m[1]);
      return href === null ? children : { kind: "link", href, children };
    },
  },
  { re: /`([^`]+)`/, build: (m) => ({ kind: "code", text: m[1] }) },
  { re: /\*\*([^*]+)\*\*/, build: (m) => ({ kind: "strong", children: parseInline(m[1]) }) },
  { re: /\*([^*\n]+)\*/, build: (m) => ({ kind: "em", children: parseInline(m[1]) }) },
  {
    // `_mot_`, mais pas `nom_de_fichier` : le soulignement doit être précédé
    // d'autre chose qu'une lettre ou un chiffre.
    re: /(^|[^A-Za-z0-9À-ÿ])_([^_\n]+)_(?![A-Za-z0-9À-ÿ])/,
    lead: (m) => m[1].length,
    build: (m) => ({ kind: "em", children: parseInline(m[2]) }),
  },
];

/** Le formatage en ligne d'un texte. */
export function parseInline(text: string): Inline[] {
  let best: { pattern: Pattern; match: RegExpExecArray; start: number } | null = null;
  for (const pattern of PATTERNS) {
    const match = pattern.re.exec(text);
    if (match === null) continue;
    const start = match.index + (pattern.lead?.(match) ?? 0);
    if (best === null || start < best.start) best = { pattern, match, start };
  }
  if (best === null) return text === "" ? [] : [{ kind: "text", text }];

  const end = best.match.index + best.match[0].length;
  const before = text.slice(0, best.start);
  const built = best.pattern.build(best.match);
  return [
    ...(before === "" ? [] : [{ kind: "text", text: before } as Inline]),
    ...(Array.isArray(built) ? built : [built]),
    ...parseInline(text.slice(end)),
  ];
}

/** Le texte entier, découpé en blocs. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  // Ce qui s'accumule entre deux blocs. Un objet plutôt que deux `let` : les
  // fonctions de vidage les réassignent, et TypeScript ne suit pas une
  // réassignation faite dans une fermeture.
  const pending: { paragraph: string[]; list: { ordered: boolean; items: string[] } | null } = {
    paragraph: [],
    list: null,
  };

  const flushParagraph = () => {
    if (pending.paragraph.length > 0) {
      blocks.push({ kind: "paragraph", lines: pending.paragraph.map(parseInline) });
    }
    pending.paragraph = [];
  };
  const flushList = () => {
    if (pending.list !== null && pending.list.items.length > 0) {
      blocks.push({
        kind: "list",
        ordered: pending.list.ordered,
        items: pending.list.items.map(parseInline),
      });
    }
    pending.list = null;
  };

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    const numbered = bullet === null ? /^\d+\.\s+(.*)$/.exec(trimmed) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      flushParagraph();
      const ordered = numbered !== null;
      // Une liste numérotée qui suit une liste à puces en est une autre.
      if (pending.list !== null && pending.list.ordered !== ordered) flushList();
      if (pending.list === null) pending.list = { ordered, items: [] };
      pending.list.items.push(item[1]);
      continue;
    }

    flushList();
    pending.paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}
