import { Link } from "react-router-dom";
import { Check, Zap, Sparkles } from "lucide-react";

interface PricingPageProps {
  waitlistEnabled: boolean;
}

export function PricingPage({ waitlistEnabled }: PricingPageProps) {
  const freeCtaPath = waitlistEnabled ? "/waitlist" : "/register";
  const freeCtaLabel = waitlistEnabled ? "Join Waitlist" : "Start Building";

  return (
    <div className="space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-semibold text-[hsl(var(--foreground))]">Simple, transparent pricing</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Free during early access. Advanced tiers coming soon.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <article className="rounded-xl border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--surface-1))] p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
              <Zap className="h-4 w-4" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--primary))]">Available Now</p>
          </div>
          <h2 className="text-3xl font-semibold text-[hsl(var(--foreground))]">Free</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Full chat workflow with context management, model generation, downloads, and account controls.
          </p>
          <ul className="mt-5 space-y-2.5">
            {[
              "Chat-to-model flow with 3D preview",
              "SSE-driven updates and notifications",
              "Waitlist and invitation policy integration",
              "STL, STEP, and 3MF downloads",
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-[hsl(var(--foreground))]">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--success))]" />
                {feature}
              </li>
            ))}
          </ul>
          <Link
            to={freeCtaPath}
            className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-5 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            <Zap className="h-4 w-4" />
            {freeCtaLabel}
          </Link>
        </article>

        <article className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--accent)_/_0.1)] text-[hsl(var(--accent))]">
              <Sparkles className="h-4 w-4" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">Coming Soon</p>
          </div>
          <h2 className="text-3xl font-semibold text-[hsl(var(--foreground))]">Team & Pro</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Advanced collaboration, governance, and analytics features are in planning.
          </p>
          <ul className="mt-5 space-y-2.5">
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
