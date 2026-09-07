/**
 * Les routes du portail.
 *
 * Trois écrans : la page d'accueil composée par la collectivité, la
 * présentation d'une démarche, et son formulaire. Le découpage en deux pages
 * pour une même démarche est délibéré — l'usager lit ce qu'on va lui demander
 * avant de s'engager dans la saisie, comme sur les portails de service public.
 *
 * Toute autre adresse ramène à l'accueil : un portail public n'a rien à gagner
 * à afficher une page « introuvable » à quelqu'un qui a suivi un lien périmé.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DemarchePage } from "@/features/demarche/DemarchePage.tsx";
import { FormulairePage } from "@/features/demarche/FormulairePage.tsx";
import { PortalPage } from "@/features/portal/PortalPage.tsx";
import { LanguageLayout } from "@/i18n/LanguageLayout.tsx";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Les trois écrans, deux fois : sans préfixe (le français, langue
            pivot — toutes les adresses déjà partagées continuent de marcher) et
            sous un préfixe de langue. ⚠️ `:lang` est un joker d'UN segment :
            `/demarches/{id}` en a deux et ne peut pas le confondre, et
            `LanguageLayout` écarte de toute façon ce que la collectivité n'a pas
            activé. */}
        <Route element={<LanguageLayout />}>
          <Route path="/" element={<PortalPage />} />
          <Route path="/demarches/:demarcheId" element={<DemarchePage />} />
          <Route path="/demarches/:demarcheId/formulaire" element={<FormulairePage />} />
        </Route>
        <Route path=":lang" element={<LanguageLayout />}>
          <Route index element={<PortalPage />} />
          <Route path="demarches/:demarcheId" element={<DemarchePage />} />
          <Route path="demarches/:demarcheId/formulaire" element={<FormulairePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
