import { type PropsWithChildren, useMemo, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { Button } from "../../components/ui/button";

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.10),transparent_38%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.10),transparent_45%),linear-gradient(180deg,#f8fbff_0%,#f5f8ff_40%,#eef4ff_100%)] text-[hsl(var(--foreground))]">
      <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <Link to="/" className="text-base font-semibold tracking-tight text-slate-900">
            Chat3D
          </Link>

          <nav className="hidden items-center gap-2 md:flex">
            <NavLink
              to="/#product"
              className="rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            >
              Product
            </NavLink>
            <NavLink
              to="/pricing"
              className="rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            >
              Pricing
            </NavLink>
            <NavLink
              to="/login"
              className="rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
            >
              Login
            </NavLink>
            <Link
              to={cta.to}
              className="inline-flex h-9 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
            >
              {cta.label}
            </Link>
          </nav>

          <div className="md:hidden">
            <Button
              variant="outline"
              size="sm"
              aria-label="Open menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menu
            </Button>
          </div>
        </div>

        {menuOpen ? (
          <div className="border-t border-[hsl(var(--border))] bg-white px-4 py-3 md:hidden">
            <div className="flex flex-col gap-2">
              <NavLink
                to="/#product"
                className="rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                onClick={() => setMenuOpen(false)}
              >
                Product
              </NavLink>
              <NavLink
                to="/pricing"
                className="rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                onClick={() => setMenuOpen(false)}
              >
                Pricing
              </NavLink>
              <NavLink
                to="/login"
                className="rounded-md px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                onClick={() => setMenuOpen(false)}
              >
                Login
              </NavLink>
              <Link
                to={cta.to}
                onClick={() => setMenuOpen(false)}
                className="inline-flex h-9 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
              >
                {cta.label}
              </Link>
            </div>
          </div>
        ) : null}

        {waitlistState === "loading" ? (
          <p className="border-t border-[hsl(var(--border))] px-4 py-2 text-xs text-slate-600 md:px-6">
            Checking registration mode...
          </p>
        ) : waitlistEnabled ? (
          <p className="border-t border-[hsl(var(--border))] bg-amber-50 px-4 py-2 text-xs text-amber-700 md:px-6">
            Waitlist mode is active. New users can join the waitlist and will receive a registration link after approval.
          </p>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-6 md:py-10">{children}</main>

      <footer className="border-t border-[hsl(var(--border))] bg-white/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-sm text-slate-600 md:flex-row md:items-center md:justify-between md:px-6">
          <p>Chat3D is currently in active migration and free access mode.</p>
          <div className="flex items-center gap-3">
            <Link className="hover:text-slate-900" to="/imprint">
              Imprint
            </Link>
            <Link className="hover:text-slate-900" to="/legal">
              Legal
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
