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
    openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  },
};
