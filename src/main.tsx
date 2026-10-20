import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/App.tsx";
import { startEarlyFetches } from "@/services/portal/earlyFetch.ts";
import "@/index.css";

// La session et les données de la page d'arrivée partent avec le bootstrap, pas après lui.
startEarlyFetches(window.location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
