/**
 * PROJET — à valider par la collectivité et son DPO.
 *
 * Les conditions générales d'utilisation du compte citoyen, version `2026-10`
 * (`CGU_VERSION`, la même que celle que le serveur consigne à l'inscription :
 * en changer le texte sans changer la version, ou l'inverse, fausserait la
 * preuve de ce que l'usager a accepté).
 *
 * Rédigé en français seulement : un texte juridique ne se traduit pas à la
 * légère, et la version de référence est celle que la collectivité aura validée.
 * La page l'affiche avec `lang="fr"`.
 *
 * ⚠️ Chaque phrase doit rester VRAIE du code : durées, données conservées,
 * cookie. Les modifier ici sans modifier le serveur (ou l'inverse) serait une
 * promesse non tenue.
 */
export { CGU_VERSION } from "@fn/_shared/account/accountService.ts";

export interface CguSection {
  heading: string;
  paragraphs: string[];
}

/** Les articles, au nom de la collectivité (`name` : son nom, tel que le Socle le donne). */
export function cguSections(name: string): CguSection[] {
  return [
    {
      heading: "1. Objet",
      paragraphs: [
        `Le compte citoyen est un service proposé par ${name}. Il permet de vous identifier sur le portail des démarches en ligne de la collectivité, pour accéder à votre espace personnel.`,
        "Créer un compte est facultatif : il reste possible de déposer une demande, puis de la suivre, sans compte.",
      ],
    },
    {
      heading: "2. Création et sécurité du compte",
      paragraphs: [
        "Pour créer un compte, vous indiquez une adresse de courriel et vous acceptez les présentes conditions. Un courriel vous est envoyé : le lien qu'il contient, valable une heure, vous permet de confirmer l'adresse et de choisir votre mot de passe. Sans cette confirmation, le compte n'est pas utilisable.",
        "Le mot de passe comporte au moins 12 caractères, dont au moins une lettre, un chiffre et un caractère spécial. Vous pouvez, si vous le souhaitez, activer une double authentification par une application d'authentification : un code à six chiffres vous est alors demandé à chaque connexion.",
        "Vous êtes responsable de la confidentialité de votre mot de passe et de votre appareil. La collectivité ne vous demandera jamais votre mot de passe. En cas de doute, changez-le depuis « Mon compte » ou utilisez « Mot de passe oublié ».",
        "Après plusieurs tentatives de connexion échouées (dix en quinze minutes), la connexion est suspendue pendant quinze minutes. Si vous cochez « Rester connecté », la session dure 30 jours : ne le faites pas sur un ordinateur partagé.",
      ],
    },
    {
      heading: "3. Données conservées",
      paragraphs: [
        "Pour faire fonctionner le compte, les données suivantes sont conservées : votre adresse de courriel ; votre mot de passe, sous forme hachée (il n'est jamais conservé en clair et la collectivité ne peut pas le lire) ; si vous l'activez, le secret de la double authentification, conservé chiffré ; la version des présentes conditions que vous avez acceptée, et la date.",
        "Un journal des connexions est tenu pour la sécurité du service : il comporte la date, l'adresse IP et le type de navigateur utilisés lors des connexions et des opérations sur le compte. Il est conservé un an.",
        "À ce stade, votre nom, votre adresse postale et vos autres données d'identité ne sont pas demandés : ils vous seront demandés plus tard, lorsqu'un service en aura besoin.",
      ],
    },
    {
      heading: "4. Responsable du traitement et vos droits",
      paragraphs: [
        `${name} est responsable du traitement de ces données, qu'elle utilise pour gérer votre compte et en assurer la sécurité. Elles ne sont pas utilisées à des fins commerciales.`,
        "Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation et, selon les cas, d'opposition au traitement de vos données. Pour les exercer, adressez-vous à la collectivité, par les coordonnées publiées sur ce site, ou à son délégué à la protection des données. Si vous estimez, après l'avoir contactée, que vos droits ne sont pas respectés, vous pouvez saisir la Commission nationale de l'informatique et des libertés (CNIL).",
      ],
    },
    {
      heading: "5. Cookie",
      paragraphs: [
        "L'ouverture d'une session dépose sur votre navigateur un cookie de session, strictement nécessaire au fonctionnement du compte : il vous reconnaît d'une page à l'autre et disparaît à la déconnexion ou à l'expiration de la session. Il ne sert ni à la publicité ni au suivi de votre navigation, et ne nécessite donc pas votre consentement.",
      ],
    },
    {
      heading: "6. Évolution des conditions",
      paragraphs: [
        `${name} peut faire évoluer ces conditions. La version applicable est indiquée en bas de cette page ; la version que vous avez acceptée est celle qui est consignée à la création de votre compte.`,
      ],
    },
  ];
}
