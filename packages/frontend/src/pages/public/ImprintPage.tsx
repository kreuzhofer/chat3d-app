import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ImprintPage() {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;

    async function load() {
      setError("");
      try {
        const response = await fetch("/legal/imprint.md", { method: "GET" });
        if (!response.ok) {
          throw new Error("Failed to load imprint content");
        }
        const markdown = await response.text();
        if (!canceled) {
          setContent(markdown);
        }
      } catch (loadError) {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    }

    void load();

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-4 rounded-xl border bg-white p-6">
      <h1 className="text-3xl font-semibold text-slate-900">Imprint</h1>
      {error ? (
        <p className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : content ? (
        <div className="prose prose-slate max-w-none text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Loading...</p>
      )}
    </div>
  );
}
