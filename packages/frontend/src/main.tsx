import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./i18n/config";
import { App } from "./app";
import { ToastProvider } from "./components/ui/toast";
import { AuthProvider } from "./contexts/AuthContext";
import { NotificationsProvider } from "./contexts/NotificationsContext";
import "./styles/theme.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <BrowserRouter>
        <AuthProvider>
          <NotificationsProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </NotificationsProvider>
        </AuthProvider>
      </BrowserRouter>
    </Suspense>
  </StrictMode>,
);
