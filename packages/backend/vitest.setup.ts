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
process.env.EMAIL_TRANSPORT = "memory";

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
beforeAll(async () => {
  await prisma.appSettings.update({
    where: { id: true },
    data: {
      waitlistEnabled: false,
      emailConfirmationEnabled: false,
      updatedAt: new Date(),
    },
  });
});
