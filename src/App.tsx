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

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PortalPage />} />
        <Route path="/demarches/:demarcheId" element={<DemarchePage />} />
        <Route path="/demarches/:demarcheId/formulaire" element={<FormulairePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
