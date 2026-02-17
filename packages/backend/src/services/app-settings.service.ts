import { query } from "../db/connection.js";

interface AppSettingsRow {
  waitlist_enabled: boolean;
}

export async function isWaitlistEnabled(): Promise<boolean> {
  const result = await query<AppSettingsRow>(
    `
    SELECT waitlist_enabled
    FROM app_settings
    WHERE id = TRUE;
    `,
  );

  const row = result.rows[0];
  return row ? row.waitlist_enabled : false;
}
