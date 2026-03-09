import { type PropsWithChildren, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Box, Menu, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { LanguageSelector } from "../../components/LanguageSelector";
import { PullToRefreshIndicator } from "../../components/layout/PullToRefreshIndicator";
import { usePullToRefresh } from "../../hooks/usePullToRefresh";

interface PublicShellProps {
  waitlistEnabled: boolean;
  waitlistState: "loading" | "ready" | "error";
}

export function PublicShell({ children, waitlistEnabled, waitlistState }: PropsWithChildren<PublicShellProps>) {
  const { t } = useTranslation(["pages", "common"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const { progress, thresholdReached, releasing, refreshing } = usePullToRefresh({ mode: "window" });

  const cta = useMemo(
    () =>
      waitlistEnabled
        ? { label: t("common:cta.joinWaitlist"), to: "/waitlist" }
        : { label: t("common:cta.startBuilding"), to: "/register" },
    [waitlistEnabled, t],
  );

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_top_left,_var(--public-gradient-1),transparent_38%),radial-gradient(circle_at_top_right,_var(--public-gradient-2),transparent_45%),linear-gradient(180deg,var(--public-bg-start)_0%,var(--public-bg-mid)_40%,var(--public-bg-end)_100%)] text-[hsl(var(--foreground))]">
      <PullToRefreshIndicator
        progress={progress}
        thresholdReached={thresholdReached}
        releasing={releasing}
        refreshing={refreshing}
      />
      <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface-1)_/_0.9)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <Link to="/" className="flex items-center gap-2 text-base font-semibold tracking-tight text-[hsl(var(--foreground))]">
            <Box className="h-5 w-5 text-[hsl(var(--primary))]" />
            Chat3D
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            <NavLink
              to="/#product"
              className="rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              {t("common:nav.product")}
            </NavLink>
            <NavLink
              to="/gallery"
              className="rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              {t("common:nav.gallery")}
            </NavLink>
            <NavLink
              to="/pricing"
              className="rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              {t("common:nav.pricing")}
            </NavLink>
            <NavLink
              to="/login"
              className="rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              {t("common:nav.login")}
            </NavLink>
            <LanguageSelector />
            <Link
              to={cta.to}
              className="inline-flex h-9 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
            >
              {cta.label}
            </Link>
          </nav>

          <div className="md:hidden">
            <Button
              variant="ghost"
              size="icon"
              aria-label={menuOpen ? t("common:a11y.closeMenu") : t("common:a11y.openMenu")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {menuOpen ? (
          <div className="animate-slide-in-bottom border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-4 py-3 md:hidden">
            <div className="flex flex-col gap-1">
              <NavLink
                to="/#product"
                className="rounded-md px-3 py-2 text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
                onClick={() => setMenuOpen(false)}
              >
                {t("common:nav.product")}
              </NavLink>
              <NavLink
                to="/gallery"
                className="rounded-md px-3 py-2 text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
                onClick={() => setMenuOpen(false)}
              >
                {t("common:nav.gallery")}
              </NavLink>
              <NavLink
                to="/pricing"
                className="rounded-md px-3 py-2 text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
                onClick={() => setMenuOpen(false)}
              >
                {t("common:nav.pricing")}
              </NavLink>
              <NavLink
                to="/login"
                className="rounded-md px-3 py-2 text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
                onClick={() => setMenuOpen(false)}
              >
                {t("common:nav.login")}
              </NavLink>
              <Link
                to={cta.to}
                onClick={() => setMenuOpen(false)}
                className="mt-1 inline-flex h-9 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
              >
                {cta.label}
              </Link>
            </div>
          </div>
        ) : null}

      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">{children}</main>

      <footer className="border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-1)_/_0.8)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
            <Box className="h-4 w-4 text-[hsl(var(--primary))]" />
            <span className="font-medium text-[hsl(var(--foreground))]">Chat3D</span>
            <span className="text-xs">{t("common:tagline")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[hsl(var(--muted-foreground))] sm:gap-4">
            <Link className="transition hover:text-[hsl(var(--foreground))]" to="/imprint">
              {t("common:footer.imprint")}
            </Link>
            <Link className="transition hover:text-[hsl(var(--foreground))]" to="/terms">
              {t("common:footer.terms")}
            </Link>
            <Link className="transition hover:text-[hsl(var(--foreground))]" to="/privacy">
              {t("common:footer.privacy")}
            </Link>
            <Link className="transition hover:text-[hsl(var(--foreground))]" to="/data-deletion">
              {t("common:footer.dataDeletion")}
            </Link>
            <Link className="transition hover:text-[hsl(var(--foreground))]" to="/legal">
              {t("common:footer.legal")}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
