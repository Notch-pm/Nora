/**
 * La « boîte aux lettres » des tests : le transport SMTP réel (`npm:nodemailer`,
 * illisible hors Deno) est remplacé par ceci, qui garde chaque courriel que
 * portal-api aurait envoyé depuis le serveur d'envoi de la collectivité.
 */
export interface SentMail {
  to: string;
  subject: string;
  text: string;
  /** Hôte SMTP de la collectivité qui a envoyé — pour vérifier QUI écrit. */
  smtpHost: string;
}

// Sur globalThis : `vi.resetModules()` recharge ce module, la boîte doit rester la même.
const holder = globalThis as { __noraMailbox?: SentMail[] };
export const mailbox: SentMail[] = (holder.__noraMailbox ??= []);

export function clearMailbox(): void {
  mailbox.length = 0;
}

/** Le jeton du dernier lien (`#jeton=…`) reçu par une adresse. */
export function lastLinkToken(to: string): string | null {
  for (let i = mailbox.length - 1; i >= 0; i--) {
    if (mailbox[i].to !== to) continue;
    const m = mailbox[i].text.match(/#jeton=([^\s]+)/);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}
