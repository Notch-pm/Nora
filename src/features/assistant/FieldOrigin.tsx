/**
 * Le badge d'origine d'une valeur, et la note qui l'explique.
 *
 * ⚠️ **C'EST CE QUI REND LE RÉCAPITULATIF RELISABLE.** Un formulaire prérempli
 * par un modèle ne se relit que si la différence entre « ce que vous avez dit »
 * et « ce que j'en ai déduit » est visible. Sans elle, l'usager doit tout
 * relire — ou ne relit rien, et signe.
 *
 * ⚠️ **JAMAIS LA COULEUR SEULE** (RGAA 3.1). Le texte du badge porte le sens
 * (« à confirmer »), la teinte ne fait que le renforcer.
 *
 * ⚠️ **L'ENCRE EST TOUJOURS `--pt-ink`.** Les teintes sont des aplats très
 * clairs de la charte, et la charte est réglée par chaque collectivité : une
 * encre dérivée de la couleur de marque tiendrait le contraste chez l'une et le
 * perdrait chez l'autre, sans que personne ne le voie. L'encre de page, elle,
 * est lisible sur un fond clair par construction.
 */
import type { FieldOrigin, FieldOriginRecord } from "@fn/_shared/ai/collection.ts";
import { useT } from "@/i18n/LanguageLayout.tsx";

const BADGE_CLASS =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[length:var(--pt-small)] font-bold";

export function OriginBadge({ origin }: { origin: FieldOrigin }) {
  const t = useT();
  const style =
    origin === "inferred"
      ? { background: "var(--pt-accent-soft)", color: "var(--pt-ink)" }
      : { background: "var(--pt-primary-soft)", color: "var(--pt-ink)" };
  return (
    <span className={BADGE_CLASS} style={style}>
      {t(`assistant.origin.${origin}` as const)}
    </span>
  );
}

/**
 * Ce qui se lit sous la valeur : la citation pour une reprise, la raison pour
 * une déduction, la mise en garde pour un texte rédigé.
 *
 * Rendu `null` quand il n'y a rien d'utile à dire — une ligne vide sous chaque
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
