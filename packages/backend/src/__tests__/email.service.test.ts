import { describe, expect, it, vi } from "vitest";
import { EmailService } from "../services/email.service.js";

describe("email service", () => {
  it("captures outbound email in memory mode", async () => {
    const service = new EmailService({
      mode: "memory",
      retryCount: 0,
      retryDelayMs: 0,
    });

    await service.sendTransactionalEmail({
      to: "memory@example.test",
      subject: "memory",
      text: "hello",
    });

    expect(service.getSentEmailsForTest()).toEqual([
      {
        to: "memory@example.test",
        subject: "memory",
        text: "hello",
      },
    ]);
  });

  it("retries smtp delivery and succeeds on later attempt", async () => {
    const sendMail = vi
      .fn()
      .mockRejectedValueOnce(new Error("temporary smtp failure"))
      .mockResolvedValueOnce({ messageId: "ok" });

    const service = new EmailService({
      mode: "smtp",
      retryCount: 2,
      retryDelayMs: 0,
      smtp: {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        from: "no-reply@example.test",
        connectionTimeoutMs: 1000,
        socketTimeoutMs: 1000,
      },
      transporter: {
        sendMail,
      },
    });

    await service.sendTransactionalEmail({
      to: "smtp@example.test",
      subject: "smtp",
      text: "hello",
    });

    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting smtp retry budget", async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error("smtp down"));

    const service = new EmailService({
      mode: "smtp",
      retryCount: 1,
      retryDelayMs: 0,
      smtp: {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        from: "no-reply@example.test",
        connectionTimeoutMs: 1000,
        socketTimeoutMs: 1000,
      },
      transporter: {
        sendMail,
      },
    });

    await expect(
      service.sendTransactionalEmail({
        to: "smtp@example.test",
        subject: "smtp",
        text: "hello",
      }),
    ).rejects.toThrow("Failed to send email after 2 attempts");

    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
