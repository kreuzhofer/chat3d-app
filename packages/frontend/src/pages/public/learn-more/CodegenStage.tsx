import { Cpu, Search, FileCode, CheckCircle, RotateCw, Eye } from "lucide-react";

const agentSteps = [
  {
    icon: Search,
    title: "Research",
    text: "The agent decomposes your request into Build123d techniques (e.g. loft, fillet, boolean subtract) and searches curated examples and documentation for matching patterns. This gives the code generator concrete reference material.",
  },
  {
    icon: FileCode,
    title: "Spec Generation",
    text: "Before writing code, a specification is generated: a geometric blueprint describing dimensions, operations, and construction strategy. This is reviewed and enriched with researched data to fill in realistic measurements.",
  },
  {
    icon: Cpu,
    title: "Agentic Code Loop",
    text: "The code generation agent writes Build123d Python using a tool-use loop. It has access to a text editor, syntax validator, code reviewer, renderer, and documentation search. It iterates until the code passes all quality gates.",
  },
  {
    icon: CheckCircle,
    title: "Validation & Linting",
    text: "Every code change is validated against syntax rules and a custom lint ruleset (10+ rules). The linter catches common Build123d mistakes like missing root_part variables, incorrect import patterns, or invalid build contexts.",
  },
  {
    icon: RotateCw,
    title: "Render & Retry",
    text: "The code is sent to the Build123d service for rendering. If the render fails (mesh errors, self-intersections, zero-thickness walls), the agent analyzes the error and revises its approach, not just tweaking parameters but rethinking the construction strategy.",
  },
  {
    icon: Eye,
    title: "Visual Evaluation",
    text: "A vision-capable LLM evaluates the rendered model against the original request, scoring it on accuracy, completeness, and quality. This catches issues that pass code validation but don't match the user's intent.",
  },
];

export function CodegenStage() {
  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--accent))] mb-1">Stage 2</p>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Agentic Code Generation</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))] max-w-3xl">
          When the conversation LLM decides a 3D model is needed, control passes to the code generation agent.
          This isn't a single LLM call. It's an agentic loop where the model has access to tools and iterates
          until the output meets quality standards. Think of it as an AI engineer with a debugger.
        </p>
      </div>

      <div className="space-y-3">
        {agentSteps.map((step, i) => {
          const Icon = step.icon;
          return (
            <article
              key={step.title}
              className="flex gap-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4"
            >
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--accent)_/_0.1)] text-[hsl(var(--accent))]">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">{i + 1}/{agentSteps.length}</span>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-1">{step.title}</h3>
                <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{step.text}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
