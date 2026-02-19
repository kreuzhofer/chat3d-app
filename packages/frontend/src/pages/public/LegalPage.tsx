import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface LegalSection {
  id: string;
  title: string;
  path: string;
}

const legalSections: LegalSection[] = [
  { id: "terms", title: "Terms", path: "/legal/terms.md" },
  { id: "privacy", title: "Privacy", path: "/legal/privacy.md" },
  { id: "cookies", title: "Cookies", path: "/legal/cookies.md" },
];

export function LegalPage() {
  const [content, setContent] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;

    async function load() {
      setError("");
      try {
        const entries = await Promise.all(
          legalSections.map(async (section) => {
            const response = await fetch(section.path, { method: "GET" });
            if (!response.ok) {
              throw new Error(`Failed to load ${section.title}`);
            }
            return [section.id, await response.text()] as const;
          }),
        );

        if (!canceled) {
          setContent(Object.fromEntries(entries));
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
    <div className="mx-auto max-w-4xl space-y-6 rounded-xl border bg-white p-6">
      <header>
        <h1 className="text-3xl font-semibold text-slate-900">Legal</h1>
        <p className="mt-2 text-sm text-slate-600">Terms, privacy, and cookie information.</p>
      </header>

      {error ? (
        <p className="rounded-md border border-[hsl(var(--destructive))] p-2 text-sm text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}

      <div className="space-y-8">
        {legalSections.map((section) => (
          <article key={section.id} className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900">{section.title}</h2>
            {content[section.id] ? (
              <div className="prose prose-slate max-w-none text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content[section.id]}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Loading...</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
