/**
 * Un QR code en SVG inline, sans dépendance de rendu : `qrcode-generator` ne
 * calcule que la matrice de modules, c'est ce fichier qui la dessine (pas de
 * chaîne HTML injectée, donc pas de `dangerouslySetInnerHTML`).
 *
 * Image porteuse d'information : `role="img"` et un `aria-label`. L'alternative
 * textuelle COMPLÈTE (le secret, saisissable à la main) est affichée à côté par
 * `TotpSection` — RGAA 1.1 / 1.2.
 *
 * Noir sur blanc avec une marge de quatre modules : c'est ce que les lecteurs
 * de QR code exigent, quelle que soit la charte de la collectivité.
 */
import qrcode from "qrcode-generator";

const QUIET_ZONE = 4;

/** La matrice de modules (vrai = sombre) d'un texte. Pur. */
export function qrModules(value: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** Le tracé SVG : un segment par suite de modules sombres d'une ligne. */
export function qrPath(modules: boolean[][]): string {
  const segments: string[] = [];
  modules.forEach((line, y) => {
    let x = 0;
    while (x < line.length) {
      if (!line[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < line.length && line[x]) x++;
      segments.push(`M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`);
    }
  });
  return segments.join("");
}

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const modules = qrModules(value);
  const side = modules.length + QUIET_ZONE * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      className={"bg-white text-black " + (className ?? "")}
    >
      <path d={qrPath(modules)} fill="currentColor" />
    </svg>
  );
}
