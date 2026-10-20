import { useLocation } from "react-router-dom";

/** Affiche l'adresse courante : de quoi vérifier où une navigation a mené. */
export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
}
