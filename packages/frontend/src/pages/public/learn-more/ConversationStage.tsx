import { MessageSquare, Image, History, BrainCircuit } from "lucide-react";

const features = [
  {
    icon: BrainCircuit,
    title: "Intent Classification",
    text: "The conversation LLM reads your message and the full chat history, then makes a binary decision: does this require 3D model generation, or is it a conversational response? This happens transparently, so you just chat naturally.",
  },
  {
    icon: History,
    title: "Conversation Context",
    text: "Previous messages and code snippets from your session are included as context. When you say \"make it taller\" or \"add a fillet to the top edge\", the LLM knows exactly what you're referring to.",
  },
  {
    icon: Image,
    title: "Multimodal Input",
    text: "You can attach images to your messages. The conversation LLM uses vision capabilities to understand reference photos, sketches, or screenshots, and incorporates them into the generation request.",
  },
  {
    icon: MessageSquare,
    title: "Natural Responses",
    text: "When no model is needed, the LLM responds conversationally: answering questions about Build123d, explaining design decisions, or discussing 3D printing considerations. No unnecessary generation cycles.",
  },
];

export function ConversationStage() {
  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--primary))] mb-1">Stage 1</p>
        <h2 className="text-2xl font-semibold text-[hsl(var(--foreground))]">Conversation &amp; Intent Detection</h2>
        <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))] max-w-3xl">
          Every message you send first goes through a conversation LLM. Its job is to understand what you want and
          decide the next step. This stage uses a decision-tag system internally: the model classifies your
          request and either responds with text or triggers the code generation pipeline.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <article
              key={f.title}
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">{f.title}</h3>
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))] leading-relaxed">{f.text}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
