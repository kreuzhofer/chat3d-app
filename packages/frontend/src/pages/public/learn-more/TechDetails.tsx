import { Link } from "react-router-dom";
import { Github, Layers, Database, Server, Code, Globe } from "lucide-react";

const stackItems = [
  {
    icon: Globe,
    title: "Frontend",
    text: "React 18 + TypeScript, built with Vite, served via nginx. Three.js renders 3MF previews directly in the browser. The UI uses Tailwind CSS with a custom design-token system for dark/light theming.",
  },
  {
    icon: Server,
    title: "Backend",
    text: "Express + TypeScript API. Orchestrates the LLM pipeline, manages chat state, handles file storage, and communicates with external rendering services. All LLM calls go through the Vercel AI SDK for provider-agnostic abstraction.",
  },
  {
    icon: Database,
    title: "Database",
    text: "PostgreSQL 16 stores users, chat histories, LLM configurations, curated examples, and pipeline traces. Embeddings enable semantic search over the workbench example library for RAG-powered code generation.",
  },
  {
    icon: Code,
    title: "Build123d",
    text: "An open-source Python CAD kernel built on Open CASCADE. Chat3D generates Build123d scripts that produce parametric, solid models. The external rendering service executes the code in a sandboxed environment and returns STEP, 3MF, and STL files.",
  },
  {
    icon: Layers,
    title: "LLM Providers",
    text: "The system is provider-agnostic. Anthropic Claude, OpenAI, Amazon Bedrock, XAI Grok, DeepSeek, and local Ollama models are all supported. Each pipeline stage (conversation, codegen, evaluation) can use a different model, configured via the admin UI.",
  },
];

export function TechDetails() {
  return (
    <section className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Technology Stack</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-2xl mx-auto">
          Chat3D is a full-stack TypeScript application orchestrated with Docker Compose.
          Everything is open source.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stackItems.map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={item.title}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{item.title}</h3>
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{item.text}</p>
            </article>
          );
        })}
      </div>

      <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-6 text-center space-y-3">
        <div className="flex items-center justify-center gap-2 text-[hsl(var(--foreground))]">
          <Github className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Open Source</h3>
        </div>
        <p className="text-sm text-[hsl(var(--muted-foreground))] max-w-xl mx-auto">
          Chat3D is fully open source. You can explore the codebase, run your own instance, or contribute
          improvements. The entire pipeline described on this page, from conversation handling to code generation
          to rendering, is available for you to study and extend.
        </p>
        <div className="flex justify-center gap-3 pt-1">
          <a
            href="https://github.com/kreuzhofer/chat3d-app"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition hover:brightness-105"
          >
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
          <Link
            to="/gallery"
            className="inline-flex h-9 items-center justify-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition hover:bg-[hsl(var(--muted))]"
          >
            Browse Gallery
          </Link>
        </div>
      </div>
    </section>
  );
}
