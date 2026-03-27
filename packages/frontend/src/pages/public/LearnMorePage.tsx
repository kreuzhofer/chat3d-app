import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import { PipelineOverview } from "./learn-more/PipelineOverview";
import { ConversationStage } from "./learn-more/ConversationStage";
import { CodegenStage } from "./learn-more/CodegenStage";
import { TechDetails } from "./learn-more/TechDetails";

interface LearnMorePageProps {
  waitlistEnabled: boolean;
}

export function LearnMorePage({ waitlistEnabled }: LearnMorePageProps) {
  const ctaPath = waitlistEnabled ? "/waitlist" : "/register";
  const ctaLabel = waitlistEnabled ? "Join Waitlist" : "Start Building";

  return (
    <div className="space-y-12">
      {/* Hero */}
      <header className="text-center space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">
          Under the Hood
        </p>
        <h1 className="text-3xl font-semibold text-[hsl(var(--foreground))] md:text-4xl">
          How Chat3D Works
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-2xl mx-auto leading-relaxed">
          Chat3D turns natural language into production-ready 3D CAD models. Behind every chat message is a
          multi-stage AI pipeline that understands your intent, generates parametric Build123d Python code,
          renders solid geometry, and delivers downloadable STEP, 3MF, and STL files, all in seconds.
        </p>
      </header>

      <PipelineOverview />

      <div className="border-t border-[hsl(var(--border))]" />

      <ConversationStage />

      <div className="border-t border-[hsl(var(--border))]" />

      <CodegenStage />

      <div className="border-t border-[hsl(var(--border))]" />

      <TechDetails />

      {/* Bottom CTA */}
      <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-8 text-center">
        <h2 className="text-xl font-semibold text-[hsl(var(--foreground))]">Ready to try it?</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
          See the pipeline in action. Describe a part and watch it come to life.
        </p>
        <div className="mt-5 flex justify-center">
          <Link
            to={ctaPath}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-5 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            <Zap className="h-4 w-4" />
            {ctaLabel}
          </Link>
        </div>
      </section>
    </div>
  );
}
