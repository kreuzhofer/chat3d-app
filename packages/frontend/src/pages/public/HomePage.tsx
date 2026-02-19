import { Link } from "react-router-dom";

interface HomePageProps {
  waitlistEnabled: boolean;
}

export function HomePage({ waitlistEnabled }: HomePageProps) {
  const primaryPath = waitlistEnabled ? "/waitlist" : "/register";
  const primaryLabel = waitlistEnabled ? "Join Waitlist" : "Start Building";

  return (
    <div className="space-y-14">
      <section className="grid gap-8 rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_40%,#134e4a_100%)] p-8 text-slate-100 md:grid-cols-[1.1fr_0.9fr] md:p-12">
        <div className="space-y-5">
          <p className="inline-flex rounded-full border border-white/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">
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
              className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
            >
              {primaryLabel}
            </Link>
            <Link
              to="/pricing"
              className="inline-flex h-9 items-center justify-center rounded-md border border-white/30 bg-transparent px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
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

        <div className="rounded-xl border border-white/15 bg-black/20 p-5">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Three-Pane Workspace</p>
            <div className="grid h-64 grid-cols-[0.9fr_1.4fr_1fr] gap-2 text-xs md:h-72">
              <div className="rounded-md bg-white/10 p-2">Contexts + Chat list</div>
              <div className="rounded-md bg-white/10 p-2">Thread + prompt composer</div>
              <div className="rounded-md bg-white/10 p-2">Preview + parameters + files</div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="grid gap-4 md:grid-cols-3">
        <article className="rounded-xl border bg-white p-5">
          <h2 className="text-base font-semibold">How It Works</h2>
          <p className="mt-2 text-sm text-slate-600">
            Start a conversation, describe the part, and iterate with model-aware responses and regenerate actions.
          </p>
        </article>
        <article className="rounded-xl border bg-white p-5">
          <h2 className="text-base font-semibold">3-Pane Execution</h2>
          <p className="mt-2 text-sm text-slate-600">
            Keep context navigation, thread decisions, and rendered outputs visible without switching apps.
          </p>
        </article>
        <article className="rounded-xl border bg-white p-5">
          <h2 className="text-base font-semibold">Admin-Ready Foundation</h2>
          <p className="mt-2 text-sm text-slate-600">
            Waitlist policy, invitation controls, and user administration are integrated into the same runtime.
          </p>
        </article>
      </section>

      <section id="how-it-works" className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">How It Works</h2>
        <ol className="mt-4 grid gap-3 text-sm text-slate-700 md:grid-cols-3">
          <li className="rounded-lg border bg-slate-50 p-4">1. Create or open a chat context and define your modeling goal.</li>
          <li className="rounded-lg border bg-slate-50 p-4">2. Generate Build123d output and review file diagnostics with usage metadata.</li>
          <li className="rounded-lg border bg-slate-50 p-4">3. Preview, download, rate, and regenerate until the result is production-ready.</li>
        </ol>
      </section>

      <section id="workspace" className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">3-Pane Workflow Preview</h2>
        <p className="mt-2 text-sm text-slate-600">
          Desktop uses a full three-pane layout. Mobile uses compact navigation and pane switching to maximize chat space.
        </p>
      </section>

      <section id="trust" className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-semibold">Trust and Reliability</h2>
        <p className="mt-2 text-sm text-slate-600">
          Self-hosted runtime, SSE updates, explicit policy controls, and deterministic migration contracts reduce hidden
          behavior and improve operational confidence.
        </p>
      </section>

      <section id="pricing" className="rounded-xl border bg-white p-6 text-center">
        <h2 className="text-xl font-semibold">Free now, advanced tiers later</h2>
        <p className="mt-2 text-sm text-slate-600">Use the current free plan while pricing tiers are finalized.</p>
        <div className="mt-4 flex justify-center gap-3">
          <Link
            to={primaryPath}
            className="inline-flex h-9 items-center justify-center rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            {primaryLabel}
          </Link>
          <Link
            to="/pricing"
            className="inline-flex h-9 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-white px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
          >
            Explore Pricing
          </Link>
        </div>
      </section>
    </div>
  );
}
