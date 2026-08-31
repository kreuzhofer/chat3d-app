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

// ── Render error classification ────────────────────────────────────

export type RenderErrorCategoryName =
  | "infrastructure"
  | "api_misuse"
  | "geometry"
  | "type_error"
  | "kernel_error"
  | "syntax"
  | "prompt_validation"
  | "unknown";

export interface RenderErrorHistogram {
  infrastructure: number;
  api_misuse: number;
  geometry: number;
  type_error: number;
  kernel_error: number;
  syntax: number;
  prompt_validation: number;
  unknown: number;
}

export interface RenderErrorExample {
  id: string;
  promptId: string;
  promptText: string;
  renderError: string | null;
  renderErrorDetail: string | null;
  renderErrorCategory: RenderErrorCategoryName;
  createdAt: string; // ISO datetime
}

// ── LLM thinking effort ──────────────────────────────────────────────

/**
 * The thinking-effort vocabulary, shared by the model default and the
 * per-purpose override.
 *
 * One list because it was previously three that disagreed: the backend's
 * budget map omitted "off", the model dialog offered only low/medium/high, and
 * the purpose table offered all five — so the UI could not express "off" even
 * though several purposes run on it. "off" is not merely the lowest budget: it
 * sets `enable_thinking: false` for vLLM-style chat templates.
 */
export const THINKING_EFFORTS = ["off", "low", "medium", "high", "max"] as const;

export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

export function isThinkingEffort(value: unknown): value is ThinkingEffort {
  return typeof value === "string" && (THINKING_EFFORTS as readonly string[]).includes(value);
}
