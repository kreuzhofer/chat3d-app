import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { pool } from "./connection.js";

async function seed() {
  const passwordHash = await bcrypt.hash(config.auth.seedAdminPassword, 12);

  const adminResult = await pool.query<{ id: string }>(
    `
    INSERT INTO users (email, password_hash, display_name, role, status)
    VALUES ($1, $2, $3, 'admin', 'active')
    ON CONFLICT (email)
    DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      display_name = EXCLUDED.display_name,
      role = 'admin',
      status = 'active',
      updated_at = NOW()
    RETURNING id;
    `,
    [config.auth.seedAdminEmail, passwordHash, config.auth.seedAdminDisplayName],
  );

  const adminId = adminResult.rows[0]?.id;
  if (!adminId) {
    throw new Error("Failed to seed admin user");
  }

  await pool.query(
    `
    INSERT INTO app_settings (
      id,
      waitlist_enabled,
      invitations_enabled,
      invitation_waitlist_required,
      invitation_quota_per_user,
      updated_by,
      updated_at
    )
    VALUES (TRUE, FALSE, TRUE, FALSE, 3, $1, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW();
    `,
    [adminId],
  );

  console.log(`[seed] Admin user seeded: ${config.auth.seedAdminEmail}`);
  console.log("[seed] Default app settings seeded");
}

seed()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("[seed] Seed failed", error);
    await pool.end();
    process.exit(1);
  });
