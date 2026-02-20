import { type PropsWithChildren, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Box, Menu, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ThemeToggle } from "../../components/ui/theme-toggle";

interface PublicShellProps {
  waitlistEnabled: boolean;
  waitlistState: "loading" | "ready" | "error";
}

export function PublicShell({ children, waitlistEnabled, waitlistState }: PropsWithChildren<PublicShellProps>) {
  const [menuOpen, setMenuOpen] = useState(false);

  const cta = useMemo(
    () =>
      waitlistEnabled
        ? { label: "Join Waitlist", to: "/waitlist" }
        : { label: "Start Building", to: "/register" },
    [waitlistEnabled],
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_var(--public-gradient-1),transparent_38%),radial-gradient(circle_at_top_right,_var(--public-gradient-2),transparent_45%),linear-gradient(180deg,var(--public-bg-start)_0%,var(--public-bg-mid)_40%,var(--public-bg-end)_100%)] text-[hsl(var(--foreground))]">
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
              Product
            </NavLink>
            <NavLink
              to="/pricing"
              className="rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              Pricing
            </NavLink>
            <NavLink
              to="/login"
              className="rounded-md px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              Login
            </NavLink>
            <ThemeToggle />
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
              aria-label={menuOpen ? "Close menu" : "Open menu"}
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
                Product
              </NavLink>
              <NavLink
                to="/pricing"
                className="rounded-md px-3 py-2 text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
                onClick={() => setMenuOpen(false)}
              >
                Pricing
              </NavLink>
              <NavLink
                to="/login"
                className="rounded-md px-3 py-2 text-sm text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
                onClick={() => setMenuOpen(false)}
              >
                Login
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

        {waitlistState === "loading" ? (
          <p className="border-t border-[hsl(var(--border))] px-4 py-2 text-xs text-[hsl(var(--muted-foreground))] md:px-6">
            Checking registration mode...
          </p>
        ) : waitlistEnabled ? (
          <p className="border-t border-[hsl(var(--warning)_/_0.2)] bg-[hsl(var(--warning)_/_0.08)] px-4 py-2 text-xs text-[hsl(var(--warning))] md:px-6">
            Waitlist mode is active. New users can join the waitlist and will receive a registration link after approval.
          </p>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">{children}</main>

      <footer className="border-t border-[hsl(var(--border))] bg-[hsl(var(--surface-1)_/_0.8)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-6 text-sm md:flex-row md:items-center md:justify-between md:px-6">
          <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))]">
            <Box className="h-4 w-4 text-[hsl(var(--primary))]" />
            <span className="font-medium text-[hsl(var(--foreground))]">Chat3D</span>
            <span className="text-xs">Prompt-to-CAD workspace</span>
          </div>
          <div className="flex items-center gap-4 text-[hsl(var(--muted-foreground))]">
            <Link className="transition hover:text-[hsl(var(--foreground))]" to="/imprint">
              Imprint
            </Link>
            <Link className="transition hover:text-[hsl(var(--foreground))]" to="/legal">
              Legal
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
