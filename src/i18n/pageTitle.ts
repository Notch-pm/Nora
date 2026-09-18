/**
 * Le titre de chaque écran, composé et traduit (RGAA 8.6).
 *
 * `document.title` valait « Démarches en ligne » sur les trois écrans, et
 * restait en français sur une page servie en anglais : un titre d'onglet qui
 * ne dit ni la page ni la langue, alors que c'est souvent la première chose
 * qu'un lecteur d'écran annonce à l'arrivée sur une page.
 *
 * Fonctions PURES, testées sans DOM : c'est `useDocumentTitle` (à côté) qui
 * pose le résultat sur `document.title`, ici on ne fait que le composer.
 */
import { t, tn } from "./t.ts";

const SEPARATOR = " — ";

/** L'accueil composé : le nom de la collectivité, puis le site. */
export function homeTitle(lang: string, tenantName: string): string {
  return tenantName + SEPARATOR + t(lang, "page.title");
}

/**
 * La page d'un organisme : son nom, puis celui de la collectivité qui le
 * porte. Pas de `lang` : ces deux noms arrivent déjà dans la langue servie,
 * rien ici n'est à traduire.
 */
export function organismeTitle(organismeName: string, tenantName: string): string {
  return organismeName + SEPARATOR + tenantName;
}

/** La présentation d'une démarche : son nom, puis la collectivité. */
export function demarcheTitle(demarcheName: string, tenantName: string): string {
  return demarcheName + SEPARATOR + tenantName;
}

/**
 * Le formulaire d'une démarche. `errorCount` préfixe le titre du nombre
 * d'erreurs après un envoi refusé (résumé affiché) : « 5 erreurs — Formulaire
 * : … ». Une bonne pratique pour les lecteurs d'écran, qui annoncent le titre
 * de l'onglet en arrivant sur le résumé qui vient de s'afficher.
 */
export function formulaireTitle(
  lang: string,
  demarcheName: string,
  tenantName: string,
  errorCount = 0,
): string {
  const base = t(lang, "page.formTitle", { name: demarcheName }) + SEPARATOR + tenantName;
  return errorCount > 0 ? tn(lang, "page.errorsPrefix", errorCount) + SEPARATOR + base : base;
}

/** L'accusé de dépôt : l'intitulé de l'écran, puis la collectivité. */
export function receiptTitle(lang: string, created: boolean, tenantName: string): string {
  return t(lang, created ? "receipt.title" : "receipt.titleAgain") + SEPARATOR + tenantName;
}

/** La déclaration d'accessibilité : son intitulé, puis la collectivité. */
export function accessibiliteTitle(lang: string, tenantName: string): string {
  return t(lang, "accessibilite.title") + SEPARATOR + tenantName;
}

/** Un écran d'erreur : son message, puis le nom générique du site. */
export function errorPageTitle(lang: string, errorTitle: string): string {
  return errorTitle + SEPARATOR + t(lang, "page.title");
}
