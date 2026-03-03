import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Box, Cpu, Layout, MessageSquare, Zap } from "lucide-react";
import { type RecentModel, getRecentModels } from "../../api/public.api";
import { RecentModelsCarousel } from "../../components/RecentModelsCarousel";

interface HomePageProps {
  waitlistEnabled: boolean;
}

export function HomePage({ waitlistEnabled }: HomePageProps) {
  const primaryPath = waitlistEnabled ? "/waitlist" : "/register";
  const primaryLabel = waitlistEnabled ? "Join Waitlist" : "Start Building";

  const [recentModels, setRecentModels] = useState<RecentModel[]>([]);

  useEffect(() => {
    let mounted = true;
    getRecentModels().then((models) => {
      if (mounted) setRecentModels(models);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <section className="grid gap-8 rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_40%,#134e4a_100%)] p-6 text-slate-100 md:grid-cols-[1.1fr_0.9fr] md:px-12 md:py-8">
        <div className="space-y-5">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">
            <Box className="h-3.5 w-3.5" />
            Prompt-to-CAD Workspace
          </p>
          <h1 className="text-2xl font-normal leading-snug tracking-tight md:text-4xl">
            Build 3D models with natural language.
          </h1>
          <p className="max-w-2xl text-sm text-slate-300">
            Conversational modeling, real-time preview, and policy-based governance in one workspace.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              to={primaryPath}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-5 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-110"
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
        <div className="hidden rounded-xl border border-white/15 bg-black/20 p-5 sm:block">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Three-Pane Workspace</p>
            <div className="grid h-36 grid-cols-[0.9fr_1.4fr_1fr] gap-2 text-xs sm:h-44 md:h-56">
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

      {/* Recent Models Showcase */}
      {recentModels.length > 0 && <RecentModelsCarousel models={recentModels} />}

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
