import { Link } from "react-router-dom";
import { Box, Cpu, Layout, MessageSquare, Shield, Zap } from "lucide-react";

interface HomePageProps {
  waitlistEnabled: boolean;
}

export function HomePage({ waitlistEnabled }: HomePageProps) {
  const primaryPath = waitlistEnabled ? "/waitlist" : "/register";
  const primaryLabel = waitlistEnabled ? "Join Waitlist" : "Start Building";

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="grid gap-8 rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_40%,#134e4a_100%)] p-8 text-slate-100 md:grid-cols-[1.1fr_0.9fr] md:p-12">
        <div className="space-y-5">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">
            <Box className="h-3.5 w-3.5" />
            Prompt-to-CAD Workspace
          </p>
          <h1 className="text-3xl font-semibold leading-tight md:text-5xl">
            Build 3D models with natural language, governance, and real-time feedback.
          </h1>
          <p className="max-w-2xl text-sm text-slate-200 md:text-base">
            Chat3D combines conversational modeling, model preview, and policy-based administration in one modern
            workspace.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={primaryPath}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-emerald-500 px-5 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
            >
              <Zap className="h-4 w-4" />
              {primaryLabel}
            </Link>
            <Link
              to="/pricing"
              className="inline-flex h-10 items-center justify-center rounded-md border border-white/30 bg-transparent px-5 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              View Pricing
            </Link>
          </div>
          <p className="text-xs text-slate-300">
            {waitlistEnabled
              ? "Waitlist mode is currently enabled. Join now and confirm your email to be considered for access."
              : "Registration is currently open. Start building immediately or secure access through invitations."}
          </p>
        </div>

        {/* Workspace Preview Mockup */}
        <div className="rounded-xl border border-white/15 bg-black/20 p-5">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Three-Pane Workspace</p>
            <div className="grid h-64 grid-cols-[0.9fr_1.4fr_1fr] gap-2 text-xs md:h-72">
              <div className="flex flex-col gap-2 rounded-md bg-white/10 p-3">
                <div className="flex items-center gap-1.5 font-medium text-emerald-200">
                  <Layout className="h-3 w-3" />
                  Contexts
                </div>
                <div className="space-y-1.5">
                  <div className="rounded bg-white/15 px-2 py-1.5 text-white/80">Gear assembly</div>
                  <div className="rounded bg-white/8 px-2 py-1.5 text-white/50">Bracket v2</div>
                  <div className="rounded bg-white/8 px-2 py-1.5 text-white/50">Enclosure draft</div>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-md bg-white/10 p-3">
                <div className="flex items-center gap-1.5 font-medium text-emerald-200">
                  <MessageSquare className="h-3 w-3" />
                  Thread
                </div>
                <div className="space-y-1.5 text-[10px]">
                  <div className="rounded bg-white/8 px-2 py-1.5 text-white/60">Design a spur gear with 20 teeth...</div>
                  <div className="rounded border border-emerald-400/30 bg-emerald-900/30 px-2 py-1.5 text-emerald-200">Generated Build123d code and STL output</div>
                </div>
              </div>
              <div className="flex flex-col gap-2 rounded-md bg-white/10 p-3">
                <div className="flex items-center gap-1.5 font-medium text-emerald-200">
                  <Box className="h-3 w-3" />
                  Preview
                </div>
                <div className="flex flex-1 items-center justify-center rounded bg-white/5">
                  <Box className="h-12 w-12 text-emerald-300/40" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-semibold">How It Works</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">From prompt to production-ready 3D model in three steps.</p>
        </div>
        <ol className="grid gap-4 md:grid-cols-3">
          <li className="relative rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
              <MessageSquare className="h-5 w-5" />
            </div>
            <h3 className="font-semibold">1. Describe Your Part</h3>
            <p className="mt-1.5 text-sm text-[hsl(var(--muted-foreground))]">
              Create or open a chat context and define your modeling goal using natural language.
            </p>
          </li>
          <li className="relative rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--accent)_/_0.1)] text-[hsl(var(--accent))]">
              <Cpu className="h-5 w-5" />
            </div>
            <h3 className="font-semibold">2. Generate & Review</h3>
            <p className="mt-1.5 text-sm text-[hsl(var(--muted-foreground))]">
              Build123d code is generated and rendered automatically. Review output files and usage metadata.
            </p>
          </li>
          <li className="relative rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--success)_/_0.1)] text-[hsl(var(--success))]">
              <Box className="h-5 w-5" />
            </div>
            <h3 className="font-semibold">3. Preview & Iterate</h3>
            <p className="mt-1.5 text-sm text-[hsl(var(--muted-foreground))]">
              Preview in 3D, download STL/STEP/3MF files, rate results, and regenerate until production-ready.
            </p>
          </li>
        </ol>
      </section>

      {/* Feature Cards */}
      <section id="product" className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5 transition hover:border-[hsl(var(--primary)_/_0.3)] hover:shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]">
            <Layout className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold">3-Pane Workspace</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Keep context navigation, thread decisions, and rendered outputs visible without switching apps.
          </p>
        </article>
        <article className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5 transition hover:border-[hsl(var(--primary)_/_0.3)] hover:shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--accent)_/_0.1)] text-[hsl(var(--accent))]">
            <Shield className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold">Admin-Ready Foundation</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Waitlist policy, invitation controls, and user administration are integrated into the same runtime.
          </p>
        </article>
        <article className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5 transition hover:border-[hsl(var(--primary)_/_0.3)] hover:shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[hsl(var(--success)_/_0.1)] text-[hsl(var(--success))]">
            <Shield className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold">Self-Hosted & Reliable</h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Self-hosted runtime with SSE updates, explicit policy controls, and deterministic behavior.
          </p>
        </article>
      </section>

      {/* Bottom CTA */}
      <section id="pricing" className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-8 text-center">
        <h2 className="text-xl font-semibold">Ready to start building?</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Free to use during early access. Get started now.</p>
        <div className="mt-5 flex justify-center gap-3">
          <Link
            to={primaryPath}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-5 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            <Zap className="h-4 w-4" />
            {primaryLabel}
          </Link>
          <Link
            to="/pricing"
            className="inline-flex h-10 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-5 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
          >
            Explore Pricing
          </Link>
        </div>
      </section>
    </div>
  );
}
