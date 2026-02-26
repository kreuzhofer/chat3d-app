import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const LOG_FORMAT = process.env.LOG_FORMAT ?? "json";

const transport =
  LOG_FORMAT === "pretty"
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
    level: LOG_LEVEL,
    base: { service: "stl-rendering-service" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport,
);

export function createLogger(module: string): pino.Logger {
  return rootLogger.child({ module });
}

export { rootLogger as logger };
