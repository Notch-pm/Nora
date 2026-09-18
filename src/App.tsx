/**
 * Les routes du portail.
 *
 * Cinq écrans : la page d'accueil composée par la collectivité, la page d'un
 * organisme, la présentation d'une démarche, son formulaire, et la déclaration
 * d'accessibilité (`/accessibilite`, où mène la mention du pied de page). Le
 * découpage en
 * deux pages pour une même démarche est délibéré — l'usager lit ce qu'on va lui
 * demander avant de s'engager dans la saisie, comme sur les portails de service
 * public.
 *
 * Toute autre adresse ramène à l'accueil : un portail public n'a rien à gagner
 * à afficher une page « introuvable » à quelqu'un qui a suivi un lien périmé.
 *
 * ── Deux préfixes, et une seule règle pour les lire ──────────────────────────
 * Une adresse peut porter une langue (`/en`) et un organisme
 * (`/mairie-de-cahors`), dans cet ordre, avant le chemin de l'écran.
 *
 * ⚠️ AUCUNE TABLE DE ROUTES NE PEUT LES DISTINGUER : `/en` et
 * `/mairie-de-cahors` ont exactement la même forme pour react-router — un
 * segment libre. C'est `splitScopedPath` qui tranche, sur la seule forme du
 * segment (deux ou trois lettres = une langue), et c'est la MÊME fonction qui
 * sert aux liens et à la mesure d'audience. Les routes ci-dessous ne décident
 * donc que d'une chose : combien de segments précèdent l'écran.
 */
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AccessibilitePage } from "@/features/accessibilite/AccessibilitePage.tsx";
import { DemarchePage } from "@/features/demarche/DemarchePage.tsx";
import { FormulairePage } from "@/features/demarche/FormulairePage.tsx";
import { OrganismePage } from "@/features/organisme/OrganismePage.tsx";
import { PortalPage } from "@/features/portal/PortalPage.tsx";
import { LanguageLayout } from "@/i18n/LanguageLayout.tsx";
import { splitScopedPath } from "@/i18n/localizedPath.ts";

/**
 * L'accueil de la collectivité, ou la page d'un organisme — selon ce que le
 * premier segment de l'adresse est vraiment.
 *
 * Ce qui reste du chemin après la langue et l'organisme doit être vide : une
 * adresse comme `/mairie-de-cahors/n-importe-quoi` a bien la forme d'un
 * organisme suivi de quelque chose, mais ce quelque chose n'est aucun écran du
 * portail. Retour à l'accueil, comme pour toute adresse inconnue.
 */
function ScopedHome() {
  const { organisme, path } = splitScopedPath(useLocation().pathname);
  if (path !== "/") return <Navigate to="/" replace />;
  return organisme === null ? <PortalPage /> : <OrganismePage />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ⚠️ Une seule mise en page pour toutes les formes d'adresse :
            `LanguageLayout` lit la langue dans le chemin lui-même, pas dans un
            paramètre de route. Il n'a donc pas besoin d'une branche par forme —
            et c'est ce qui permet aux six adresses ci-dessous de cohabiter. */}
        <Route element={<LanguageLayout />}>
          <Route path="/" element={<PortalPage />} />
          <Route path="/demarches/:demarcheId" element={<DemarchePage />} />
          <Route path="/demarches/:demarcheId/formulaire" element={<FormulairePage />} />
          {/* ⚠️ `accessibilite` est un segment STATIQUE, comme `demarches` : il
              passe avant les jokers ci-dessous, et `ROUTE_SEGMENTS` l'exclut
              des slugs d'organisme. Sous une langue (`/en/accessibilite`) ou,
              par un lien périmé, sous un organisme — la page ramène alors à
              l'adresse de la collectivité. */}
          <Route path="/accessibilite" element={<AccessibilitePage />} />
          <Route path=":scopeA/accessibilite" element={<AccessibilitePage />} />
          <Route path=":scopeA/:scopeB/accessibilite" element={<AccessibilitePage />} />

          {/* Un segment libre, ou deux : une langue, un organisme, ou les deux.
              ⚠️ `demarches` étant un segment STATIQUE, react-router le classe
              avant ces jokers : `/demarches/{id}` ne peut pas être lu comme
              « organisme + quelque chose ». */}
          <Route path=":scopeA" element={<ScopedHome />} />
          <Route path=":scopeA/:scopeB" element={<ScopedHome />} />

          <Route path=":scopeA/demarches/:demarcheId" element={<DemarchePage />} />
          <Route
            path=":scopeA/demarches/:demarcheId/formulaire"
            element={<FormulairePage />}
          />
          <Route path=":scopeA/:scopeB/demarches/:demarcheId" element={<DemarchePage />} />
          <Route
            path=":scopeA/:scopeB/demarches/:demarcheId/formulaire"
            element={<FormulairePage />}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
