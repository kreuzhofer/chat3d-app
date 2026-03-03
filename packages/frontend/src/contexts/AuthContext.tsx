import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import i18next from "i18next";
import * as authApi from "../auth/auth.api";
import { submitSetup } from "../api/public.api";
import type { AuthUser } from "../auth/types";

const TOKEN_STORAGE_KEY = "chat3d.auth.token";

export interface RegisterResult {
  pendingConfirmation: boolean;
}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string, registrationToken?: string) => Promise<RegisterResult>;
  setupAdmin: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function persistToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applyAuthenticatedState = useCallback((nextToken: string, nextUser: AuthUser) => {
    setToken(nextToken);
    setUser(nextUser);
    persistToken(nextToken);
    if (nextUser.language) {
      i18next.changeLanguage(nextUser.language);
    }
  }, []);

  const resetAuth = useCallback(() => {
    setToken(null);
    setUser(null);
    persistToken(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!token) {
      resetAuth();
      return;
    }

    try {
      const profile = await authApi.me(token);
      setUser(profile);
    } catch (error) {
      resetAuth();
      throw error;
    }
  }, [token, resetAuth]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login({ email, password });
    applyAuthenticatedState(response.token, response.user);
  }, [applyAuthenticatedState]);

  const register = useCallback(
    async (email: string, password: string, displayName?: string, registrationToken?: string): Promise<RegisterResult> => {
      const response = await authApi.register({ email, password, displayName, registrationToken });
      if (response.token) {
        applyAuthenticatedState(response.token, response.user);
        return { pendingConfirmation: false };
      }
      // No token means email confirmation is required
      return { pendingConfirmation: true };
    },
    [applyAuthenticatedState],
  );

  const setupAdmin = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const response = await submitSetup({ email, password, displayName });
      applyAuthenticatedState(response.token, response.user);
    },
    [applyAuthenticatedState],
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await authApi.logout(token);
      } catch {
        // Ignore remote logout failures and clear local session regardless.
      }
    }
    resetAuth();
  }, [resetAuth, token]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!token) {
        if (mounted) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const profile = await authApi.me(token);
        if (mounted) {
          setUser(profile);
          if (profile.language) {
            i18next.changeLanguage(profile.language);
          }
        }
      } catch {
        if (mounted) {
          resetAuth();
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [token, resetAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticated: user?.status === "active",
      login,
      register,
      setupAdmin,
      logout,
      refreshProfile,
    }),
    [isLoading, login, logout, refreshProfile, register, setupAdmin, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within AuthProvider");
  }
  return context;
}
