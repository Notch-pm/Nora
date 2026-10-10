// Génère `src/features/portal/categoryIcons.ts` : le dessin des pictogrammes de
// catégorie que le Socle propose (`categories.icon`).
//
// Nora n'embarque pas Lucide : on recopie ici les tracés des seules icônes du
// catalogue (licence ISC, mention conservée dans le fichier produit). La liste
// des valeurs est LUE dans le Socle (`src/features/categories/icon-options.ts`),
// jamais retapée : c'est lui qui la possède.
//
//   node scripts/generate-category-icons.mjs ../socle
//
// Le dépôt du Socle doit avoir ses dépendances installées (`npm ci`).
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const soclePath = resolve(process.argv[2] ?? "../socle");
const options = readFileSync(join(soclePath, "src/features/categories/icon-options.ts"), "utf8");
const values = [...options.matchAll(/value: "([a-z0-9-]+)"/g)].map((m) => m[1]);
if (values.length === 0) throw new Error("Aucune valeur trouvée dans icon-options.ts");

const iconsDir = join(soclePath, "node_modules/lucide-react/dist/esm/icons");
const lucideVersion = JSON.parse(
  readFileSync(join(soclePath, "node_modules/lucide-react/package.json"), "utf8"),
).version;

function nodesOf(value) {
  let source = readFileSync(join(iconsDir, `${value}.js`), "utf8");
  // Un ancien nom (`home`) n'est qu'un réexport du nouveau (`house`).
  const alias = /export \{ default \} from '\.\/([a-z0-9-]+)\.js';/.exec(source);
  if (alias) source = readFileSync(join(iconsDir, `${alias[1]}.js`), "utf8");
  const match = /createLucideIcon\("[^"]+", (\[[\s\S]*\])\);/.exec(source);
  if (!match) throw new Error(`Tracé introuvable pour ${value}`);
  // Le fichier vient de node_modules du Socle — du code tiers figé par son
  // lockfile ; on n'en évalue que le littéral du tableau.
  const nodes = Function(`"use strict"; return (${match[1]});`)();
  return nodes.map(([tag, attrs]) => {
    const { key: _key, ...rest } = attrs;
    return [tag, rest];
  });
}

const lines = values.map((value) => `  ${JSON.stringify(value)}: ${JSON.stringify(nodesOf(value))},`);

const out = `/**
 * ⚠️ FICHIER GÉNÉRÉ — ne pas éditer à la main :
 *   node scripts/generate-category-icons.mjs ../socle
 *
 * Les pictogrammes de catégorie que le Socle propose (\`categories.icon\`,
 * servi par \`/v1/portal/procedures\` depuis le contrat 1.41.0), dessinés avec
 * les tracés de Lucide ${lucideVersion} (licence ISC, © Lucide Contributors).
 * La liste des valeurs est celle de \`src/features/categories/icon-options.ts\`
 * du Socle ; un test l'épingle des deux côtés. Une valeur absente d'ici — le
 * Socle a allongé son catalogue avant que ce fichier soit régénéré — se dessine
 * avec le pictogramme neutre (\`file-text\`).
 */

/** Un élément SVG : sa balise et ses attributs (\`d\`, \`cx\`, \`x\`…). */
export type IconNode = Array<[string, Record<string, string | number>]>;

export const CATEGORY_ICONS: Record<string, IconNode> = {
${lines.join("\n")}
};

/** Le pictogramme neutre : une démarche sans catégorie, ou une valeur inconnue. */
export const FALLBACK_CATEGORY_ICON = "file-text";
`;

writeFileSync(resolve("src/features/portal/categoryIcons.ts"), out);
console.log(`${values.length} pictogrammes écrits (Lucide ${lucideVersion}).`);
