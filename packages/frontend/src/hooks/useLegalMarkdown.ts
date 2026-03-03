import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface LegalMarkdownState {
  content: string;
  error: string;
}

/**
 * Loads a markdown file from /legal/{lang}/{filename}.md based on the current i18n language.
 * Falls back to English if the localized file fails to load.
 */
export function useLegalMarkdown(filename: string): LegalMarkdownState {
  const { i18n } = useTranslation();
  const lang = i18n.language?.substring(0, 2) ?? "en";
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;

    async function load() {
      setError("");
      setContent("");

      async function fetchMarkdown(language: string): Promise<string> {
        const response = await fetch(`/legal/${language}/${filename}`, { method: "GET" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        // Detect SPA fallback: nginx returns 200 with text/html for missing files
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("text/html")) {
          throw new Error("Received HTML instead of markdown");
        }
        return response.text();
      }

      try {
        const text = await fetchMarkdown(lang);
        if (!canceled) {
          setContent(text);
        }
      } catch {
        // Fallback to English
        if (lang !== "en") {
          try {
            const text = await fetchMarkdown("en");
            if (!canceled) {
              setContent(text);
            }
            return;
          } catch {
            // Both failed
          }
        }
        if (!canceled) {
          setError(`Failed to load ${filename}`);
        }
      }
    }

    void load();

    return () => {
      canceled = true;
    };
  }, [lang, filename]);

  return { content, error };
}
