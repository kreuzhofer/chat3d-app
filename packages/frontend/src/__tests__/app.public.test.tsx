// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../app";

const authState: {
  user: {
    id: string;
    email: string;
    role: "admin" | "user";
    status: "active" | "deactivated" | "pending_registration";
    displayName: string | null;
  } | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  refreshProfile: ReturnType<typeof vi.fn>;
} = {
  user: null,
  token: null,
  isLoading: false,
  isAuthenticated: false,
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  refreshProfile: vi.fn(),
};

const getPublicConfigMock = vi.fn();

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => authState,
}));

vi.mock("../api/public.api", () => ({
  getPublicConfig: () => getPublicConfigMock(),
}));

vi.mock("../contexts/NotificationsContext", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    connectionState: "open",
    refreshReplay: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn(),
  }),
}));

vi.mock("../components/ChatPage", () => ({
  ChatPage: () => <div>ChatPageMock</div>,
}));
vi.mock("../components/QueryWorkbench", () => ({
  QueryWorkbench: () => <div>QueryWorkbenchMock</div>,
}));
vi.mock("../components/ProfilePanel", () => ({
  ProfilePanel: () => <div>ProfilePanelMock</div>,
}));
vi.mock("../components/NotificationCenter", () => ({
  NotificationCenter: () => <div>NotificationCenterMock</div>,
}));
vi.mock("../components/AdminPanel", () => ({
  AdminPanel: () => <div>AdminPanelMock</div>,
}));

describe("app public UX routes", () => {
  beforeEach(() => {
    cleanup();
    getPublicConfigMock.mockReset();
    authState.isLoading = false;
    authState.isAuthenticated = false;
    authState.user = null;
  });

  it("renders home with register CTA when waitlist is off", async () => {
    getPublicConfigMock.mockResolvedValue({ waitlistEnabled: false });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Start Building" }).length).toBeGreaterThan(0);
    });

    expect(
      screen
        .getAllByRole("link", { name: "Start Building" })
        .some((link) => link.getAttribute("href") === "/register"),
    ).toBe(true);
    expect(screen.getByRole("link", { name: "Imprint" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Legal" })).toBeTruthy();
  });

  it("renders waitlist CTA when waitlist mode is on", async () => {
    getPublicConfigMock.mockResolvedValue({ waitlistEnabled: true });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Join Waitlist" }).length).toBeGreaterThan(0);
    });

    expect(
      screen
        .getAllByRole("link", { name: "Join Waitlist" })
        .some((link) => link.getAttribute("href") === "/waitlist"),
    ).toBe(true);
  });

  it("redirects authenticated root requests to /chat", async () => {
    getPublicConfigMock.mockResolvedValue({ waitlistEnabled: false });
    authState.isAuthenticated = true;
    authState.user = {
      id: "u1",
      email: "user@example.test",
      role: "user",
      status: "active",
      displayName: "User",
    };
    authState.token = "token";

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("ChatPageMock")).toBeTruthy();
    });
  });
});
