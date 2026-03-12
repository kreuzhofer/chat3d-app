import { Link } from "react-router-dom";
import { Check, Zap, Sparkles, Users } from "lucide-react";

interface PricingPageProps {
  waitlistEnabled: boolean;
}

export function PricingPage({ waitlistEnabled }: PricingPageProps) {
  const ctaPath = waitlistEnabled ? "/waitlist" : "/register";
  const ctaLabel = waitlistEnabled ? "Join Waitlist" : "Get Started";

  return (
    <div className="space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-semibold text-[hsl(var(--foreground))]">Simple, transparent pricing</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          We're currently offering free trial access to select waitlist members. Join the waitlist to get early access.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-3">
        {/* Starter */}
        <article className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4 shadow-sm sm:p-6 flex flex-col">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
              <Zap className="h-4 w-4" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--primary))]">Starter</p>
          </div>
          <div className="mb-2">
            <span className="text-3xl font-semibold text-[hsl(var(--foreground))]">&euro;20</span>
            <span className="text-sm text-[hsl(var(--muted-foreground))]"> /month</span>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Everything you need to start creating 3D models from text.
          </p>
          <ul className="mt-5 space-y-2.5 flex-1">
            {[
              "Chat-to-model flow with 3D preview",
              "Limited generations per month",
              "STL and 3MF downloads",
              "Single user account",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-[hsl(var(--foreground))]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
                {feature}
              </li>
            ))}
          </ul>
          <Link
            to={ctaPath}
            className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-5 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
          >
            {ctaLabel}
          </Link>
        </article>

        {/* Pro — highlighted */}
        <article className="rounded-xl border-2 border-[hsl(var(--primary))] bg-[hsl(var(--surface-1))] p-4 shadow-md sm:p-6 flex flex-col relative">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[hsl(var(--primary))] px-3 py-0.5 text-xs font-semibold text-[hsl(var(--primary-foreground))]">
            Most Popular
          </div>
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--primary))]">Pro</p>
          </div>
          <div className="mb-2">
            <span className="text-3xl font-semibold text-[hsl(var(--foreground))]">&euro;49</span>
            <span className="text-sm text-[hsl(var(--muted-foreground))]"> /month</span>
          </div>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            7-day free trial, then &euro;49/mo. For professionals who need more power and flexibility.
          </p>
          <ul className="mt-5 space-y-2.5 flex-1">
            {[
              "Increased generations per month",
              "All export formats (STL, 3MF, STEP)",
              "Advanced model features",
              "Priority rendering",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-[hsl(var(--foreground))]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
                {feature}
              </li>
            ))}
          </ul>
          <Link
            to={ctaPath}
            className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-5 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            <Sparkles className="h-4 w-4" />
            Start Free Trial
          </Link>
        </article>

        {/* Team */}
        <article className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4 shadow-sm sm:p-6 flex flex-col">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--accent)_/_0.1)] text-[hsl(var(--accent))]">
              <Users className="h-4 w-4" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">Coming Soon</p>
          </div>
          <h2 className="text-3xl font-semibold text-[hsl(var(--foreground))] mb-2">Team</h2>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
            Advanced collaboration, governance, and analytics features are in planning.
          </p>
          <ul className="mt-5 space-y-2.5 flex-1">
            {[
              "Expanded admin tooling and queue workflows",
              "Usage governance and quota controls",
              "Extended export and delivery automation",
              "Priority support and SLA",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground)_/_0.4)]" />
                {feature}
              </li>
            ))}
          </ul>
          <Link
            to="/waitlist"
            className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-5 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
          >
            Notify Me via Waitlist
          </Link>
        </article>
      </section>

      <p className="text-center text-xs text-[hsl(var(--muted-foreground))]">
        By registering or joining the waitlist you agree to our{" "}
        <Link className="font-medium underline transition hover:text-[hsl(var(--foreground))]" to="/legal">
          Legal terms
        </Link>
        .
      </p>
    </div>
  );
}
