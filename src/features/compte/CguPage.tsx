/**
 * Les conditions générales d'utilisation du compte — `/compte/cgu`.
 *
 * Le texte est dans `cguContent.ts` (PROJET, à valider par la collectivité).
 * Page de lecture : un `h1`, un `h2` par article.
 */
import { useLanguage, useT } from "@/i18n/LanguageLayout.tsx";
import { AccountFrame, StepTitle, useScreenTitle } from "./AccountFrame.tsx";
import { CGU_VERSION, cguSections } from "./cguContent.ts";
import { H2 } from "./form.tsx";

export function CguPage() {
  return <AccountFrame>{(tenantName) => <CguScreen tenantName={tenantName} />}</AccountFrame>;
}

function CguScreen({ tenantName }: { tenantName: string }) {
  const t = useT();
  const { lang } = useLanguage();
  useScreenTitle(t("compte.cgu.title"));
  return (
    <>
      <StepTitle>{t("compte.cgu.title")}</StepTitle>
      {/* Le texte juridique n'existe qu'en français : la langue de la zone le dit aux lecteurs d'écran. */}
      <div lang={lang === "fr" ? undefined : "fr"} className="mt-6 flex flex-col gap-8">
        {cguSections(tenantName).map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className={H2}>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-[length:var(--pt-body)] text-[color:var(--pt-ink)]">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
        <p className="text-[length:var(--pt-small)] text-[color:var(--pt-muted)]">
          {t("compte.cgu.version", { version: CGU_VERSION })}
        </p>
      </div>
    </>
  );
}
