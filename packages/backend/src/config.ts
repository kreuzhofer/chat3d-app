import dotenv from "dotenv";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

function readEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readNumber(name: string, fallback: string): number {
  const raw = readEnv(name, fallback);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be numeric`);
  }
  return parsed;
}

function readCsv(name: string, fallback: string): string[] {
  const raw = readEnv(name, fallback);
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}

function readEmailTransport(): "memory" | "smtp" {
  const explicit = process.env.EMAIL_TRANSPORT;
  if (explicit) {
    if (explicit === "memory" || explicit === "smtp") {
      return explicit;
    }
    throw new Error("EMAIL_TRANSPORT must be either 'memory' or 'smtp'");
  }

  if (process.env.NODE_ENV === "test") {
    return "memory";
  }

  return process.env.SMTP_HOST ? "smtp" : "memory";
}

function readEventBusMode(): "local" | "redis" {
  const explicit = process.env.EVENT_BUS_MODE;
  if (explicit) {
    if (explicit === "local" || explicit === "redis") {
      return explicit;
    }
    throw new Error("EVENT_BUS_MODE must be either 'local' or 'redis'");
  }

  if (process.env.NODE_ENV === "test") {
    return "local";
  }

  return "redis";
}

function readQueryProviderEnv(name: string, fallback: string): "mock" | "openai" | "anthropic" | "xai" | "ollama" {
  const value = readEnv(name, fallback);
  if (value === "mock" || value === "openai" || value === "anthropic" || value === "xai" || value === "ollama") {
    return value;
  }
  throw new Error(`${name} must be one of: mock, openai, anthropic, xai, ollama`);
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: readNumber("PORT", "3001"),
  db: {
    host: readEnv("DB_HOST", "localhost"),
    port: readNumber("DB_PORT", "5432"),
    user: readEnv("DB_USER", "chat3d"),
    password: readEnv("DB_PASSWORD", "chat3d_dev"),
    database: readEnv("DB_NAME", "chat3d"),
    ssl: process.env.DB_SSL === "true",
  },
  redis: {
    host: readEnv("REDIS_HOST", "localhost"),
    port: readNumber("REDIS_PORT", "6379"),
  },
  eventBus: {
    mode: readEventBusMode(),
    channel: readEnv("REDIS_EVENT_CHANNEL", "chat3d.notifications"),
  },
  security: {
    corsAllowedOrigins: readCsv("CORS_ALLOWED_ORIGINS", "http://localhost,http://localhost:80,http://localhost:5173"),
    rateLimitWindowMs: readNumber("RATE_LIMIT_WINDOW_MS", "60000"),
    rateLimitGeneralMax: readNumber("RATE_LIMIT_GENERAL_MAX", "500"),
    rateLimitReactivateMax: readNumber("RATE_LIMIT_REACTIVATE_MAX", "5"),
    rateLimitLoginMax: readNumber("RATE_LIMIT_LOGIN_MAX", "50"),
    rateLimitQueryMax: readNumber("RATE_LIMIT_QUERY_MAX", "50"),
  },
  storage: {
    rootDir: readEnv("STORAGE_ROOT_DIR", process.env.NODE_ENV === "test" ? ".chat3d-storage" : "/data/storage"),
  },
  app: {
    baseUrl: readEnv("APP_BASE_URL", "http://localhost"),
  },
  auth: {
    jwtSecret: readEnv("JWT_SECRET", "change-this"),
    seedAdminEmail: readEnv("SEED_ADMIN_EMAIL", "admin@chat3d.local"),
    seedAdminPassword: readEnv("SEED_ADMIN_PASSWORD", "change-admin-password"),
    seedAdminDisplayName: process.env.SEED_ADMIN_DISPLAY_NAME ?? "Initial Admin",
  },
  waitlist: {
    confirmationTokenTtlHours: readNumber("WAITLIST_CONFIRMATION_TOKEN_TTL_HOURS", "24"),
    registrationTokenTtlHours: readNumber("WAITLIST_REGISTRATION_TOKEN_TTL_HOURS", "168"),
  },
  invitations: {
    registrationTokenTtlHours: readNumber("INVITATION_REGISTRATION_TOKEN_TTL_HOURS", "168"),
  },
  query: {
    build123dUrl: readEnv("BUILD123D_URL", "http://localhost:30222"),
    renderMode: readEnv("QUERY_RENDER_MODE", process.env.NODE_ENV === "test" ? "mock" : "live"),
    llmMode: readEnv("QUERY_LLM_MODE", process.env.NODE_ENV === "test" ? "mock" : "live"),
    conversationProvider: readQueryProviderEnv(
      "QUERY_CONVERSATION_PROVIDER",
      process.env.NODE_ENV === "test" ? "mock" : "openai",
    ),
    codegenProvider: readQueryProviderEnv(
      "QUERY_CODEGEN_PROVIDER",
      process.env.NODE_ENV === "test" ? "mock" : "openai",
    ),
    conversationModelName: readEnv("QUERY_CONVERSATION_MODEL", "gpt-4o-mini"),
    codegenModelName: readEnv("QUERY_CODEGEN_MODEL", "gpt-4o-mini"),
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    xaiApiKey: process.env.XAI_API_KEY ?? "",
    ollamaBaseUrl: readEnv("OLLAMA_BASE_URL", "http://host.docker.internal:11434"),
    ollamaToken: process.env.OLLAMA_TOKEN ?? "",
  },
  email: {
    transport: readEmailTransport(),
    smtpHost: readOptionalEnv("SMTP_HOST"),
    smtpPort: readNumber("SMTP_PORT", "587"),
    smtpSecure: process.env.SMTP_SECURE === "true",
    smtpUser: readOptionalEnv("SMTP_USER"),
    smtpPass: readOptionalEnv("SMTP_PASS"),
    from: readEnv("MAIL_FROM", "no-reply@example.com"),
    retryCount: readNumber("EMAIL_RETRY_COUNT", "2"),
    retryDelayMs: readNumber("EMAIL_RETRY_DELAY_MS", "250"),
    connectionTimeoutMs: readNumber("EMAIL_CONNECTION_TIMEOUT_MS", "10000"),
    socketTimeoutMs: readNumber("EMAIL_SOCKET_TIMEOUT_MS", "20000"),
  },
};
