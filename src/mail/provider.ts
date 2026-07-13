import type { Env } from "../env";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface MailProvider {
  send(msg: MailMessage): Promise<void>;
}

export function resendProvider(apiKey: string, from: string): MailProvider {
  return {
    async send(msg) {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html }),
      });
      if (!resp.ok) {
        throw new Error(`resend responded ${resp.status}: ${await resp.text()}`);
      }
    },
  };
}

export function consoleProvider(): MailProvider {
  return {
    async send(msg) {
      console.log(`[mail:console] to=${msg.to} subject=${msg.subject}\n${msg.html}`);
    },
  };
}

export function getMailProvider(env: Env): MailProvider {
  if (env.RESEND_API_KEY) return resendProvider(env.RESEND_API_KEY, env.MAIL_FROM);
  return consoleProvider();
}
