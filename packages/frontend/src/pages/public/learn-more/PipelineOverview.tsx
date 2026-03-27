import { MessageSquare, Cpu, Box, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: MessageSquare,
    color: "primary",
    title: "Conversation LLM",
    subtitle: "Intent Detection",
    description:
      "Your message is analyzed by a conversation LLM that decides whether you're asking a question or requesting a 3D model. It understands context from your full chat history.",
  },
  {
    icon: Cpu,
    color: "accent",
    title: "Code Generation Agent",
    subtitle: "Build123d Python",
    description:
      "An agentic coding loop generates Build123d Python code. It researches examples, writes code, validates syntax, renders the model, and iterates until quality passes.",
  },
  {
    icon: Box,
    color: "success",
    title: "Rendering & Export",
    subtitle: "STEP / 3MF / STL",
    description:
      "The Python code is executed by an external Build123d service that produces industry-standard CAD files: STEP for precision, 3MF for 3D printing, and STL for universal compatibility.",
  },
] as const;

const colorMap = {
  primary: {
    bg: "bg-[hsl(var(--primary)_/_0.1)]",
    text: "text-[hsl(var(--primary))]",
  },
  accent: {
    bg: "bg-[hsl(var(--accent)_/_0.1)]",
    text: "text-[hsl(var(--accent))]",
  },
  success: {
    bg: "bg-[hsl(var(--success)_/_0.1)]",
    text: "text-[hsl(var(--success))]",
  },
} as const;

export function PipelineOverview() {
  return (
    <section className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">The Two-Stage Pipeline</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-2xl mx-auto">
          Chat3D uses a two-stage LLM pipeline: first a conversation model understands your intent, then a
          specialized code-generation agent produces the 3D model. This separation keeps conversations natural while
          producing high-quality CAD output.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const colors = colorMap[step.color];
          return (
            <div key={step.title} className="relative">
              <article className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-5 h-full">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors.bg} ${colors.text}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${colors.text}`}>{step.subtitle}</p>
                    <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{step.title}</h3>
                  </div>
                </div>
                <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{step.description}</p>
              </article>
              {i < steps.length - 1 && (
                <div className="hidden md:flex absolute -right-2.5 top-1/2 -translate-y-1/2 z-10 h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                  <ArrowRight className="h-3 w-3" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
