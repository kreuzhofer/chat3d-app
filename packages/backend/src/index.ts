import { config } from "./config.js";
import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";
import { prisma } from "./db/prisma.js";
import { resumeStalePipelines } from "./services/query.service.js";
import { initializeI18n } from "./i18n/config.js";
import { emailService } from "./services/email.service.js";
import { initializeEmailTemplates } from "./services/email-template.service.js";
import { startJobQueue, stopJobQueue } from "./services/job-queue.service.js";
import { recoverStuckExperiments } from "./services/experiment-execution.service.js";
const logger = createLogger("backend");

await initializeI18n();
initializeEmailTemplates();
logger.info("i18n and email templates initialized");

const emailStatus = await emailService.verifyConnection();
if (!emailStatus.configured) {
  logger.warn({ email: emailStatus }, "email is not configured — email features will fail");
} else if (emailStatus.smtpOk === false) {
  logger.warn({ email: emailStatus }, "email SMTP authentication failed");
} else {
  logger.info({ email: emailStatus }, "email is configured and ready");
}

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info("listening on %d", config.port);

  // Resume pipelines that were interrupted by the last shutdown
  void resumeStalePipelines().catch((err) => {
    logger.error({ err }, "failed to resume stale pipelines on startup");
  });

  // Recover experiments stuck in "running" after restart
  void recoverStuckExperiments().catch((err) => {
    logger.error({ err }, "failed to recover stuck experiments on startup");
  });

  // Start persistent job queue for knowledge pipeline
  void startJobQueue().catch((err) => {
    logger.error({ err }, "failed to start job queue");
  });
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void stopJobQueue()
      .catch((err) => logger.error({ err }, "job queue stop error"))
      .then(() => prisma.$disconnect())
      .then(() => {
        logger.info("prisma disconnected");
        process.exit(0);
      })
      .catch((err) => {
        logger.error({ err }, "prisma disconnect error");
        process.exit(1);
      });
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — shutting down");
  shutdown("uncaughtException");
});
