import type { AdminUser, AdminWaitlistEntry } from "../../api/admin.api";

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sortUsersByCreatedDate(users: AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function sortWaitlistByCreatedDate(entries: AdminWaitlistEntry[]): AdminWaitlistEntry[] {
  return [...entries].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function toRoleTone(role: AdminUser["role"]) {
  return role === "admin" ? "info" : "neutral";
}

export function toStatusTone(status: AdminUser["status"]) {
  if (status === "active") {
    return "success";
  }
  if (status === "deactivated") {
    return "danger";
  }
  return "warning";
}

export function toWaitlistTone(status: AdminWaitlistEntry["status"]) {
  if (status === "approved") {
    return "success";
  }
  if (status === "rejected") {
    return "danger";
  }
  if (status === "pending_admin_approval") {
    return "warning";
  }
  return "neutral";
}

export function formatPct(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

export interface ConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}
