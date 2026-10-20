/**
 * Envoi SMTP — la seule brique du compte à dépendre du runtime Deno (nodemailer
 * via `npm:`). Ce qui décide (textes, configuration) vit dans les modules purs
 * voisins, testés.
 *
 * La vérification du certificat du relais n'est PAS désactivée : un relais à
 * certificat auto-signé échoue franchement (motif d'Iris).
 */
import nodemailer from "npm:nodemailer@6";
import { senderHeader, type SmtpConfig } from "./smtpConfig.ts";
import type { AccountMessage } from "./messages.ts";

export async function sendAccountMessage(config: SmtpConfig, to: string, message: AccountMessage): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    requireTLS: config.useTls && config.port !== 465,
    auth: config.username ? { user: config.username, pass: config.password ?? "" } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transporter.sendMail({
    from: senderHeader(config),
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
