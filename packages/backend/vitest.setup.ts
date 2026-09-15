// Force the email service into in-memory mode before ANY service module
// loads. Docker-compose passes EMAIL_TRANSPORT=smtp to the backend container
// so the running dev/prod backend uses real SMTP — but integration tests
// triggering registration/invitation/password-reset flows would then issue
// real SMTP sends.
//
// `src/config.ts` reads `process.env.EMAIL_TRANSPORT` at module-load time
// into `config.email.transport`, and `db/prisma.ts` transitively imports
// config.ts. Top-level `import` statements are hoisted in ESM, so any
// `import` here would load config.ts BEFORE a statement-level env mutation
// could take effect. Dynamic imports keep load order deterministic: env
// first, then everything else.
// The suite's own database (issue #90): resolved through one guard from the
// environment as the caller left it, then written into DB_NAME before
// `db/prisma.ts` (via config.ts) reads it at module load. A run can no
// longer reach the app's database by omission; `npm test` creates and
// migrates this one first (scripts/ensure-test-db.ts).
const { resolveTestDatabaseName } = await import("./src/utils/test-database.js");
process.env.DB_NAME = resolveTestDatabaseName(process.env);
process.env.EMAIL_TRANSPORT = "memory";

// Same reasoning for the query pipeline: docker-compose passes
// QUERY_LLM_MODE=live and QUERY_RENDER_MODE=live to the backend container,
// which would have integration tests make real LLM + render calls.
// Override here so config.ts captures the test-appropriate "mock" mode.
process.env.QUERY_LLM_MODE = "mock";
process.env.QUERY_RENDER_MODE = "mock";

const { beforeAll } = await import("vitest");
const { initializeI18n } = await import("./src/i18n/config.js");
const { prisma } = await import("./src/db/prisma.js");
const { initializeEmailTemplates } = await import("./src/services/email-template.service.js");

await initializeI18n();
initializeEmailTemplates();

// The DB's app_settings carry production defaults (`waitlistEnabled=false`,
// `emailConfirmationEnabled=true`). Integration tests that exercise the
// happy-path register/login flow assume both are off; flip them here so
// every test file starts from a consistent baseline. Tests that exercise
// the waitlist or email-confirmation flows opt back in via their own
// beforeAll. fileParallelism is disabled in vitest.config so per-file
// flag flipping is safe.
// Upsert, not update: the suite's own database (issue #90) starts empty —
// the app seeds this singleton at boot, the tests do not boot the app.
beforeAll(async () => {
  await prisma.appSettings.upsert({
    where: { id: true },
    create: { id: true, waitlistEnabled: false, emailConfirmationEnabled: false },
    update: { waitlistEnabled: false, emailConfirmationEnabled: false, updatedAt: new Date() },
  });
});
