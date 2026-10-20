/**
 * Les courriels du compte citoyen — LOGIQUE PURE, testée. Ils partent du
 * serveur d'envoi de la COLLECTIVITÉ (`smtpConfig.ts`), à ses couleurs et
 * sous son nom : l'usager s'inscrit sur le portail de sa ville, pas chez
 * l'éditeur.
 *
 * Quatre messages, sobres :
 *   · confirmation de l'adresse (lien valable une heure, limite de GoTrue) ;
 *   · « vous avez déjà un compte » — envoyé À LA PLACE de la confirmation
 *     quand l'adresse est déjà inscrite : l'écran dit la même chose dans les
 *     deux cas, et seul le titulaire de l'adresse apprend qu'elle existe ;
 *   · réinitialisation du mot de passe ;
 *   · avis de changement de mot de passe (ou d'activation / retrait de la
 *     double authentification) — le titulaire doit savoir si ce n'était pas lui.
 *
 * Le jeton d'un lien voyage dans le FRAGMENT (`#jeton=`) : un fragment ne part
 * jamais au serveur, ni dans les journaux du Worker, ni dans un `Referer`.
 */

export interface AccountMessage {
  subject: string;
  text: string;
  html: string;
}

export interface MessageContext {
  /** Nom de la collectivité — la signature et la marque du message. */
  tenantName: string;
  /** Racine du portail de la collectivité, `https://…` sans barre finale. */
  portalUrl: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Corps commun : paragraphes, un bouton facultatif, la signature. */
function compose(
  ctx: MessageContext,
  subject: string,
  paragraphs: string[],
  action: { label: string; url: string } | null,
  after: string[] = [],
): AccountMessage {
  const signature = ["Cordialement,", ctx.tenantName];
  const footer = "Message automatique, merci de ne pas y répondre.";
  const text = [
    "Bonjour,",
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(action ? [`${action.label} : ${action.url}`, ""] : []),
    ...after.flatMap((p) => [p, ""]),
    ...signature,
    "",
    footer,
  ].join("\n");
  const p = (t: string) => `<p style="margin:0 0 16px">${escapeHtml(t)}</p>`;
  const html = [
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`,
    `<body style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border-radius:8px">`,
    `<p style="margin:0 0 24px;font-weight:bold;font-size:18px">${escapeHtml(ctx.tenantName)}</p>`,
    p("Bonjour,"),
    ...paragraphs.map(p),
    action
      ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold">${escapeHtml(action.label)}</a></p>` +
        `<p style="margin:0 0 16px;font-size:13px;color:#555555">Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>${escapeHtml(action.url)}</p>`
      : "",
    ...after.map(p),
    p("Cordialement,"),
    `<p style="margin:0 0 24px">${escapeHtml(ctx.tenantName)}</p>`,
    `<p style="margin:0;font-size:12px;color:#777777">${escapeHtml(footer)}</p>`,
    `</div></body></html>`,
  ].join("");
  return { subject, text, html };
}

export function confirmationMessage(ctx: MessageContext, token: string): AccountMessage {
  return compose(
    ctx,
    "Confirmez votre adresse de courriel",
    [
      `Vous venez de créer votre compte sur le portail des démarches en ligne de ${ctx.tenantName}.`,
      "Pour l'activer, confirmez votre adresse de courriel. Le lien est valable une heure.",
    ],
    { label: "Confirmer mon adresse", url: `${ctx.portalUrl}/compte/confirmer#jeton=${encodeURIComponent(token)}` },
    ["Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message : aucun compte ne sera activé."],
  );
}

export function alreadyRegisteredMessage(ctx: MessageContext): AccountMessage {
  return compose(
    ctx,
    "Vous avez déjà un compte",
    [
      `Une inscription au portail des démarches en ligne de ${ctx.tenantName} vient d'être demandée avec votre adresse de courriel, qui a déjà un compte.`,
      "Vous pouvez vous connecter avec votre mot de passe habituel, ou le réinitialiser si vous l'avez oublié.",
    ],
    { label: "Me connecter", url: `${ctx.portalUrl}/compte/connexion` },
    ["Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre compte n'a pas changé."],
  );
}

export function recoveryMessage(ctx: MessageContext, token: string): AccountMessage {
  return compose(
    ctx,
    "Réinitialisez votre mot de passe",
    [
      `Une réinitialisation du mot de passe de votre compte sur le portail de ${ctx.tenantName} a été demandée.`,
      "Le lien ci-dessous est valable une heure et ne sert qu'une fois.",
    ],
    { label: "Choisir un nouveau mot de passe", url: `${ctx.portalUrl}/compte/mot-de-passe#jeton=${encodeURIComponent(token)}` },
    ["Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé."],
  );
}

export type SecurityChange = "password" | "totp_enabled" | "totp_disabled";

const CHANGE_TEXT: Record<SecurityChange, { subject: string; what: string }> = {
  password: { subject: "Votre mot de passe a été modifié", what: "Le mot de passe de votre compte a été modifié." },
  totp_enabled: {
    subject: "Double authentification activée",
    what: "La double authentification a été activée sur votre compte.",
  },
  totp_disabled: {
    subject: "Double authentification désactivée",
    what: "La double authentification a été désactivée sur votre compte.",
  },
};

export function securityNoticeMessage(ctx: MessageContext, change: SecurityChange): AccountMessage {
  const { subject, what } = CHANGE_TEXT[change];
  return compose(
    ctx,
    subject,
    [`${what} (portail des démarches en ligne de ${ctx.tenantName}).`],
    null,
    [
      `Si vous n'êtes pas à l'origine de ce changement, réinitialisez votre mot de passe sans attendre depuis ${ctx.portalUrl}/compte/mot-de-passe-oublie, puis prévenez ${ctx.tenantName}.`,
    ],
  );
}
