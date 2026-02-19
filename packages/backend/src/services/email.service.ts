import nodemailer from "nodemailer";
import { config } from "../config.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

interface SmtpSendInput {
  from: string;
  to: string;
  subject: string;
  text: string;
}

interface SmtpTransportLike {
  sendMail(input: SmtpSendInput): Promise<unknown>;
}

interface EmailServiceOptions {
  mode: "memory" | "smtp";
  retryCount: number;
  retryDelayMs: number;
  smtp?: {
    host?: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
    from: string;
    connectionTimeoutMs: number;
    socketTimeoutMs: number;
  };
  transporter?: SmtpTransportLike;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildRuntimeOptions(): EmailServiceOptions {
  return {
    mode: config.email.transport,
    retryCount: Math.max(0, config.email.retryCount),
    retryDelayMs: Math.max(0, config.email.retryDelayMs),
    smtp: {
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpSecure,
      user: config.email.smtpUser,
      pass: config.email.smtpPass,
      from: config.email.from,
      connectionTimeoutMs: config.email.connectionTimeoutMs,
      socketTimeoutMs: config.email.socketTimeoutMs,
    },
  };
}

export class EmailService {
  private sentEmails: EmailMessage[] = [];
  private smtpTransport: SmtpTransportLike | undefined;

  constructor(private readonly options: EmailServiceOptions = buildRuntimeOptions()) {}

  async sendTransactionalEmail(message: EmailMessage): Promise<void> {
    if (this.options.mode === "memory") {
      this.sentEmails.push(message);
      console.log(`[email] to=${message.to} subject=${message.subject}`);
      return;
    }

    const smtp = this.options.smtp;
    if (!smtp || !smtp.from || !smtp.host) {
      throw new Error("SMTP email transport requires SMTP_HOST and MAIL_FROM");
    }

    const transport = this.getSmtpTransport();
    let attempt = 0;

    while (true) {
      try {
        await transport.sendMail({
          from: smtp.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
        });
        console.log(`[email] to=${message.to} subject=${message.subject} transport=smtp`);
        return;
      } catch (error) {
        if (attempt >= this.options.retryCount) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to send email after ${attempt + 1} attempts: ${reason}`);
        }

        attempt += 1;
        const backoffMs = this.options.retryDelayMs * attempt;
        if (backoffMs > 0) {
          await sleep(backoffMs);
        }
      }
    }
  }

  getSentEmailsForTest(): EmailMessage[] {
    return [...this.sentEmails];
  }

  clearSentEmailsForTest(): void {
    this.sentEmails = [];
  }

  private getSmtpTransport(): SmtpTransportLike {
    if (this.options.transporter) {
      return this.options.transporter;
    }

    if (this.smtpTransport) {
      return this.smtpTransport;
    }

    const smtp = this.options.smtp;
    if (!smtp?.host) {
      throw new Error("SMTP transport is not configured");
    }

    const auth =
      smtp.user && smtp.pass
        ? {
            user: smtp.user,
            pass: smtp.pass,
          }
        : undefined;

    this.smtpTransport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth,
      connectionTimeout: smtp.connectionTimeoutMs,
      greetingTimeout: smtp.connectionTimeoutMs,
      socketTimeout: smtp.socketTimeoutMs,
    }) as unknown as SmtpTransportLike;

    return this.smtpTransport as SmtpTransportLike;
  }
}

export const emailService = new EmailService();
