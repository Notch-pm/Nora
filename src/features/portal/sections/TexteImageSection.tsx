/**
 * Texte et image : deux moitiés côte à côte, dans l'ordre choisi par la
 * collectivité — et **empilées** quand l'écran ne les tient plus côte à côte.
 *
 * ⚠️ L'ordre survit à l'empilement. Il est porté par un seul `order-first`,
 * que `flex` applique aussi bien en ligne qu'en colonne : « image d'abord »
 * reste image d'abord sur un téléphone, où « à gauche » ne veut plus rien dire.
 *
 * Sans image — la collectivité n'en a pas mis, ou l'adresse n'était pas une
 * `https` absolue et la frontière l'a écartée — le bloc est un bandeau texte
 * pleine largeur. Pas de cadre vide : un usager n'a pas à voir la place d'une
 * image qui n'existe pas.
 */
import type { TexteImageSection as TexteImageSectionData } from "@fn/_shared/domain/page.ts";

export function TexteImageSection({ section }: { section: TexteImageSectionData }) {
  if (section.imageUrl === null) {
    return (
      <section className="flex flex-col gap-1.5">
        <Texte section={section} />
      </section>
    );
  }
  return (
    <section className="flex flex-col items-center gap-6 sm:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Texte section={section} />
      </div>
      <div
        className={
          "w-full shrink-0 sm:w-[45%] " + (section.layout === "image-first" ? "order-first" : "")
        }
      >
        {/* `alt` vide = image décorative : c'est le comportement HTML attendu,
            et c'est ce que l'éditeur du Socle annonce à l'agent. Y recopier le
            titre ferait lire deux fois la même chose à une synthèse vocale. */}
        <img
          src={section.imageUrl}
          alt={section.alt}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-[var(--pt-radius)] bg-[color:var(--pt-surface)] object-cover"
        />
      </div>
    </section>
  );
}

/** Le titre — s'il y en a un, il est facultatif sur ce bloc — et le paragraphe. */
function Texte({ section }: { section: TexteImageSectionData }) {
  return (
    <>
      {section.title === "" ? null : (
        <h2 className="text-[length:var(--pt-h2)] font-bold text-[color:var(--pt-ink)]">{section.title}</h2>
      )}
      <p className="whitespace-pre-line text-[length:var(--pt-body)] leading-relaxed text-[color:var(--pt-ink)]">
        {section.body}
      </p>
    </>
  );
}
