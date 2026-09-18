/**
 * Le rendu de l'arbre produit par `markdown.ts` — des éléments React, jamais
 * de HTML injecté. Voir l'en-tête de `markdown.ts` pour le pourquoi.
 *
 * ⚠️ **Les titres descendent d'un niveau** (`#` → `h2`) : la page porte déjà
 * son `h1` (« Déclaration d'accessibilité »), et un second `h1` casserait la
 * hiérarchie que lit un lecteur d'écran (RGAA 9.1).
 */
import type { ReactNode } from "react";
import { type Block, type Inline, parseMarkdown } from "./markdown.ts";

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "strong":
        return <strong key={index} className="font-bold">{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code key={index} className="rounded bg-[color:var(--pt-surface)] px-1 py-0.5 text-[0.9em]">
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={index}
            href={node.href}
            className="font-semibold text-[color:var(--brand-primary)] underline hover:no-underline"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

function renderLines(lines: Inline[][]): ReactNode[] {
  return lines.flatMap((line, index) =>
    index === 0 ? renderInline(line) : [<br key={"br" + index} />, ...renderInline(line)],
  );
}

const HEADING_CLASS = "font-bold text-[color:var(--pt-ink)]";

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.kind) {
    case "heading":
      if (block.level === 1) {
        return (
          <h2 key={index} className={"mt-8 text-[length:var(--pt-h2)] " + HEADING_CLASS}>
            {renderInline(block.children)}
          </h2>
        );
      }
      if (block.level === 2) {
        return (
          <h3 key={index} className={"mt-6 text-[length:var(--pt-body)] " + HEADING_CLASS}>
            {renderInline(block.children)}
          </h3>
        );
      }
      return (
        <h4 key={index} className={"mt-4 text-[length:var(--pt-body)] " + HEADING_CLASS}>
          {renderInline(block.children)}
        </h4>
      );
    case "paragraph":
      return (
        <p key={index} className="mt-3">
          {renderLines(block.lines)}
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="mt-1">
          {renderInline(item)}
        </li>
      ));
      return block.ordered ? (
        <ol key={index} className="mt-3 list-decimal pl-6">{items}</ol>
      ) : (
        <ul key={index} className="mt-3 list-disc pl-6">{items}</ul>
      );
    }
  }
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="text-[length:var(--pt-body)] leading-relaxed text-[color:var(--pt-ink)]">
      {parseMarkdown(source).map(renderBlock)}
    </div>
  );
}
