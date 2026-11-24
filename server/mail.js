// Outgoing email, one place for the whole server and its scripts.
// Resend when RESEND_API_KEY is set, otherwise any SMTP server (SMTP_URL), otherwise none: in development the
// sign-in link is then printed in the server log instead (see server/auth.js).
// Keys live in .env only, never in code: .env is gitignored.
import 'dotenv/config';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';

// Resend's shared test sender only delivers to the email address of the Resend account itself. To email anyone
// else, verify your own domain in Resend and set MAIL_FROM to an address on it, e.g. "Buildit <signin@your-domain>".
export const TEST_SENDER = 'onboarding@resend.dev';
const FROM = process.env.MAIL_FROM || `Buildit <${TEST_SENDER}>`;

let send = null;
export let mailVia = 'none';
if (process.env.RESEND_API_KEY) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  mailVia = 'resend';
  send = async msg => {
    // the Resend client does not throw: it answers { data, error }
    const { data, error } = await resend.emails.send({ from: FROM, ...msg });
    if (error) throw new Error(`Resend: ${error.message || error.name}`);
    return data?.id;
  };
} else if (process.env.SMTP_URL) {
  const smtp = nodemailer.createTransport(process.env.SMTP_URL);
  mailVia = 'smtp';
  send = async msg => (await smtp.sendMail({ from: FROM, ...msg })).messageId;
}

export const mailReady = !!send;

/** Sends one email ({ to, subject, text, html }). Returns the provider's message id; throws when it was not sent. */
export async function sendMail(msg) {
  if (!send) throw new Error('No email service: set RESEND_API_KEY (or SMTP_URL) in .env.');
  return send(msg);
}
