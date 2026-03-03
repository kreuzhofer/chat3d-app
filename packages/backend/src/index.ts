import { config } from "./config.js";
import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";
import { prisma } from "./db/prisma.js";
import { resumeStalePipelines } from "./services/query.service.js";
import { initializeI18n } from "./i18n/config.js";
const logger = createLogger("backend");

await initializeI18n();
logger.info("i18n initialized");

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info("listening on %d", config.port);

  // Resume pipelines that were interrupted by the last shutdown
  void resumeStalePipelines().catch((err) => {
    logger.error({ err }, "failed to resume stale pipelines on startup");
  });
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    prisma.$disconnect().then(() => {
      logger.info("prisma disconnected");
      process.exit(0);
    }).catch((err) => {
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
