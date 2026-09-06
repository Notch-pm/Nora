/**
 * L'en-tête du portail : la pastille (ou le logo) de la collectivité, son nom,
 * et une navigation encore décorative.
 *
 * Partagé par la page d'accueil composée et par les pages d'une démarche : un
 * usager qui commence une démarche ne doit pas avoir l'impression de quitter le
 * site de sa collectivité. C'est la seule raison pour laquelle ce composant
 * vit dans son propre fichier plutôt que dans la composition.
 *
 * La nav et « Mon compte » restent décoratifs tant qu'aucune de ces pages
 * n'existe — mieux vaut du gris inerte qu'un lien mort.
 */
export function PageHeader({ tenantName, logoUrl }: { tenantName: string; logoUrl: string | null }) {
  return (
    <header className="border-b border-slate-200">
      <div className="mx-auto flex max-w-5xl items-center gap-3.5 px-6 py-4">
        {/* Le logo de la collectivité quand elle en a un ; sinon une pastille à
            sa couleur — la page reste reconnaissable sans image. */}
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-7 w-auto max-w-[160px] shrink-0 object-contain" />
        ) : (
          <div
            className="h-[26px] w-[26px] shrink-0 rounded-md bg-[color:var(--brand-primary)]"
            aria-hidden="true"
          />
        )}
        <span className="text-sm font-extrabold tracking-tight text-slate-900">{tenantName}</span>
        <div className="flex-1" />
        {/* Décoratif : ces pages n'existent pas encore, ce ne sont pas des liens. */}
        <div className="hidden items-center gap-4 sm:flex" aria-hidden="true">
          <span className="text-sm text-slate-500">Démarches</span>
          <span className="text-sm text-slate-500">Contact</span>
        </div>
        <span className="rounded-full border border-[color:var(--brand-primary)] px-3 py-1.5 text-sm font-semibold text-[color:var(--brand-primary)]">
          Mon compte
        </span>
      </div>
    </header>
  );
}
