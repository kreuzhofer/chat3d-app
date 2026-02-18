import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { AuthProvider } from "./contexts/AuthContext";
import { NotificationsProvider } from "./contexts/NotificationsContext";
import "./styles/theme.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <NotificationsProvider>
        <App />
      </NotificationsProvider>
    </AuthProvider>
  </StrictMode>,
);
