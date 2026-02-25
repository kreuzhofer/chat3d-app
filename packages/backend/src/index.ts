import { config } from "./config.js";
import { createApp } from "./app.js";
import { createLogger } from "./utils/logger.js";

const logger = createLogger("backend");

const app = createApp();

app.listen(config.port, () => {
  logger.info("listening on %d", config.port);
});
