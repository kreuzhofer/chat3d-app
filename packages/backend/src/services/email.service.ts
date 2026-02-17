export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

class EmailService {
  private sentEmails: EmailMessage[] = [];

  async sendTransactionalEmail(message: EmailMessage): Promise<void> {
    this.sentEmails.push(message);
    console.log(`[email] to=${message.to} subject=${message.subject}`);
  }

  getSentEmailsForTest(): EmailMessage[] {
    return [...this.sentEmails];
  }

  clearSentEmailsForTest(): void {
    this.sentEmails = [];
  }
}

export const emailService = new EmailService();
