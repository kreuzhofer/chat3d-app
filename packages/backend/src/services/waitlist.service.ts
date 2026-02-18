import type { PoolClient } from "pg";
import { config } from "../config.js";
import { pool, query } from "../db/connection.js";
import { generateOpaqueToken, hashToken } from "../utils/token.js";
import { normalizeEmail } from "./auth.service.js";
import { emailService } from "./email.service.js";

type WaitlistStatus =
  | "pending_email_confirmation"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

interface WaitlistJoinRow {
  id: string;
  email: string;
  status: WaitlistStatus;
}

interface WaitlistEntryRow {
  id: string;
  email: string;
  status: WaitlistStatus;
}

interface WaitlistConfirmationRow {
  id: string;
  waitlist_entry_id: string;
  email: string;
  status: WaitlistStatus;
  expires_at: string;
  consumed_at: string | null;
}

interface RegistrationTokenRow {
  id: string;
  email: string;
  used_count: number;
  max_uses: number;
  consumed_at: string | null;
  expires_at: string | null;
}

interface WaitlistListRow {
  id: string;
  email: string;
  status: WaitlistStatus;
  marketing_consent: boolean;
  email_confirmed_at: string | null;
  approved_at: string | null;
  created_at: string;
}

interface WaitlistStatusRow {
  id: string;
  email: string;
  status: WaitlistStatus;
  marketing_consent: boolean;
  email_confirmed_at: string | null;
  approved_at: string | null;
  created_at: string;
}

export class WaitlistError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}

function appUrl(path: string): string {
  const base = config.app.baseUrl.replace(/\/$/, "");
  return `${base}${path}`;
}

export async function joinWaitlist(input: {
  email: string;
  marketingConsent: boolean;
}): Promise<{ entryId: string; status: WaitlistStatus }> {
  const normalizedEmail = normalizeEmail(input.email);

  const existingUser = await query<{ id: string }>(
    `
    SELECT id
    FROM users
    WHERE email = $1;
    `,
    [normalizedEmail],
  );

  if (existingUser.rows[0]) {
    throw new WaitlistError("Email is already registered", 409);
  }

  const entryResult = await query<WaitlistJoinRow>(
    `
    INSERT INTO waitlist_entries (email, marketing_consent, status, email_confirmed_at, approved_by, approved_at, updated_at)
    VALUES ($1, $2, 'pending_email_confirmation', NULL, NULL, NULL, NOW())
    ON CONFLICT (email)
    DO UPDATE SET
      marketing_consent = EXCLUDED.marketing_consent,
      status = 'pending_email_confirmation',
      email_confirmed_at = NULL,
      approved_by = NULL,
      approved_at = NULL,
      updated_at = NOW()
    RETURNING id, email, status;
    `,
    [normalizedEmail, input.marketingConsent],
  );

  const entry = entryResult.rows[0];
  const confirmationToken = generateOpaqueToken();
  const tokenHash = hashToken(confirmationToken);

  await query(
    `
    INSERT INTO waitlist_email_confirmations (waitlist_entry_id, token_hash, expires_at)
    VALUES ($1, $2, NOW() + make_interval(hours => $3));
    `,
    [entry.id, tokenHash, config.waitlist.confirmationTokenTtlHours],
  );

  const confirmationUrl = appUrl(`/waitlist/confirm?token=${encodeURIComponent(confirmationToken)}`);

  await emailService.sendTransactionalEmail({
    to: entry.email,
    subject: "Confirm your waitlist request",
    text: `Please confirm your waitlist request by opening: ${confirmationUrl}`,
  });

  return {
    entryId: entry.id,
    status: entry.status,
  };
}

export async function confirmWaitlistEmail(rawToken: string): Promise<{
  entryId: string;
  email: string;
  status: WaitlistStatus;
}> {
  const tokenHash = hashToken(rawToken);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const confirmationResult = await client.query<WaitlistConfirmationRow>(
      `
      SELECT c.id,
             c.waitlist_entry_id,
             c.expires_at::text,
             c.consumed_at::text,
             e.email,
             e.status
      FROM waitlist_email_confirmations c
      INNER JOIN waitlist_entries e ON e.id = c.waitlist_entry_id
      WHERE c.token_hash = $1
      FOR UPDATE;
      `,
      [tokenHash],
    );

    const confirmation = confirmationResult.rows[0];
    if (!confirmation) {
      throw new WaitlistError("Invalid waitlist confirmation token", 400);
    }

    if (confirmation.consumed_at) {
      throw new WaitlistError("Waitlist confirmation token has already been used", 400);
    }

    const expiresAtMs = Date.parse(confirmation.expires_at);
    if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) {
      throw new WaitlistError("Waitlist confirmation token has expired", 400);
    }

    await client.query(
      `
      UPDATE waitlist_email_confirmations
      SET consumed_at = NOW()
      WHERE id = $1;
      `,
      [confirmation.id],
    );

    if (confirmation.status === "rejected") {
      throw new WaitlistError("Waitlist entry has been rejected", 409);
    }

    const updateResult = await client.query<WaitlistEntryRow>(
      `
      UPDATE waitlist_entries
      SET status = 'pending_admin_approval',
          email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, status;
      `,
      [confirmation.waitlist_entry_id],
    );

    await client.query("COMMIT");

    const entry = updateResult.rows[0];
    return {
      entryId: entry.id,
      email: entry.email,
      status: entry.status,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getWaitlistStatus(input: {
  email?: string;
  confirmationToken?: string;
}): Promise<{
  entryId: string;
  email: string;
  status: WaitlistStatus;
  marketingConsent: boolean;
  emailConfirmedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
}> {
  if (!input.email && !input.confirmationToken) {
    throw new WaitlistError("Either email or token is required", 400);
  }

  let row: WaitlistStatusRow | undefined;

  if (input.confirmationToken) {
    const tokenHash = hashToken(input.confirmationToken);
    const result = await query<WaitlistStatusRow>(
      `
      SELECT e.id, e.email, e.status, e.marketing_consent, e.email_confirmed_at::text, e.approved_at::text, e.created_at::text
      FROM waitlist_email_confirmations c
      INNER JOIN waitlist_entries e ON e.id = c.waitlist_entry_id
      WHERE c.token_hash = $1
      LIMIT 1;
      `,
      [tokenHash],
    );
    row = result.rows[0];
  } else if (input.email) {
    const normalizedEmail = normalizeEmail(input.email);
    const result = await query<WaitlistStatusRow>(
      `
      SELECT id, email, status, marketing_consent, email_confirmed_at::text, approved_at::text, created_at::text
      FROM waitlist_entries
      WHERE email = $1
      LIMIT 1;
      `,
      [normalizedEmail],
    );
    row = result.rows[0];
  }

  if (!row) {
    throw new WaitlistError("Waitlist entry not found", 404);
  }

  return {
    entryId: row.id,
    email: row.email,
    status: row.status,
    marketingConsent: row.marketing_consent,
    emailConfirmedAt: row.email_confirmed_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

export async function approveWaitlistEntry(input: {
  waitlistEntryId: string;
  approvedByUserId: string;
}): Promise<{ entryId: string; email: string; status: WaitlistStatus }> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const waitlistResult = await client.query<WaitlistEntryRow>(
      `
      SELECT id, email, status
      FROM waitlist_entries
      WHERE id = $1
      FOR UPDATE;
      `,
      [input.waitlistEntryId],
    );

    const entry = waitlistResult.rows[0];
    if (!entry) {
      throw new WaitlistError("Waitlist entry not found", 404);
    }

    if (entry.status !== "pending_admin_approval") {
      throw new WaitlistError("Waitlist entry is not pending admin approval", 409);
    }

    const registrationToken = generateOpaqueToken();
    const registrationTokenHash = hashToken(registrationToken);

    await client.query(
      `
      INSERT INTO registration_tokens (token_hash, email, source, max_uses, used_count, expires_at)
      VALUES ($1, $2, 'waitlist', 1, 0, NOW() + make_interval(hours => $3));
      `,
      [registrationTokenHash, entry.email, config.waitlist.registrationTokenTtlHours],
    );

    const approvedResult = await client.query<WaitlistEntryRow>(
      `
      UPDATE waitlist_entries
      SET status = 'approved',
          approved_by = $2,
          approved_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, email, status;
      `,
      [input.waitlistEntryId, input.approvedByUserId],
    );

    const approvedEntry = approvedResult.rows[0];

    await client.query("COMMIT");

    const registrationUrl = appUrl(`/register?token=${encodeURIComponent(registrationToken)}`);
    await emailService.sendTransactionalEmail({
      to: approvedEntry.email,
      subject: "Registration link for Chat3D",
      text: `Your waitlist entry was approved. Register here: ${registrationUrl}`,
    });

    return {
      entryId: approvedEntry.id,
      email: approvedEntry.email,
      status: approvedEntry.status,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rejectWaitlistEntry(input: {
  waitlistEntryId: string;
  approvedByUserId: string;
}): Promise<{ entryId: string; email: string; status: WaitlistStatus }> {
  const result = await query<WaitlistEntryRow>(
    `
    UPDATE waitlist_entries
    SET status = 'rejected',
        approved_by = $2,
        approved_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
      AND status IN ('pending_email_confirmation', 'pending_admin_approval')
    RETURNING id, email, status;
    `,
    [input.waitlistEntryId, input.approvedByUserId],
  );

  const entry = result.rows[0];
  if (!entry) {
    throw new WaitlistError("Waitlist entry not found or cannot be rejected", 404);
  }

  return {
    entryId: entry.id,
    email: entry.email,
    status: entry.status,
  };
}

export async function listWaitlistEntries(limit = 100): Promise<
  Array<{
    id: string;
    email: string;
    status: WaitlistStatus;
    marketingConsent: boolean;
    emailConfirmedAt: string | null;
    approvedAt: string | null;
    createdAt: string;
  }>
> {
  const result = await query<WaitlistListRow>(
    `
    SELECT id, email, status, marketing_consent, email_confirmed_at::text, approved_at::text, created_at::text
    FROM waitlist_entries
    ORDER BY created_at DESC
    LIMIT $1;
    `,
    [limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    status: row.status,
    marketingConsent: row.marketing_consent,
    emailConfirmedAt: row.email_confirmed_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  }));
}

export async function consumeRegistrationToken(input: {
  rawToken: string;
  email: string;
  client: PoolClient;
}): Promise<void> {
  const tokenHash = hashToken(input.rawToken);
  const normalizedEmail = normalizeEmail(input.email);

  const tokenResult = await input.client.query<RegistrationTokenRow>(
    `
    SELECT id, email, used_count, max_uses, consumed_at::text, expires_at::text
    FROM registration_tokens
    WHERE token_hash = $1
    FOR UPDATE;
    `,
    [tokenHash],
  );

  const token = tokenResult.rows[0];
  if (!token) {
    throw new WaitlistError("Invalid registration token", 403);
  }

  if (normalizeEmail(token.email) !== normalizedEmail) {
    throw new WaitlistError("Invalid registration token for this email", 403);
  }

  if (token.consumed_at) {
    throw new WaitlistError("Registration token has already been consumed", 403);
  }

  if (token.expires_at && Date.parse(token.expires_at) < Date.now()) {
    throw new WaitlistError("Registration token has expired", 403);
  }

  if (token.used_count >= token.max_uses) {
    throw new WaitlistError("Registration token has already been consumed", 403);
  }

  const nextUsedCount = token.used_count + 1;
  await input.client.query(
    `
    UPDATE registration_tokens
    SET used_count = $2,
        consumed_at = CASE WHEN $2 >= max_uses THEN NOW() ELSE consumed_at END
    WHERE id = $1;
    `,
    [token.id, nextUsedCount],
  );
}
