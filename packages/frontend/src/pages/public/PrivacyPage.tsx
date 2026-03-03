import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLegalMarkdown } from "../../hooks/useLegalMarkdown";

export function PrivacyPage() {
  const { content, error } = useLegalMarkdown("privacy.md");

  return (
    <div className="mx-auto max-w-4xl space-y-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-1))] p-6">
      {error ? (
        <p className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : content ? (
        <div className="prose max-w-none text-sm text-[hsl(var(--foreground))]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Loading...</p>
      )}
    </div>
  );
}
