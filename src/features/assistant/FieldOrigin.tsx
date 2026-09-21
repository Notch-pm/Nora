/**
 * Le badge d'origine d'une valeur, et la note qui l'explique.
 *
 * ⚠️ **C'EST LE CŒUR DE LA PROPOSITION.** Un formulaire prérempli n'est relisable
 * que si la différence entre « ce que vous avez dit » et « ce que j'en ai
 * déduit » est visible. Sans elle, l'usager doit tout relire — ou ne relit rien.
 *
 * ⚠️ **JAMAIS LA COULEUR SEULE** (RGAA 3.1). Le texte du badge porte le sens
 * (« déduit, à confirmer »), la teinte ne fait que le renforcer, et
 * `FormFieldControl` rattache la note au champ par `aria-describedby` — sans
 * quoi l'usager non-voyant entendrait une valeur sans savoir d'où elle vient.
 *
 * ⚠️ **L'ENCRE EST TOUJOURS `--pt-ink`.** Les teintes sont des aplats très
 * clairs de la charte (`--pt-primary-soft` à 8–14 %, `--pt-accent-soft` à
 * 35–50 %), et la charte est réglée par chaque collectivité : une encre dérivée
 * de la couleur de marque tiendrait le contraste chez l'une et le perdrait chez
 * l'autre, sans que personne ne le voie. L'encre de page, elle, est lisible sur
 * un fond clair par construction.
 */
import type { FieldOrigin, FieldOriginRecord } from "@fn/_shared/ai/collection.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";

/** L'état visuel d'un champ : son origine, ou « c'est la question du moment ». */
export type FieldMark = FieldOrigin | "pending";

const BADGE_CLASS =
  "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[length:var(--pt-tiny)] font-bold";

const LABELS: Record<FieldMark, "extracted" | "inferred" | "generated" | "pending"> = {
  extracted: "extracted",
  inferred: "inferred",
  generated: "generated",
  pending: "pending",
};

export function OriginBadge({ mark }: { mark: FieldMark }) {
  const t = useT();
  const label = t(`assistant.origin.${LABELS[mark]}` as const);
  // « Question en cours » est le seul à porter la couleur pleine : c'est un
  // repère d'attention, pas une qualification de valeur.
  const style =
    mark === "pending"
      ? { background: "var(--pt-primary)", color: "var(--pt-on-primary)" }
      : mark === "inferred"
        ? { background: "var(--pt-accent-soft)", color: "var(--pt-ink)" }
        : { background: "var(--pt-primary-soft)", color: "var(--pt-ink)" };
  return (
    <span className={BADGE_CLASS} style={style}>
      {label}
    </span>
  );
}

/**
 * Ce qui se lit sous le champ : la citation pour une valeur reprise, la raison
 * pour une déduction, la mise en garde pour un texte rédigé.
 *
 * Rendu `null` quand il n'y a rien d'utile à dire — un encart vide sous chaque
 * champ ferait du bruit là où l'on demande justement de l'attention.
 */
export function OriginNote({ record }: { record: FieldOriginRecord }) {
  const t = useT();
  if (record.origin === "generated") return <>{t("assistant.origin.generatedNote")}</>;
  if (record.origin === "extracted") {
    return record.source === undefined ? null : <>«&nbsp;{record.source}&nbsp;»</>;
  }
  return record.reason === undefined ? null : <>{record.reason}</>;
}
