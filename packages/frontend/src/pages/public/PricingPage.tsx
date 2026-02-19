import { Link } from "react-router-dom";

interface PricingPageProps {
  waitlistEnabled: boolean;
}

export function PricingPage({ waitlistEnabled }: PricingPageProps) {
  const freeCtaPath = waitlistEnabled ? "/waitlist" : "/register";
  const freeCtaLabel = waitlistEnabled ? "Join Waitlist" : "Start Building";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-900">Pricing</h1>
        <p className="text-sm text-slate-600">
          Chat3D is free while we finalize commercial tiers. Coming-soon interest capture reuses the waitlist flow.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-700">Available Now</p>
          <h2 className="mt-2 text-2xl font-semibold">Free</h2>
          <p className="mt-2 text-sm text-slate-600">
            Full chat workflow with context management, model generation, downloads, and profile/account controls.
          </p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Chat-to-model flow</li>
            <li>SSE-driven updates and notifications</li>
            <li>Waitlist/invitation policy integration</li>
          </ul>
          <Link
            to={freeCtaPath}
            className="mt-5 inline-flex h-9 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            {freeCtaLabel}
          </Link>
        </article>

        <article className="rounded-xl border bg-white p-6 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coming Soon</p>
          <h2 className="mt-2 text-2xl font-semibold">Team & Pro</h2>
          <p className="mt-2 text-sm text-slate-600">
            Advanced collaboration, governance, and analytics features are in planning.
          </p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>Expanded admin tooling and queue workflows</li>
            <li>Usage governance and quota controls</li>
            <li>Extended export and delivery automation</li>
          </ul>
          <Link
            to="/waitlist"
            className="mt-5 inline-flex h-9 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
          >
            Notify Me via Waitlist
          </Link>
        </article>
      </section>

      <p className="text-xs text-slate-500">
        By registering or joining the waitlist you agree to our <Link className="underline" to="/legal">Legal terms</Link>.
      </p>
    </div>
  );
}
