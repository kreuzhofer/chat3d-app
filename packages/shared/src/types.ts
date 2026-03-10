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
  language?: string;
  onboardingCompletedAt?: string | null;
  generationCount?: number;
}

// ── Gallery types ──────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface GalleryModelSummary {
  id: string;
  promptText: string;
  categoryName: string;
  categoryId: string;
  evalScore: number | null;
  createdAt: string;
}

export interface GalleryCategory {
  id: string;
  name: string;
  description: string;
  complexity: number;
  rank: number;
  modelCount: number;
  /** Top-rated preview models (up to 4). First item is the featured/hero model. */
  previewModels: GalleryModelSummary[];
}

export interface GalleryModelDetail extends GalleryModelSummary {
  code: string;
  stlPath: string | null;
  stepPath: string | null;
  threemfPath: string | null;
  screenshotIso: string | null;
  screenshotFront: string | null;
  screenshotOrtho45: string | null;
}

export interface GallerySearchResult extends GalleryModelSummary {
  similarity: number;
}
