import pino from "pino";
import { config } from "../config.js";

const transport =
  config.logging.format === "pretty"
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      })
    : undefined;

const rootLogger = pino(
  {
    level: config.logging.level,
    base: { service: "backend" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

export function createLogger(module: string): pino.Logger {
  return rootLogger.child({ module });
}

export { rootLogger as logger };
