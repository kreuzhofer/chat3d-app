import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { getPublicConfig } from "./api/public.api";
import { remixModel } from "./api/gallery.api";
import { AppShell } from "./components/layout/AppShell";
import { LoadingView } from "./components/layout/StateViews";
import { useAuth } from "./hooks/useAuth";
import { useChatContextsContext } from "./contexts/ChatContextsContext";
import { AdminRouteGuard } from "./components/AdminRouteGuard";
import { CookieBanner } from "./components/CookieBanner";
import { VersionFooter } from "./components/VersionFooter";
import { DataDeletionPage } from "./pages/public/DataDeletionPage";
import { HomePage } from "./pages/public/HomePage";
import { ImprintPage } from "./pages/public/ImprintPage";
import { LearnMorePage } from "./pages/public/LearnMorePage";
import { LegalPage } from "./pages/public/LegalPage";
import { ConfirmEmailPage } from "./pages/public/ConfirmEmailPage";
import { ForgotPasswordPage } from "./pages/public/ForgotPasswordPage";
import { LoginPage } from "./pages/public/LoginPage";
import { PricingPage } from "./pages/public/PricingPage";
import { PrivacyPage } from "./pages/public/PrivacyPage";
import { PublicShell } from "./pages/public/PublicShell";
import { RegisterPage } from "./pages/public/RegisterPage";
import { ResetPasswordPage } from "./pages/public/ResetPasswordPage";
import { SetupPage } from "./pages/public/SetupPage";
import { TermsPage } from "./pages/public/TermsPage";
import { WaitlistPage } from "./pages/public/WaitlistPage";

const AdminLayout = lazy(async () => {
  const module = await import("./pages/admin/AdminLayout");
  return { default: module.AdminLayout };
});
const AdminDashboardPage = lazy(async () => {
  const module = await import("./pages/admin/AdminDashboardPage");
  return { default: module.AdminDashboardPage };
});
const AdminUsersPage = lazy(async () => {
  const module = await import("./pages/admin/AdminUsersPage");
  return { default: module.AdminUsersPage };
});
const AdminWaitlistPage = lazy(async () => {
  const module = await import("./pages/admin/AdminWaitlistPage");
  return { default: module.AdminWaitlistPage };
});
const AdminSettingsPage = lazy(async () => {
  const module = await import("./pages/admin/AdminSettingsPage");
  return { default: module.AdminSettingsPage };
});
const AdminProvidersPage = lazy(async () => {
  const module = await import("./pages/admin/AdminProvidersPage");
  return { default: module.AdminProvidersPage };
});
const AdminModelsPage = lazy(async () => {
  const module = await import("./pages/admin/AdminModelsPage");
  return { default: module.AdminModelsPage };
});
const AdminGenerationPage = lazy(async () => {
  const module = await import("./pages/admin/AdminGenerationPage");
  return { default: module.AdminGenerationPage };
});
const AdminCurationPage = lazy(async () => {
  const module = await import("./pages/admin/AdminCurationPage");
  return { default: module.AdminCurationPage };
});
const AdminKnowledgePage = lazy(async () => {
  const module = await import("./pages/admin/AdminKnowledgePage");
  return { default: module.AdminKnowledgePage };
});
const AdminCostsPage = lazy(async () => {
  const module = await import("./pages/admin/AdminCostsPage");
  return { default: module.AdminCostsPage };
});
const AdminPipelinePage = lazy(async () => {
  const module = await import("./pages/admin/AdminPipelinePage");
  return { default: module.AdminPipelinePage };
});
const AdminDataQualityPage = lazy(async () => {
  const module = await import("./pages/admin/AdminDataQualityPage");
  return { default: module.AdminDataQualityPage };
});
const AdminExperimentsPage = lazy(async () => {
  const module = await import("./pages/admin/AdminExperimentsPage");
  return { default: module.AdminExperimentsPage };
});
const BackupsPage = lazy(async () => {
  const module = await import("./components/BackupsPage");
  return { default: module.BackupsPage };
});
const ChatPage = lazy(async () => {
  const module = await import("./components/ChatPage");
  return { default: module.ChatPage };
});
const NotificationCenter = lazy(async () => {
  const module = await import("./components/NotificationCenter");
  return { default: module.NotificationCenter };
});
const ProfilePanel = lazy(async () => {
  const module = await import("./components/ProfilePanel");
  return { default: module.ProfilePanel };
});
const WorkbenchPage = lazy(async () => {
  const module = await import("./components/WorkbenchPage");
  return { default: module.WorkbenchPage };
});
const WorkbenchCategoryPage = lazy(async () => {
  const module = await import("./components/WorkbenchCategoryPage");
  return { default: module.WorkbenchCategoryPage };
});
const WorkbenchPromptPage = lazy(async () => {
  const module = await import("./components/WorkbenchPromptPage");
  return { default: module.WorkbenchPromptPage };
});
const GalleryPage = lazy(async () => {
  const module = await import("./pages/public/GalleryPage");
  return { default: module.GalleryPage };
});

/**
 * Catch-all route for authenticated users. If the URL has a `remixId` query param
 * (from a gallery remix redirect through login), execute the remix and navigate to the chat.
 * Otherwise, redirect to /chat.
 */
function AuthCatchAllRedirect() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const { refreshContexts } = useChatContextsContext();
  const [processing, setProcessing] = useState(false);
  const [done, setDone] = useState(false);
  const { t } = useTranslation("common");

  const remixId = searchParams.get("remixId");

  useEffect(() => {
    if (done) return;

    if (!remixId || !token) {
      navigate("/chat", { replace: true });
      setDone(true);
      return;
    }

    if (processing) return;
    setProcessing(true);

    remixModel(token, remixId)
      .then(async ({ contextId }) => {
        await refreshContexts();
        navigate(`/chat/${contextId}`, { replace: true });
      })
      .catch(() => {
        navigate("/chat", { replace: true });
      })
      .finally(() => setDone(true));
  }, [remixId, token, navigate, processing, done, refreshContexts]);

  return <LoadingView label={t("common:labels.loading")} />;
}

function AuthenticatedApp() {
  const { t } = useTranslation("common");

  return (
    <AppShell>
      <Suspense fallback={<LoadingView label={t("common:labels.loadingRoute")} />}>
        <Routes>
          <Route path="/" element={<Navigate replace to="/chat" />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/new" element={<ChatPage />} />
          <Route path="/chat/:contextId" element={<ChatPage />} />
          <Route path="/profile" element={<ProfilePanel />} />
          <Route path="/notifications" element={<AdminRouteGuard><NotificationCenter /></AdminRouteGuard>} />
          <Route path="/admin" element={<AdminRouteGuard><AdminLayout /></AdminRouteGuard>}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="waitlist" element={<AdminWaitlistPage />} />
            <Route path="settings" element={<AdminSettingsPage />} />
            <Route path="providers" element={<AdminProvidersPage />} />
            <Route path="models" element={<AdminModelsPage />} />
            <Route path="generation" element={<AdminGenerationPage />} />
            <Route path="curation" element={<AdminCurationPage />} />
            <Route path="knowledge" element={<AdminKnowledgePage />} />
            <Route path="costs" element={<AdminCostsPage />} />
            <Route path="pipeline" element={<AdminPipelinePage />} />
            <Route path="data-quality" element={<AdminDataQualityPage />} />
            <Route path="experiments" element={<AdminExperimentsPage />} />
            <Route path="experiments/:experimentId" element={<AdminExperimentsPage />} />
          </Route>
          <Route path="/workbench" element={<AdminRouteGuard><WorkbenchPage /></AdminRouteGuard>} />
          <Route path="/workbench/:categoryId" element={<AdminRouteGuard><WorkbenchCategoryPage /></AdminRouteGuard>} />
          <Route path="/workbench/:categoryId/:promptId" element={<AdminRouteGuard><WorkbenchPromptPage /></AdminRouteGuard>} />
          <Route path="/backups" element={<AdminRouteGuard><BackupsPage /></AdminRouteGuard>} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/gallery/category/:categoryId" element={<GalleryPage />} />
          <Route path="*" element={<AuthCatchAllRedirect />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function PublicApp() {
  const { t } = useTranslation("common");
  const [setupRequired, setSetupRequired] = useState(false);
  const [waitlistEnabled, setWaitlistEnabled] = useState(false);
  const [configState, setConfigState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      setConfigState("loading");
      try {
        const config = await getPublicConfig();
        if (!mounted) {
          return;
        }
        setSetupRequired(config.setupRequired);
        setWaitlistEnabled(config.waitlistEnabled);
        setConfigState("ready");
      } catch {
        if (!mounted) {
          return;
        }
        setSetupRequired(false);
        setWaitlistEnabled(false);
        setConfigState("error");
      }
    }

    void loadConfig();

    return () => {
      mounted = false;
    };
  }, []);

  const resolvedWaitlistEnabled = useMemo(
    () => (configState === "error" ? false : waitlistEnabled),
    [waitlistEnabled, configState],
  );

  if (configState === "loading") {
    return <LoadingView label={t("common:labels.loading")} />;
  }

  if (setupRequired) {
    return <SetupPage />;
  }

  return (
    <PublicShell waitlistEnabled={resolvedWaitlistEnabled} waitlistState={configState}>
      <Routes>
        <Route path="/" element={<HomePage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/pricing" element={<PricingPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/learn-more" element={<LearnMorePage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/gallery" element={<GalleryPage />} />
        <Route path="/gallery/category/:categoryId" element={<GalleryPage />} />
        <Route path="/login" element={<LoginPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/register" element={<RegisterPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/forgot-password/reset" element={<ResetPasswordPage />} />
        <Route path="/confirm-email" element={<ConfirmEmailPage />} />
        <Route path="/waitlist" element={<WaitlistPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/waitlist/confirm" element={<WaitlistPage waitlistEnabled={resolvedWaitlistEnabled} />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/imprint" element={<ImprintPage />} />
        <Route path="/data-deletion" element={<DataDeletionPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </PublicShell>
  );
}

export function App() {
  const { t } = useTranslation("common");
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingView label={t("common:labels.loadingSession")} />;
  }

  return (
    <>
      {isAuthenticated ? <AuthenticatedApp /> : <PublicApp />}
      <CookieBanner />
      <VersionFooter />
    </>
  );
}
