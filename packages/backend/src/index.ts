import { config } from "./config.js";
import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";
import { seedLlmModels } from "./services/llm-model-seeder.service.js";

const logger = createLogger("backend");

const app = createApp();

app.listen(config.port, () => {
  logger.info("listening on %d", config.port);

  // Seed LLM model config on startup (idempotent — skips if already seeded)
  seedLlmModels().catch((error) => {
    logger.error({ err: error }, "failed to seed LLM models on startup");
  });
});
