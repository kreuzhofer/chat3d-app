export type UserRole = "admin" | "user";

export type UserStatus = "active" | "deactivated" | "pending_registration";

export type WaitlistStatus =
  | "pending_email_confirmation"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

export type InvitationStatus =
  | "pending"
  | "waitlisted"
  | "registration_sent"
  | "accepted"
  | "expired"
  | "revoked";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}
